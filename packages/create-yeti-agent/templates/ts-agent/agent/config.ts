import { defineAgent } from '@yetifi/arena-runtime';
import decide from './decide';

export default defineAgent({
  decide,
  config: {
    pollIntervalMs: 15_000,
    model: 'custom',
    include: ['analysis'],
  },
});
