#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import { resolveBaseUrl, explainNetworkError, PRIMARY_BASE_URL, FALLBACK_BASE_URL } from './resolve';
import { detectProvider, overrideProvider, Detection, Provider } from './detect';
import { BUNDLED_STYLES, TradingStyle, mergeCatalog, personaMarkdown, styleIds } from './styles';

const PKG_NAME = 'create-yeti-agent';
const PKG_VERSION = '0.4.0';
const SDK_HEADER = 'x-yeti-sdk';
const SDK_HEADER_VALUE = `${PKG_NAME}@${PKG_VERSION}`;
const RUNTIME_PKG = 'yetifi-arena-runtime';
const RUNTIME_VERSION = '^0.1.4';

interface ParsedArgs {
  projectName?: string;
  /** Explicit --url / YETI_ARENA_URL; undefined means probe the default with fallback. */
  baseUrl?: string;
  help: boolean;
  persona?: string;
  yes: boolean;
  llm?: string;
  style?: string;
  start: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { baseUrl: process.env.YETI_ARENA_URL || undefined, help: false, yes: false, start: false };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--url' || a === '--base-url') out.baseUrl = args[++i] || out.baseUrl;
    else if (a === '--persona') out.persona = args[++i];
    else if (a === '--llm') out.llm = args[++i];
    else if (a === '--style') out.style = args[++i];
    else if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--start') out.start = true;
    else if (!a.startsWith('-') && !out.projectName) out.projectName = a;
  }
  return out;
}

const HELP = `create-yeti-agent ${PKG_VERSION} - scaffold and enroll a YetiFi arena agent

Usage:
  npx create-yeti-agent <name> [options]

Options:
  <name>             Agent name (2-39 chars, alphanumeric plus - and _)
  --url <url>        Arena base URL. Never falls back if you set it.
  --persona "<text>" One-line strategy persona (uploaded as system prompt)
  --llm <provider>   Force LLM provider (hermes|anthropic|openai|gemini|ollama|stub)
  --style <id>       Rules-based preset, no LLM key needed (${styleIds().join('|')}).
                     Overwrites agent/decide.ts and agent/persona.md.
  --yes, -y          Skip interactive prompts
  --start            After scaffolding, npm install && npm run dev
  --help, -h         Show this help

Environment:
  YETI_ARENA_URL     Same as --url

Default host: ${PRIMARY_BASE_URL}. If it is unreachable (network/TLS error or
non-2xx on /api/arena/manifest), ${FALLBACK_BASE_URL}
is used instead and written to ARENA_BASE_URL in .env.local.
`;

async function fetchStyleCatalog(baseUrl: string): Promise<TradingStyle[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/arena/styles`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: ctl.signal as any });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as { styles?: unknown };
    return mergeCatalog(payload.styles);
  } catch (err) {
    console.warn(`  warning: could not fetch styles from ${url} (${(err as Error).message}); using bundled styles`);
    return BUNDLED_STYLES;
  } finally {
    clearTimeout(timer);
  }
}

function applyStyle(destDir: string, style: TradingStyle, agentName: string): void {
  const body = style.decideTs.trim();
  fs.writeFileSync(path.join(destDir, 'agent', 'decide.ts'), body + '\n');
  fs.writeFileSync(path.join(destDir, 'agent', 'persona.md'), personaMarkdown(agentName, style.persona));
}

async function pickStyleInteractive(rl: readline.Interface, styles: TradingStyle[]): Promise<TradingStyle | undefined> {
  console.log('\nNo LLM detected. Pick a rules-based trading style (no LLM key required):');
  styles.forEach((s, i) => console.log(`  ${i + 1}. ${s.id} - ${s.label}: ${s.blurb}`));
  console.log('  0. skip (decide.ts will return [] until you wire an LLM)');
  const ans = (await ask(rl, 'Pick a style number (default 1): ')).toLowerCase();
  if (ans === '' || ans === '1') return styles[0];
  if (ans === '0' || ans === 'skip' || ans === 'none') return undefined;
  if (/^\d+$/.test(ans)) {
    const idx = Number(ans);
    if (idx >= 1 && idx <= styles.length) return styles[idx - 1];
  }
  const byId = styles.find((s) => s.id === ans);
  if (byId) return byId;
  console.log(`  unknown choice ${JSON.stringify(ans)}; skipping style`);
  return undefined;
}

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, (a) => resolve(a.trim())));
}

function validName(name: string): string | null {
  if (!/^[a-z0-9][a-z0-9-_]{1,38}$/i.test(name)) {
    return 'Name must be 2-39 chars, alphanumeric plus - and _.';
  }
  return null;
}

function copyTemplate(srcDir: string, destDir: string, vars: Record<string, string>): void {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    // Allow `_gitignore` → `.gitignore` because npm strips .gitignore from
    // published packages, breaking templates that ship one.
    const targetName = entry.name === '_gitignore' ? '.gitignore' : entry.name;
    const destPath = path.join(destDir, targetName);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyTemplate(srcPath, destPath, vars);
    } else {
      let content = fs.readFileSync(srcPath, 'utf8');
      for (const [k, v] of Object.entries(vars)) {
        content = content.split(`{{${k}}}`).join(v);
      }
      fs.writeFileSync(destPath, content);
    }
  }
}

// Copy the chosen provider's llm.ts on top of the stub that ts-agent ships
// with. Stub stays the default so a missing provider file still produces a
// project that compiles and runs (decide.ts gracefully returns []).
function wireProvider(destDir: string, detection: Detection): void {
  if (detection.provider === 'stub') return;
  const src = path.join(__dirname, '..', 'templates', 'llm-providers', `${detection.provider}.ts`);
  if (!fs.existsSync(src)) {
    console.warn(`  warning: provider template missing for ${detection.provider} — leaving stub in place`);
    return;
  }
  let body = fs.readFileSync(src, 'utf8');
  body = body.split('{{LLM_MODEL}}').join(detection.model || detection.provider);
  fs.writeFileSync(path.join(destDir, 'agent', 'llm.ts'), body);
}

function describeProvider(d: Detection, style?: TradingStyle): string {
  if (style && d.provider === 'stub') return `Rules-based style "${style.id}" (${style.label}) - no LLM needed`;
  switch (d.provider) {
    case 'hermes':    return `Hermes @ ${d.baseUrl} (model ${d.model})`;
    case 'anthropic': return `Anthropic API (model ${d.model}) — needs ANTHROPIC_API_KEY at runtime`;
    case 'openai':    return `OpenAI API (model ${d.model}) — needs OPENAI_API_KEY at runtime`;
    case 'gemini':    return `Google Gemini (model ${d.model}) — needs GEMINI_API_KEY at runtime`;
    case 'ollama':    return `Ollama @ ${d.baseUrl} (model ${d.model})`;
    case 'stub':      return 'No LLM detected — decide.ts returns [] (the agent holds positions every cycle)';
  }
}

function nextStepsLine(d: Detection, name: string, style?: TradingStyle): string {
  const setup = (() => {
    if (style && d.provider === 'stub') return '';
    switch (d.provider) {
      case 'hermes':    return '';
      case 'anthropic': return 'export ANTHROPIC_API_KEY=...\n  ';
      case 'openai':    return 'export OPENAI_API_KEY=...\n  ';
      case 'gemini':    return 'export GEMINI_API_KEY=...\n  ';
      case 'ollama':    return '';
      case 'stub':      return '# (No LLM wired. Set ANTHROPIC_API_KEY or run a local LLM, then re-scaffold for auto-wiring.)\n  ';
    }
  })();
  return `cd ${name}\n  ${setup}npm install\n  npm run dev`;
}

interface JoinResult {
  agentId: string;
  apiKey: string;
  tier: string;
  readiness?: { action?: string; phase?: string; readyCount?: number; minAgents?: number };
}

async function joinArena(
  baseUrl: string,
  body: { name: string; preferredIntervalSec: number; systemPrompt?: string },
): Promise<JoinResult> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/arena/join`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [SDK_HEADER]: SDK_HEADER_VALUE,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let payload: unknown = text;
  try { payload = text ? JSON.parse(text) : null; } catch { /* leave */ }
  if (!res.ok) {
    const msg = (payload as { message?: string; error?: string } | null)?.message
      || (payload as { error?: string } | null)?.error
      || `HTTP ${res.status}`;
    if (res.status === 426) {
      throw new Error(`Server rejected non-SDK call (426 Upgrade Required). Update ${PKG_NAME}.\nServer said: ${msg}`);
    }
    throw new Error(`/api/arena/join failed (${res.status}): ${msg}`);
  }
  return payload as JoinResult;
}

async function authenticate(
  baseUrl: string,
  agentId: string,
  apiKey: string,
): Promise<{ token: string; expiresAt: string }> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/arena/auth`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [SDK_HEADER]: SDK_HEADER_VALUE,
    },
    body: JSON.stringify({ agentId, apiKey }),
  });
  if (!res.ok) throw new Error(`/api/arena/auth failed (${res.status})`);
  return (await res.json()) as { token: string; expiresAt: string };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(HELP); return; }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    let name = args.projectName;
    if (!name && !args.yes) name = await ask(rl, 'Agent name (lowercase, 2-39 chars): ');
    if (!name) {
      console.error('A name is required. Usage: npx create-yeti-agent <name>');
      process.exit(2);
    }
    const nameErr = validName(name);
    if (nameErr) { console.error(nameErr); process.exit(2); }

    const dest = path.resolve(process.cwd(), name);
    if (fs.existsSync(dest) && fs.readdirSync(dest).length) {
      console.error(`Directory ${dest} is not empty.`);
      process.exit(2);
    }

    if (args.style !== undefined && !args.style) {
      console.error(`--style needs an id. Valid: ${styleIds().join(', ')}`);
      process.exit(2);
    }

    let persona = args.persona;
    if (persona === undefined && !args.yes) {
      const a = await ask(rl, 'One-line strategy persona (optional, press enter to skip): ');
      persona = a || undefined;
    }

    // Detect the trading LLM *before* the network join so failure modes
    // print cleanly above the join step. --llm <name> overrides detection.
    console.log('\n→ Detecting trading LLM');
    let detection: Detection;
    if (args.llm) {
      try {
        detection = overrideProvider(args.llm);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(2);
      }
      console.log(`  forced via --llm: ${describeProvider(detection)}`);
    } else {
      detection = await detectProvider();
      if (detection.provider === 'stub' && args.style) {
        console.log(`  (none found; not needed) using rules-based style "${args.style}"`);
      } else {
        console.log(`  ${detection.provider === 'stub' ? '(none found)' : 'found'}: ${describeProvider(detection)}`);
      }
    }

    const resolved = await resolveBaseUrl(args.baseUrl);
    const baseUrl = resolved.baseUrl;
    if (resolved.fellBack) {
      console.log(`\n  ${PRIMARY_BASE_URL.replace(/^https?:\/\//, '')} unreachable (${resolved.reason}), using ${baseUrl}`);
    }
    const explicitUrl = !!args.baseUrl;

    // Rules-based style: explicit --style, or offered when no LLM was detected
    // (never with --yes, which stays non-interactive and keeps the stub).
    let style: TradingStyle | undefined;
    if (args.style || (detection.provider === 'stub' && !args.llm && !args.yes)) {
      const catalog = await fetchStyleCatalog(baseUrl);
      if (args.style) {
        style = catalog.find((s) => s.id === args.style);
        if (!style) {
          console.error(`Unknown style "${args.style}". Valid: ${styleIds(catalog).join(', ')}`);
          process.exit(2);
        }
      } else {
        style = await pickStyleInteractive(rl, catalog);
      }
      if (style && persona === undefined) persona = style.persona || undefined;
    }

    console.log(`\n→ Joining arena at ${baseUrl} as "${name}"`);
    let joined: JoinResult;
    try {
      joined = await joinArena(baseUrl, {
        name,
        preferredIntervalSec: 60,
        systemPrompt: persona,
      });
    } catch (err) {
      throw explicitUrl ? explainNetworkError(baseUrl, err) : err;
    }
    console.log(`  agentId: ${joined.agentId} (tier=${joined.tier})`);
    console.log(`  Watch it live: https://www.hermesarena.live/trader/${encodeURIComponent(joined.agentId)}`);
    if (joined.readiness?.action) {
      console.log(`  readiness: ${joined.readiness.action}`);
    } else {
      console.log('  readiness: enrolled — run the agent loop to register ready (join alone is not enough).');
    }

    let bearerToken = '';
    let bearerExpiresAt = '';
    try {
      const sess = await authenticate(baseUrl, joined.agentId, joined.apiKey);
      bearerToken = sess.token;
      bearerExpiresAt = sess.expiresAt;
      console.log(`  bearer token acquired (expires ${bearerExpiresAt})`);
    } catch (err) {
      console.warn(`  warning: bearer fetch failed — runtime will retry on first cycle (${(err as Error).message})`);
    }

    console.log(`\n→ Scaffolding ${dest}`);
    fs.mkdirSync(dest, { recursive: true });
    const templateRoot = path.join(__dirname, '..', 'templates', 'ts-agent');
    copyTemplate(templateRoot, dest, {
      AGENT_NAME: name,
      RUNTIME_PKG: RUNTIME_PKG,
      RUNTIME_VERSION: RUNTIME_VERSION,
      PERSONA: persona || '',
      LLM_PROVIDER: detection.provider,
      LLM_MODEL: detection.model || '',
      LLM_DESCRIPTION: describeProvider(detection, style),
    });
    wireProvider(dest, detection);
    if (style) {
      applyStyle(dest, style, name);
      console.log(`  applied style ${style.id} -> agent/decide.ts + agent/persona.md`);
    }

    const envLines = [
      `ARENA_BASE_URL=${baseUrl.replace(/\/$/, '')}`,
      `ARENA_AGENT_ID=${joined.agentId}`,
      `ARENA_AGENT_API_KEY=${joined.apiKey}`,
      `ARENA_AGENT_BEARER_TOKEN=${bearerToken}`,
      `ARENA_AGENT_TOKEN_EXPIRES_AT=${bearerExpiresAt}`,
      `ARENA_AGENT_NAME=${name}`,
    ];
    // For local-LLM providers, pin the URL+model in .env.local so the
    // generated llm.ts has a deterministic default the user can edit
    // without grepping the source. Cloud providers expect the API key in
    // ambient env, not .env.local, to keep secrets out of the repo.
    if (detection.baseUrl) envLines.push(`LLM_BASE_URL=${detection.baseUrl}`);
    if (detection.model) envLines.push(`LLM_MODEL=${detection.model}`);
    // Carry the provider's API key into .env.local when one is present in
    // the scaffolder's env so `npm run dev` works without the user having
    // to re-export. For Hermes/Ollama (local), this is just a convenience;
    // for cloud providers, it's the actual auth credential.
    const KEY_ENV_BY_PROVIDER: Record<Provider, string | null> = {
      hermes: 'HERMES_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      gemini: process.env.GEMINI_API_KEY ? 'GEMINI_API_KEY' : 'GOOGLE_API_KEY',
      ollama: null,
      stub: null,
    };
    const keyEnv = KEY_ENV_BY_PROVIDER[detection.provider];
    if (keyEnv && process.env[keyEnv]) {
      envLines.push(`${keyEnv}=${process.env[keyEnv]}`);
    }
    envLines.push('');
    fs.writeFileSync(path.join(dest, '.env.local'), envLines.join('\n'));

    console.log(
      `\n✓ Done. You are enrolled, not yet ready.\n` +
      `  Run the loop so the runtime can submit a QUEUE readiness heartbeat,\n` +
      `  then edit agent/decide.ts / agent/persona.md for strategy.\n\n` +
      `Watch it live: https://www.hermesarena.live/trader/${encodeURIComponent(joined.agentId)}\n\n` +
      `Next:\n  ${nextStepsLine(detection, name, style)}\n\n` +
      `Or next time: npx create-yeti-agent <name> --start\n\n` +
      `Wired: ${describeProvider(detection, style)}.\nSee AGENTS.md in the project root for the contract.`,
    );

    if (args.start) {
      console.log(`\n→ --start: installing and launching the loop in ${dest}`);
      await new Promise<void>((resolve, reject) => {
        const install = spawn('npm', ['install'], { cwd: dest, stdio: 'inherit', shell: true });
        install.on('error', reject);
        install.on('exit', (code) => {
          if (code !== 0) return reject(new Error(`npm install exited ${code}`));
          const run = spawn('npm', ['run', 'dev'], { cwd: dest, stdio: 'inherit', shell: true });
          run.on('error', reject);
          run.on('exit', (runCode) => {
            if (runCode !== 0 && runCode !== null) {
              return reject(new Error(`npm run dev exited ${runCode}`));
            }
            resolve();
          });
        });
      });
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error('\n✗ create-yeti-agent failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
