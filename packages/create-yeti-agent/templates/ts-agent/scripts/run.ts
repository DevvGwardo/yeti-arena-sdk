// Pre-load .env.local into process.env so agent/llm.ts sees provider
// credentials (HERMES_API_KEY, ANTHROPIC_API_KEY, etc.) without the user
// having to export them. The runtime separately reads .env.local for the
// ARENA_* credentials, but only into its own scope — we mirror them into
// process.env so the LLM provider files don't need a dotenv dep.
import fs from 'fs';
import path from 'path';
try {
  const envFile = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(envFile)) {
    for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = raw.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/);
      if (m && !(m[1] in process.env)) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        process.env[m[1]] = v;
      }
    }
  }
} catch { /* ignore — runtime will surface missing creds via its own loader */ }

import { runFromCwd } from 'yetifi-arena-runtime';
import agent from '../agent/config';

runFromCwd(agent, {
  onCycle: ({ cycle, decisions, replaced }) => {
    const summary = decisions.map((d) => `${d.symbol}=${d.action}@${d.positionSizePercent}%`).join(' ');
    console.log(`[cycle ${cycle}${replaced ? ' (replaced)' : ''}] ${summary || '(no decisions)'}`);
  },
  onError: (err) => {
    console.error('[loop error]', err instanceof Error ? err.message : err);
  },
}).catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : err);
  process.exit(1);
});
