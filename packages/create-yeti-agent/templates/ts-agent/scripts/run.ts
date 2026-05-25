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
