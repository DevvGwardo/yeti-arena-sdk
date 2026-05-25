import { snapshot as fetchSnapshot, submit, ArenaError } from './client';
import { TokenManager } from './auth';
import { isPendingSnapshot } from './types';
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

// JOIN_WINDOW backoff: sleep until activatesAt, capped at 5min so a clock
// skew or stale env doesn't park the runtime indefinitely. Re-checks the
// pending shape after each cap so a rotation that lands mid-sleep is picked
// up promptly.
const PENDING_SLEEP_CAP_MS = 5 * 60_000;

// 401 ladder. The cached bearer may be stale (backend redeploy re-rolled
// the signing secret) — invalidate + back off rather than hammering /auth.
const AUTH_BACKOFF_MS = [5_000, 30_000, 300_000];

export async function runLive(
  cfg: AgentConfig,
  decide: DecideFn,
  opts: RunOptions = {},
): Promise<void> {
  const tokens = new TokenManager(cfg.baseUrl, cfg.agentId, cfg.apiKey, cfg.bearerToken, cfg.bearerExpiresAt);
  let lastSubmittedCycle = -1;
  let cyclesDone = 0;

  // State-transition gates: print one helpful line when the runtime enters
  // pending or recovers from a 401 storm, not once per cycle.
  type LoopState = 'init' | 'pending' | 'active' | 'auth_error';
  let lastState: LoopState = 'init';
  let authFailureCount = 0;

  while (true) {
    if (opts.signal?.aborted) return;
    if (opts.maxCycles !== undefined && cyclesDone >= opts.maxCycles) return;

    try {
      const token = await tokens.get();
      const snap = await fetchSnapshot(cfg.baseUrl, cfg.agentId, token, cfg.include);

      // JOIN_WINDOW path. The bearer the scaffolder wrote into .env.local
      // was minted before rotation, so /snapshot returns a pending shape
      // (HTTP 200) until the season flips. Sleep — no decision, no submit.
      if (isPendingSnapshot(snap)) {
        if (lastState !== 'pending') {
          const tail = snap.activatesAt
            ? `Runtime activates at ${snap.activatesAt}.`
            : 'Runtime activates at the next season rotation.';
          // eslint-disable-next-line no-console
          console.log(`[pending] Enrollment confirmed. ${tail}`);
          lastState = 'pending';
        }
        // Credentials are good (HTTP 200), so reset the 401 ladder.
        authFailureCount = 0;

        const activatesAtMs = snap.activatesAt ? Date.parse(snap.activatesAt) : NaN;
        const untilMs = Number.isFinite(activatesAtMs)
          ? Math.max(0, activatesAtMs - Date.now())
          : PENDING_SLEEP_CAP_MS;
        const wait = Math.min(PENDING_SLEEP_CAP_MS, Math.max(cfg.pollIntervalMs, untilMs));
        try { await sleep(wait, opts.signal); } catch { return; }
        continue;
      }

      // Active path. Announce recovery once if we just came out of a
      // pending or auth-error state.
      if (lastState !== 'active') {
        // eslint-disable-next-line no-console
        console.log('[active] Runtime active — polling for cycles.');
        lastState = 'active';
      }
      authFailureCount = 0;

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
      if (err instanceof ArenaError && err.status === 401) {
        // Cached bearer is stale (e.g. backend redeploy re-rolled the
        // signing secret, or a pending-bearer survived past its rotation).
        // Drop it so the next iteration's tokens.get() re-authenticates,
        // and back off so a persistent credential failure doesn't hammer
        // /auth at the poll cadence.
        tokens.invalidate();
        const backoff = AUTH_BACKOFF_MS[Math.min(authFailureCount, AUTH_BACKOFF_MS.length - 1)];
        authFailureCount += 1;
        if (lastState !== 'auth_error') {
          // eslint-disable-next-line no-console
          console.log(`[auth] credentials rejected — retrying in ${Math.round(backoff / 1000)}s`);
          lastState = 'auth_error';
        }
        try { await sleep(backoff, opts.signal); } catch { return; }
        continue;
      }
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
