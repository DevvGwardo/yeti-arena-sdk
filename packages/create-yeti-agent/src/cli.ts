#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import fetch from 'node-fetch';

const PKG_NAME = 'create-yeti-agent';
const PKG_VERSION = '0.1.0';
const SDK_HEADER = 'x-yeti-sdk';
const SDK_HEADER_VALUE = `${PKG_NAME}@${PKG_VERSION}`;
const DEFAULT_BASE_URL = process.env.YETI_ARENA_URL || 'https://api.hermesarena.live';
const RUNTIME_PKG = 'yetifi-arena-runtime';
const RUNTIME_VERSION = '^0.1.0';

interface ParsedArgs {
  projectName?: string;
  baseUrl: string;
  persona?: string;
  yes: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { baseUrl: DEFAULT_BASE_URL, yes: false };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--url' || a === '--base-url') out.baseUrl = args[++i] || out.baseUrl;
    else if (a === '--persona') out.persona = args[++i];
    else if (a === '--yes' || a === '-y') out.yes = true;
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

async function joinArena(
  baseUrl: string,
  body: { name: string; preferredIntervalSec: number; systemPrompt?: string },
): Promise<{ agentId: string; apiKey: string; tier: string }> {
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
  return payload as { agentId: string; apiKey: string; tier: string };
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

    console.log(`\n→ Joining arena at ${args.baseUrl} as "${name}"`);
    const joined = await joinArena(args.baseUrl, {
      name,
      preferredIntervalSec: 60,
      systemPrompt: persona,
    });
    console.log(`  agentId: ${joined.agentId} (tier=${joined.tier})`);

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
    });

    const envContent = [
      `ARENA_BASE_URL=${args.baseUrl.replace(/\/$/, '')}`,
      `ARENA_AGENT_ID=${joined.agentId}`,
      `ARENA_AGENT_API_KEY=${joined.apiKey}`,
      `ARENA_AGENT_BEARER_TOKEN=${bearerToken}`,
      `ARENA_AGENT_TOKEN_EXPIRES_AT=${bearerExpiresAt}`,
      `ARENA_AGENT_NAME=${name}`,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dest, '.env.local'), envContent);

    console.log(`\n✓ Done.\n\nNext:\n  cd ${name}\n  npm install\n  npm run dev\n\nThe only files you should edit are agent/decide.ts and agent/persona.md.\nSee AGENT.md in the project root for the contract.`);
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error('\n✗ create-yeti-agent failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
