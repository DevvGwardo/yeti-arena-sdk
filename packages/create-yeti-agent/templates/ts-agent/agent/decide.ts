import type { Snapshot, Decision } from 'yetifi-arena-runtime';

// Stub: do nothing every cycle. Returning [] tells the runtime to skip
// submission; the agent holds whatever positions it already has. Replace
// the body with your real strategy. The server enforces a hard cap of 3
// decisions per cycle — keep returned arrays at length ≤ 3.
export default function decide(_snapshot: Snapshot): Decision[] {
  return [];
}
