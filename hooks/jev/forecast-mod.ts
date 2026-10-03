// The Jev forecast band, above the prompt: `Jev $19.77 · $3.40/day · ~6 days` (hooks/jev/forecast.ts).
//
//   tick     hooks/watch/watcher.ts forecastTick, every 10 min from the watcher's session.start (the
//            engine takes ONE session.start per module; interactive sessions only, never a farm child):
//            `openrouter-credits.ts --sample`, which reads the API only when the credit-warn cache is
//            an hour old (never more than credit-warn's one call an hour, shared by every session),
//            then one read of that cache, handed here through setForecastCache
//   render   memory only, never the network or a file: yellow when under 3 days or under
//            $OPENROUTER_LOW_BALANCE, red OUT OF CREDITS at <= $0; nothing on too few or stale samples
//
// Registered outermost of the AbovePrompt hooks so the band stacks on bulk-guard's instead of hiding it.
import type { On, RenderElement } from 'claude-code'
import { forecast, type CreditsCache } from './forecast.ts'

// Set by the watcher's forecast tick (hooks/watch/watcher.ts); the engine follows `$` into no
// function across an import, so the tick, which needs `$`, lives there and hands the parsed cache here.
let cache: CreditsCache | null = null

export function setForecastCache(c: unknown): void {
  cache = typeof (c as CreditsCache | null)?.checkedAt === 'number' ? (c as CreditsCache) : null
}

export function registerJevForecast(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    if (e.props.hasSurvey) return inner
    // credit-warn's threshold, read as scripts/lib/openrouter-credits.ts reads it
    const raw = await $.env.get('OPENROUTER_LOW_BALANCE')
    const t = raw ? Number(raw) : NaN
    const v = forecast(cache, await $.clock.now(), Number.isFinite(t) ? t : 3)
    if (!v) return inner
    const { Box, Text } = $.ui.resolve(e)
    const line = Box({
      paddingX: 1,
      children: [
        v.level === 'ok'
          ? Text({ dimColor: true, children: v.text })
          : Text({ color: v.level === 'out' ? 'red' : 'yellow', bold: v.level === 'out', children: v.text }),
      ],
    }) as RenderElement
    if ((inner as { type?: string } | undefined)?.type === 'engine') return line
    return Box({ flexDirection: 'column', children: [line, inner] }) as RenderElement
  })
}
