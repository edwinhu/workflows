import { describe, expect, test, setDefaultTimeout } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HERMETIC_ENV } from './helpers/hermetic-env'
import { useTmp } from './helpers/tmp.ts'
import { addSample, burnRate, forecast, type CreditsCache } from '../hooks/jev/forecast.ts'
import { registerJevForecast, setForecastCache } from '../hooks/jev/forecast-mod.ts'

/**
 * The Jev forecast band (user request 2026-10-03): `Jev $19.77 · $3.40/day · ~6 days` above the
 * prompt, from timestamped balance samples kept IN the credit-warn cache. The band reads that cache
 * only; every sample comes from the credit-warn script's hourly-gated read.
 */

const mkTmp = useTmp()
setDefaultTimeout(60_000)
const ROOT = join(import.meta.dir, '..')
const H = 3_600_000
const NOW = 1_791_041_110_107
const TOPUP = 'https://openrouter.ai/settings/credits'

/** Hourly samples spending `perHour` dollars an hour, ending at `end` with `last` dollars left. */
function spending(hours: number, perHour: number, last: number, end = NOW): CreditsCache {
  const samples: [number, number][] = []
  for (let i = hours; i >= 0; i--) samples.push([end - i * H, +(last + i * perHour).toFixed(6)])
  return { checkedAt: end, balance: last, samples }
}

describe('forecast: the line from a stubbed cache', () => {
  test('healthy: balance, burn rate and days left, not a warning', () => {
    const v = forecast(spending(24, 3.4 / 24, 19.77), NOW, 3)
    expect(v).toEqual({ level: 'ok', text: 'Jev $19.77 · $3.40/day · ~6 days' })
  })

  test('low: under three days left is a warning', () => {
    const v = forecast(spending(24, 10 / 24, 19.77), NOW, 3)
    expect(v).toEqual({ level: 'warn', text: 'Jev $19.77 · $10.00/day · ~2 days' })
  })

  test('low: under the credit-warn threshold is a warning however slow the burn', () => {
    const v = forecast(spending(24, 0.5 / 24, 2.5), NOW, 3)
    expect(v).toEqual({ level: 'warn', text: 'Jev $2.50 · $0.50/day · ~5 days' })
  })

  test('under a day left counts hours', () => {
    expect(forecast(spending(24, 1, 6), NOW, 3)?.text).toBe('Jev $6.00 · $24.00/day · ~6h')
  })

  test('out: at or below $0 is the top-up line', () => {
    const out = { level: 'out', text: `Jev OUT OF CREDITS — top up at ${TOPUP} (balance -$0.24)` }
    expect(forecast(spending(24, 1, -0.24), NOW, 3)).toEqual(out)
    // an empty account needs no rate: one sample is enough to say so
    expect(forecast({ checkedAt: NOW, balance: -0.24, samples: [[NOW, -0.24]] }, NOW, 3)).toEqual(out)
  })

  test('too few samples: nothing, never a false "0 days"', () => {
    expect(forecast({ checkedAt: NOW, balance: 19.77, samples: [[NOW, 19.77]] }, NOW, 3)).toBeNull()
    // two samples an hour apart do not make a rate
    expect(forecast(spending(1, 0.2, 19.77), NOW, 3)).toBeNull()
    // the cache as credit-warn wrote it before this change: no samples at all
    expect(forecast({ checkedAt: NOW, balance: 19.77 }, NOW, 3)).toBeNull()
    expect(forecast(null, NOW, 3)).toBeNull()
  })

  test('stale cache: an old sample is labelled; one past a day shows nothing', () => {
    const c = spending(24, 3.4 / 24, 19.77, NOW - 5 * H)
    expect(forecast(c, NOW, 3)?.text).toBe('Jev $19.77 · $3.40/day · ~6 days · as of 5h ago')
    expect(forecast(spending(24, 3.4 / 24, 19.77, NOW - 25 * H), NOW, 3)).toBeNull()
    expect(forecast(spending(24, 1, -0.24, NOW - 25 * H), NOW, 3)).toBeNull()
  })

  test('a failed last read (balance null) forecasts from the newest sample', () => {
    const c = { ...spending(24, 3.4 / 24, 19.77, NOW - 2 * H), checkedAt: NOW, balance: null }
    expect(forecast(c, NOW, 3)?.text).toBe('Jev $19.77 · $3.40/day · ~6 days · as of 2h ago')
  })

  test('no spend in the window: the rate is $0.00/day and no days are claimed', () => {
    expect(forecast(spending(24, 0, 19.77), NOW, 3)).toEqual({ level: 'ok', text: 'Jev $19.77 · $0.00/day' })
  })
})

describe('burnRate', () => {
  test('a top-up is not negative spend: its interval drops out of the rate', () => {
    // spend $1/h for 6h, top up +$20 inside one hour, spend $1/h for 6 more
    const s: [number, number][] = []
    for (let i = 0; i <= 6; i++) s.push([NOW - (13 - i) * H, 10 - i])
    for (let i = 0; i <= 6; i++) s.push([NOW - (6 - i) * H, 24 - i])
    expect(burnRate(s)!.perDay).toBeCloseTo(24, 6)
  })

  test('trailing 24h window, widening to the kept week only when the day is too thin', () => {
    // $2/h until 30h ago, then $0.5/h: the 24h rate sees only the recent burn
    let b = 100
    const t: [number, number][] = []
    for (let i = 48; i >= 0; i--) { t.push([NOW - i * H, b]); b -= i > 30 ? 2 : 0.5 }
    expect(burnRate(t)!.perDay).toBeCloseTo(12, 6)
    // only one sample in the last day (sessions were sparse): the week's samples carry the rate
    const sparse: [number, number][] = [[NOW - 50 * H, 30], [NOW - 40 * H, 25], [NOW - 30 * H, 20], [NOW, 5]]
    expect(burnRate(sparse)!.perDay).toBeCloseTo(12, 6)
  })

  test('addSample keeps a week and at most 200 samples', () => {
    let s: [number, number][] = [[NOW - 8 * 24 * H, 50]]
    s = addSample(s, NOW, 10)
    expect(s).toEqual([[NOW, 10]])
    for (let i = 0; i < 250; i++) s = addSample(s, NOW + i * 60_000, 10)
    expect(s.length).toBe(200)
  })
})

describe('the credit-warn cache carries the samples (no second state file)', () => {
  test('each real read appends one sample; a cached read appends none; a failed read appends none', async () => {
    const dir = mkTmp('or-forecast-')
    let reply = { status: 200, body: JSON.stringify({ data: { total_credits: 30, total_usage: 10.23 } }) }
    let hits = 0
    const server = Bun.serve({ port: 0, fetch: () => { hits++; return new Response(reply.body, { status: reply.status }) } })
    try {
      const run = async (...args: string[]) => {
        const p = Bun.spawn(['bun', 'scripts/lib/openrouter-credits.ts', ...args], {
          cwd: ROOT, stdout: 'pipe', stderr: 'pipe',
          env: { ...HERMETIC_ENV, TMPDIR: dir, XDG_RUNTIME_DIR: '/nonexistent', WORK_HOLD_JUDGE_TOKEN: 'test-token', OPENROUTER_CREDITS_URL: `http://127.0.0.1:${server.port}/api/v1/credits` },
        })
        await p.exited
      }
      const cache = () => JSON.parse(readFileSync(join(dir, 'openrouter-credits.json'), 'utf8'))
      await run('--sample')
      expect(hits).toBe(1)
      expect(cache().samples.map((x: number[]) => x[1])).toEqual([19.77])
      await run('--sample')
      await run('--session')
      expect(hits).toBe(1) // inside the hour: the cache answers, no sample added
      expect(cache().samples.length).toBe(1)
      // an hour-old cache: the next read is real and adds a sample
      writeFileSync(join(dir, 'openrouter-credits.json'), JSON.stringify({ ...cache(), checkedAt: Date.now() - H - 1 }))
      reply = { status: 200, body: JSON.stringify({ data: { total_credits: 30, total_usage: 10.5 } }) }
      await run('--sample')
      expect(hits).toBe(2)
      expect(cache().samples.map((x: number[]) => x[1])).toEqual([19.77, 19.5])
      writeFileSync(join(dir, 'openrouter-credits.json'), JSON.stringify({ ...cache(), checkedAt: Date.now() - H - 1 }))
      reply = { status: 500, body: '{}' }
      await run('--sample')
      expect(hits).toBe(3)
      expect(cache().balance).toBeNull()
      expect(cache().samples.length).toBe(2) // kept, not wiped by the failed read
    } finally {
      server.stop(true)
    }
  })

  test('a cache from before samples seeds them with its one real reading', async () => {
    const dir = mkTmp('or-forecast-')
    const server = Bun.serve({ port: 0, fetch: () => new Response(JSON.stringify({ data: { total_credits: 30, total_usage: 11 } })) })
    try {
      const then = Date.now() - 2 * H
      writeFileSync(join(dir, 'openrouter-credits.json'), JSON.stringify({ checkedAt: then, balance: 19.25, notifiedOn: '2026-10-03' }))
      const p = Bun.spawn(['bun', 'scripts/lib/openrouter-credits.ts', '--sample'], {
        cwd: ROOT, stdout: 'pipe', stderr: 'pipe',
        env: { ...HERMETIC_ENV, TMPDIR: dir, XDG_RUNTIME_DIR: '/nonexistent', WORK_HOLD_JUDGE_TOKEN: 'test-token', OPENROUTER_CREDITS_URL: `http://127.0.0.1:${server.port}/api/v1/credits` },
      })
      await p.exited
      const c = JSON.parse(readFileSync(join(dir, 'openrouter-credits.json'), 'utf8'))
      expect(c.samples.map((x: number[]) => x[1])).toEqual([19.25, 19])
      expect(c.samples[0][0]).toBe(then)
      expect(c.notifiedOn).toBe('2026-10-03')
    } finally {
      server.stop(true)
    }
  })

  test('`off` writes nothing and --sample stays silent', async () => {
    const dir = mkTmp('or-forecast-')
    const p = Bun.spawn(['bun', 'scripts/lib/openrouter-credits.ts', '--sample'], {
      cwd: ROOT, stdout: 'pipe', stderr: 'pipe', env: { ...HERMETIC_ENV, TMPDIR: dir, OPENROUTER_CREDITS_URL: 'off' },
    })
    expect(await p.exited).toBe(0)
    expect(await new Response(p.stdout).text()).toBe('')
  })
})

describe('the band, through the mod', () => {
  type Hook = (...a: any[]) => any
  function harness(cacheText: string | null, env: Record<string, string> = {}) {
    const hooks: Record<string, Hook> = {}
    registerJevForecast(((event: string, a: unknown, b?: Hook) => { hooks[event] = (b ?? a) as Hook }) as any)
    const runs: string[][] = []
    const timers: number[] = []
    const vars: Record<string, string> = { TMPDIR: '/tmpx', ...env }
    let invalidated = 0
    const $ = {
      env: { get: async (k: string) => vars[k] },
      plugin: { root: '/plugin' },
      clock: { now: async () => NOW, every: (ms: number) => { timers.push(ms); return { cancel() {} } } },
      process: { run: async (argv: string[]) => { runs.push(argv); return { exitCode: 0, stdout: '', stderr: '' } } },
      fs: { read: async (p: string) => { if (p !== '/tmpx/openrouter-credits.json' || cacheText === null) throw new Error('ENOENT'); return cacheText } },
      ui: {
        invalidate: () => { invalidated++ },
        resolve: () => ({ Box: (p: any) => ({ type: 'Box', props: p }), Text: (p: any) => ({ type: 'Text', props: p }) }),
      },
    }
    return { hooks, $, runs, timers, cacheText, invalidated: () => invalidated }
  }
  // the watcher's forecast tick hands the parsed cache over; tested under the engine in
  // hooks/mod-tests/watcher.test.ts
  const start = async (h: ReturnType<typeof harness>) => setForecastCache(h.cacheText === null ? null : JSON.parse(h.cacheText))
  const render = (h: ReturnType<typeof harness>, inner: any = { type: 'engine', ref: 0 }, props: any = {}) =>
    h.hooks['ui.render'](h.$, { props: { hasSurvey: false, ...props } }, async () => inner)

  test('healthy: one dim line; the engine draws nothing else', async () => {
    const h = harness(JSON.stringify(spending(24, 3.4 / 24, 19.77)))
    await start(h)
    const t = await render(h)
    expect(JSON.stringify(t)).toContain('Jev $19.77 · $3.40/day · ~6 days')
    expect(JSON.stringify(t)).toContain('"dimColor":true')
    // the render itself runs nothing and reads no file
    expect(h.runs).toEqual([])
  })

  test('low and out: warning colours', async () => {
    const low = harness(JSON.stringify(spending(24, 10 / 24, 19.77)))
    await start(low)
    expect(JSON.stringify(await render(low))).toContain('"color":"yellow"')
    const out = harness(JSON.stringify(spending(24, 1, -0.24)))
    await start(out)
    const t = JSON.stringify(await render(out))
    expect(t).toContain('OUT OF CREDITS — top up')
    expect(t).toContain('"color":"red"')
  })

  test('too few samples, no cache, stale cache: the band passes to the rest of the chain', async () => {
    const inner = { type: 'engine', ref: 0 }
    for (const text of [JSON.stringify({ checkedAt: NOW, balance: 19.77 }), null, JSON.stringify(spending(24, 1, 5, NOW - 30 * H))]) {
      const h = harness(text)
      await start(h)
      expect(await render(h, inner)).toBe(inner)
    }
  })

  test('another band below (bulk-guard) is kept, under the forecast line', async () => {
    const h = harness(JSON.stringify(spending(24, 3.4 / 24, 19.77)))
    await start(h)
    const bulk = { type: 'Box', props: { children: [{ type: 'Text', props: { children: 'docs read 2/10' } }] } }
    const t = await render(h, bulk)
    expect(t.props.flexDirection).toBe('column')
    expect(t.props.children[1]).toBe(bulk)
  })

  test('a survey holds the band', async () => {
    const h = harness(JSON.stringify(spending(24, 3.4 / 24, 19.77)))
    await start(h)
    expect(await render(h, 'inner', { hasSurvey: true })).toBe('inner')
  })

  test('the tick starts from the watcher\'s session.start, behind its interactive and farm-child gate', () => {
    // The engine takes one session.start hook per module (a second is a load error) and follows `$`
    // into no imported function, so the tick lives in the watcher, behind the gate headless sessions fail.
    const src = readFileSync(join(ROOT, 'hooks/watch/watcher.ts'), 'utf8')
    const body = src.slice(src.indexOf("on('session.start'"), src.indexOf("on('command.run'"))
    expect(body.indexOf("FARM_OUT_CHILD")).toBeGreaterThan(-1)
    expect(body.indexOf('forecastTick($)')).toBeGreaterThan(body.indexOf('FARM_OUT_CHILD'))
  })
})
