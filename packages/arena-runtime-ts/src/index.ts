import fs from 'fs';
import path from 'path';
import type { AgentConfig, DecideFn, Snapshot } from './types';
import { runLive, runReplay, RunOptions } from './loop';

export type { AgentConfig, DecideFn, Snapshot, Decision, TradeAction, OpenTradeView, PortfolioView, RejectionView } from './types';
export { ArenaError } from './client';
export { runReplay };

// Re-export generated artifacts when available. The file is created by
// `npm run codegen` against a running backend; if the runtime is built
// before codegen has been run, consumers fall back to the hand-written
// shapes in ./types. Wrap in a try so a missing generated file doesn't
// break the build for new contributors.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  module.exports = { ...module.exports, ...require('./types.generated') };
} catch {
  /* codegen not yet run; using hand-written types only */
}

export interface DefineAgentInput {
  decide: DecideFn;
  config?: Partial<Pick<AgentConfig, 'pollIntervalMs' | 'model' | 'include'>>;
}

export interface DefinedAgent {
  decide: DecideFn;
  config: Pick<AgentConfig, 'pollIntervalMs' | 'model' | 'include'>;
}

export function defineAgent(input: DefineAgentInput): DefinedAgent {
  return {
    decide: input.decide,
    config: {
      pollIntervalMs: input.config?.pollIntervalMs ?? 15_000,
      model: input.config?.model,
      include: input.config?.include ?? ['analysis'],
    },
  };
}

function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function loadCredentials(cwd: string): { baseUrl: string; agentId: string; apiKey: string; bearerToken?: string; bearerExpiresAt?: string } {
  const fromEnv = readEnvFile(path.join(cwd, '.env.local'));
  const get = (k: string) => process.env[k] ?? fromEnv[k];
  const baseUrl = get('ARENA_BASE_URL');
  const agentId = get('ARENA_AGENT_ID');
  const apiKey = get('ARENA_AGENT_API_KEY');
  if (!baseUrl || !agentId || !apiKey) {
    throw new Error('Missing arena credentials. Expected ARENA_BASE_URL, ARENA_AGENT_ID, ARENA_AGENT_API_KEY in .env.local or process.env.');
  }
  return {
    baseUrl,
    agentId,
    apiKey,
    bearerToken: get('ARENA_AGENT_BEARER_TOKEN') || undefined,
    bearerExpiresAt: get('ARENA_AGENT_TOKEN_EXPIRES_AT') || undefined,
  };
}

export async function runFromCwd(agent: DefinedAgent, opts: RunOptions = {}): Promise<void> {
  const creds = loadCredentials(process.cwd());
  const cfg: AgentConfig = {
    ...creds,
    pollIntervalMs: agent.config.pollIntervalMs,
    model: agent.config.model,
    include: agent.config.include,
  };
  await runLive(cfg, agent.decide, opts);
}
