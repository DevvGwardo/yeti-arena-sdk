import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import { BUNDLED_STYLES, mergeCatalog, personaMarkdown, styleIds } from '../src/styles';

const RUNTIME_TYPES = path.resolve(__dirname, '../../arena-runtime-ts/src/types.ts');
const VALID_ACTIONS = ['LONG', 'SHORT', 'FLAT'];

type DecideFn = (s: unknown) => Promise<Array<{ symbol: string; action: string; positionSizePercent: number; reason: string }>>;

function coin(price: number, analysis?: Record<string, unknown>) {
  return { price, ...(analysis ? { analysis } : {}) };
}

function snapshot(coins: Record<string, unknown>) {
  return { agentId: 'a', name: 'n', tier: 'free', status: 'ACTIVE', coins, portfolio: {}, recentDecisions: [], recentTrades: [] };
}

// Strong, aligned signals on several coins: trips every style at least once.
const HOT = snapshot({
  UPCOIN: coin(100, { trend: 'STRONG_UP', priceChange1m: 0.5, priceChange5m: 1.2, priceChange15m: 1.5, priceChange30m: 1.1, priceChange1h: 0.9, volatility: 1.0 }),
  UP2: coin(50, { trend: 'UP', priceChange1m: 0.3, priceChange5m: 0.5, priceChange15m: 0.6, priceChange30m: 0.2, priceChange1h: 0.2, volatility: 2 }),
  DOWNCOIN: coin(10, { trend: 'STRONG_DOWN', priceChange1m: -0.4, priceChange5m: -1.0, priceChange15m: -1.4, priceChange30m: -1.0, priceChange1h: -0.8, volatility: 1.2 }),
  DOWN2: coin(20, { trend: 'DOWN', priceChange1m: -0.3, priceChange5m: -0.6, priceChange15m: -0.9, priceChange30m: -0.6, priceChange1h: -0.5, volatility: 2 }),
  TOPPED: coin(99, { trend: 'NEUTRAL', recentHigh: 100, recentLow: 80, priceChange5m: 0.5, volatility: 1 }),
  BOTTOMED: coin(81, { trend: 'NEUTRAL', recentHigh: 100, recentLow: 80, priceChange5m: -0.5, volatility: 1 }),
  WILD: coin(5, { trend: 'STRONG_UP', priceChange5m: 9, priceChange15m: 9, priceChange1h: 9, volatility: 12 }),
});

describe('bundled styles', () => {
  test('exposes the four Python style ids in order', () => {
    expect(styleIds()).toEqual(['momentum', 'mean_reversion', 'conservative', 'degen']);
  });

  test('personas match the Python presets', () => {
    const py = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../create-yeti-agent-py/styles/fallback.json'), 'utf8'),
    ).styles as Array<{ id: string; label: string; blurb: string; persona: string }>;
    for (const p of py) {
      const b = BUNDLED_STYLES.find((s) => s.id === p.id)!;
      expect(b).toBeDefined();
      expect(b.label).toBe(p.label);
      expect(b.blurb).toBe(p.blurb);
      expect(b.persona).toBe(p.persona);
    }
  });

  test('persona markdown names the agent', () => {
    expect(personaMarkdown('bot-1', 'hi')).toContain('# bot-1');
  });
});

describe.each(BUNDLED_STYLES.map((s) => [s.id, s] as const))('style %s', (_id, style) => {
  let tmp: string;
  let decide: DecideFn;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yeti-style-'));
    const file = path.join(tmp, 'decide.ts');
    fs.writeFileSync(file, style.decideTs);

    // 1. Type-check the generated source against the real runtime types, strict.
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      esModuleInterop: true,
      types: [],
      baseUrl: tmp,
      paths: { 'yetifi-arena-runtime': [RUNTIME_TYPES] },
    };
    const program = ts.createProgram([file], options);
    const diags = ts.getPreEmitDiagnostics(program).filter((d) => !d.file || d.file.fileName === file);
    const msgs = diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(msgs).toEqual([]);

    // 2. Transpile (type import is erased) and load the module.
    const js = ts.transpileModule(style.decideTs, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const jsFile = path.join(tmp, 'decide.js');
    fs.writeFileSync(jsFile, js);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    decide = require(jsFile).default;
  });

  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test('returns valid, capped decisions for a hot snapshot', async () => {
    const out = await decide(HOT);
    expect(out.length).toBeGreaterThan(0);
    const max = style.id === 'conservative' ? 2 : 3;
    expect(out.length).toBeLessThanOrEqual(max);
    const seen = new Set<string>();
    for (const d of out) {
      expect(VALID_ACTIONS).toContain(d.action);
      expect(d.symbol in HOT.coins).toBe(true);
      expect(seen.has(d.symbol)).toBe(false);
      seen.add(d.symbol);
      expect(Number.isFinite(d.positionSizePercent)).toBe(true);
      expect(d.positionSizePercent).toBeGreaterThan(0);
      expect(d.positionSizePercent).toBeLessThanOrEqual(100);
      expect(d.reason.length).toBeGreaterThan(0);
      expect(d.reason.length).toBeLessThanOrEqual(280);
    }
    // Every style except degen filters out the high-volatility WILD coin.
    if (style.id !== 'degen') expect(out.map((d) => d.symbol)).not.toContain('WILD');
  });

  test('holds on missing / malformed data', async () => {
    expect(await decide(snapshot({}))).toEqual([]);
    expect(await decide(snapshot({ BTC: coin(100) }))).toEqual([]);
    expect(await decide(snapshot({ BTC: coin(100, {}) }))).toEqual([]);
    expect(await decide(snapshot({ BTC: coin(100, { trend: null, priceChange15m: null, priceChange5m: 'x' }) }))).toEqual([]);
    expect(await decide(snapshot({ BTC: null, ETH: 5 }))).toEqual([]);
    expect(await decide({ ...snapshot({}), coins: undefined })).toEqual([]);
  });
});

describe('style rules (spot checks against the Python logic)', () => {
  const load = (id: string): DecideFn => {
    const js = ts.transpileModule(BUNDLED_STYLES.find((s) => s.id === id)!.decideTs, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const m = { exports: {} as { default?: DecideFn } };
    new Function('module', 'exports', 'require', js)(m, m.exports, require);
    return m.exports.default!;
  };

  test('momentum: LONG strongest first, size 12', async () => {
    const out = await load('momentum')(HOT);
    expect(out[0]).toMatchObject({ symbol: 'UPCOIN', action: 'LONG', positionSizePercent: 12 });
    expect(out.find((d) => d.symbol === 'DOWNCOIN')?.action).toBe('SHORT');
  });

  test('mean_reversion: SHORT near high, LONG near low, size 10', async () => {
    const out = await load('mean_reversion')(HOT);
    expect(out.find((d) => d.symbol === 'TOPPED')).toMatchObject({ action: 'SHORT', positionSizePercent: 10 });
    expect(out.find((d) => d.symbol === 'BOTTOMED')).toMatchObject({ action: 'LONG' });
  });

  test('conservative: needs STRONG trend + alignment, size 6, max 2', async () => {
    const out = await load('conservative')(HOT);
    expect(out.map((d) => d.symbol).sort()).toEqual(['DOWNCOIN', 'UPCOIN']);
    expect(out.every((d) => d.positionSizePercent === 6)).toBe(true);
  });

  test('degen: size 22, chases short-horizon pops and dumps, ignores volatility', async () => {
    const out = await load('degen')(HOT);
    expect(out.every((d) => d.positionSizePercent === 22)).toBe(true);
    expect(out[0].symbol).toBe('WILD'); // 9% 5m move scores highest; no vol filter
  });
});

describe('mergeCatalog', () => {
  test('non-array -> bundled', () => expect(mergeCatalog(undefined)).toBe(BUNDLED_STYLES));

  test('today\'s catalog (decidePy only) keeps bundled decideTs', () => {
    const out = mergeCatalog([{ id: 'degen', label: 'Degen', blurb: 'b', persona: 'p', decidePy: 'x' }]);
    expect(out.find((s) => s.id === 'degen')!.decideTs).toBe(BUNDLED_STYLES.find((s) => s.id === 'degen')!.decideTs);
    expect(styleIds(out).sort()).toEqual(styleIds().sort());
  });

  test('remote decideTs is preferred; unknown remote id without decideTs is dropped', () => {
    const out = mergeCatalog([
      { id: 'momentum', decideTs: '// remote' },
      { id: 'brandnew', label: 'New', decidePy: 'x' },
      { id: 'brandnew2', label: 'New2', decideTs: '// new2' },
    ]);
    expect(out.find((s) => s.id === 'momentum')!.decideTs).toBe('// remote');
    expect(out.find((s) => s.id === 'brandnew')).toBeUndefined();
    expect(out.find((s) => s.id === 'brandnew2')!.decideTs).toBe('// new2');
  });
});
