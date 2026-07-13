#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import { detectProvider, overrideProvider, Detection, Provider } from './detect';

const PKG_NAME = 'create-yeti-agent';
const PKG_VERSION = '0.3.1';
const SDK_HEADER = 'x-yeti-sdk';
const SDK_HEADER_VALUE = `${PKG_NAME}@${PKG_VERSION}`;
const DEFAULT_BASE_URL = process.env.YETI_ARENA_URL || 'https://api.hermesarena.live';
const RUNTIME_PKG = 'yetifi-arena-runtime';
const RUNTIME_VERSION = '^0.1.4';

interface ParsedArgs {
  projectName?: string;
  baseUrl: string;
  persona?: string;
  yes: boolean;
  llm?: string;
  start: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { baseUrl: DEFAULT_BASE_URL, yes: false, start: false };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--url' || a === '--base-url') out.baseUrl = args[++i] || out.baseUrl;
    else if (a === '--persona') out.persona = args[++i];
    else if (a === '--llm') out.llm = args[++i];
    else if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--start') out.start = true;
    else if (!a.startsWith('-') && !out.projectName) out.projectName = a;
  }
  return out;
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

function describeProvider(d: Detection): string {
  switch (d.provider) {
    case 'hermes':    return `Hermes @ ${d.baseUrl} (model ${d.model})`;
    case 'anthropic': return `Anthropic API (model ${d.model}) — needs ANTHROPIC_API_KEY at runtime`;
    case 'openai':    return `OpenAI API (model ${d.model}) — needs OPENAI_API_KEY at runtime`;
    case 'gemini':    return `Google Gemini (model ${d.model}) — needs GEMINI_API_KEY at runtime`;
    case 'ollama':    return `Ollama @ ${d.baseUrl} (model ${d.model})`;
    case 'stub':      return 'No LLM detected — decide.ts returns [] (the agent holds positions every cycle)';
  }
}

function nextStepsLine(d: Detection, name: string): string {
  const setup = (() => {
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
      console.log(`  ${detection.provider === 'stub' ? '(none found)' : 'found'}: ${describeProvider(detection)}`);
    }

    console.log(`\n→ Joining arena at ${args.baseUrl} as "${name}"`);
    const joined = await joinArena(args.baseUrl, {
      name,
      preferredIntervalSec: 60,
      systemPrompt: persona,
    });
    console.log(`  agentId: ${joined.agentId} (tier=${joined.tier})`);
    if (joined.readiness?.action) {
      console.log(`  readiness: ${joined.readiness.action}`);
    } else {
      console.log('  readiness: enrolled — run the agent loop to register ready (join alone is not enough).');
    }

    let bearerToken = '';
    let bearerExpiresAt = '';
    try {
      const sess = await authenticate(args.baseUrl, joined.agentId, joined.apiKey);
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
      LLM_DESCRIPTION: describeProvider(detection),
    });
    wireProvider(dest, detection);

    const envLines = [
      `ARENA_BASE_URL=${args.baseUrl.replace(/\/$/, '')}`,
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
      `Next:\n  ${nextStepsLine(detection, name)}\n\n` +
      `Or next time: npx create-yeti-agent <name> --start\n\n` +
      `Wired: ${describeProvider(detection)}.\nSee AGENTS.md in the project root for the contract.`,
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
