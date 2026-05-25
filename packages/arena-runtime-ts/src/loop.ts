import { snapshot as fetchSnapshot, submit, ArenaError } from './client';
import { TokenManager } from './auth';
import type { AgentConfig, DecideFn, Decision, Snapshot } from './types';

export interface RunOptions {
  signal?: AbortSignal;
  onCycle?: (info: {
    cycle: number;
    snapshot: Snapshot;
    decisions: Decision[];
    replaced: boolean;
  }) => void;
  onError?: (err: unknown) => void;
  maxCycles?: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    }, { once: true });
  });

export async function runLive(
  cfg: AgentConfig,
  decide: DecideFn,
  opts: RunOptions = {},
): Promise<void> {
  const tokens = new TokenManager(cfg.baseUrl, cfg.agentId, cfg.apiKey, cfg.bearerToken, cfg.bearerExpiresAt);
  let lastSubmittedCycle = -1;
  let cyclesDone = 0;

  while (true) {
    if (opts.signal?.aborted) return;
    if (opts.maxCycles !== undefined && cyclesDone >= opts.maxCycles) return;

    try {
      const token = await tokens.get();
      const snap = await fetchSnapshot(cfg.baseUrl, cfg.agentId, token, cfg.include);
      const nextCycle = snap.server.acceptingDecisionsForCycle;

      if (nextCycle > lastSubmittedCycle) {
        const decisions = await decide(snap);
        if (decisions.length > 0) {
          const result = await submit(cfg.baseUrl, cfg.agentId, token, {
            decisions,
            model: cfg.model,
          });
          if (result.accepted) {
            lastSubmittedCycle = result.targetCycle;
            opts.onCycle?.({
              cycle: result.targetCycle,
              snapshot: snap,
              decisions,
              replaced: !!result.replaced,
            });
          }
        } else {
          lastSubmittedCycle = nextCycle;
        }
        cyclesDone += 1;
      }
    } catch (err) {
      opts.onError?.(err);
      if (err instanceof ArenaError && err.status === 429) {
        const backoff = Math.min(cfg.pollIntervalMs * 2, 30_000);
        try { await sleep(backoff, opts.signal); } catch { return; }
        continue;
      }
    }

    try {
      await sleep(cfg.pollIntervalMs, opts.signal);
    } catch {
      return;
    }
  }
}

export async function runReplay(
  snapshots: Iterable<Snapshot> | AsyncIterable<Snapshot>,
  decide: DecideFn,
): Promise<Array<{ cycle: number; decisions: Decision[] }>> {
  const out: Array<{ cycle: number; decisions: Decision[] }> = [];
  for await (const snap of snapshots as AsyncIterable<Snapshot>) {
    const decisions = await decide(snap);
    out.push({ cycle: snap.server.acceptingDecisionsForCycle, decisions });
  }
  return out;
}
