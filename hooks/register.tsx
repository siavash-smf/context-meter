import type { EngineInterface, Register, SessionContextBreakdown } from 'claude-code'

const PANE = 'context-meter'
const TITLE = 'Context'

// Fixed colors per category: the theme's own keys draw almost all of them
// grey in the editor. A name not listed takes the next of SPARE.
const COLORS: Record<string, string> = {
  Messages: '#D97757',
  'System tools': '#4F7DF3',
  'MCP tools': '#3FA45B',
  'Memory files': '#E3A72F',
  Skills: '#9D6CF5',
  'System prompt': '#20B2AA',
  'MCP server instructions': '#8BC34A',
  'Custom agents': '#EC6FA9',
}
const SPARE = ['#5AC8FA', '#FF9F0A', '#BF5AF2', '#FFD60A', '#FF6482', '#64D2FF']
const FREE = '#8E8E93'

function colorsOf(names: string[]): string[] {
  let spare = 0

  return names.map(name => COLORS[name] ?? SPARE[spare++ % SPARE.length] ?? FREE)
}

// 1000000 -> "1M", 146000 -> "146k", 1530 -> "1.5k", 820 -> "820".
function k(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (tokens < 1000) return String(Math.round(tokens))
  const digits = tokens < 10_000 ? 1 : 0

  return `${(tokens / 1000).toFixed(digits).replace(/\.0$/, '')}k`
}

// The bar as one SVG for the surfaces that draw one: a solid run per
// category, then free space faint and the compaction buffer a shade darker.
function barSvg(segments: { tokens: number; color: string }[], free: number, buffer: number): string {
  const W = 4000
  const H = 40
  const total = segments.reduce((sum, s) => sum + s.tokens, 0) + free + buffer
  if (total <= 0) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"/>`
  let x = 0
  const rects: string[] = []
  const add = (tokens: number, fill: string, opacity = 1) => {
    const w = (tokens / total) * W
    if (w <= 0) return
    rects.push(
      `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" fill="${fill}" fill-opacity="${opacity}"/>`,
    )
    x += w
  }
  for (const s of segments) add(s.tokens, s.color)
  add(free, FREE, 0.18)
  add(buffer, FREE, 0.45)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="none">` +
    `<clipPath id="r"><rect width="${W}" height="${H}" rx="8"/></clipPath>` +
    `<g clip-path="url(#r)">${rects.join('')}</g></svg>`
  )
}

// Splits `width` cells among the sizes by largest remainder, so the bar is
// always exactly `width` wide.
function cells(sizes: number[], width: number): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0)
  if (sum <= 0) return sizes.map(() => 0)
  const exact = sizes.map(size => (size / sum) * width)
  const out = exact.map(Math.floor)
  let left = width - out.reduce((a, b) => a + b, 0)
  const order = exact
    .map((value, i) => ({ i, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac)
  for (const { i } of order) {
    if (left <= 0) break
    out[i] = (out[i] ?? 0) + 1
    left -= 1
  }

  return out
}

// The breakdown /context draws, estimated locally: no API call is sent.
async function breakdownOf($: EngineInterface): Promise<SessionContextBreakdown | undefined> {
  const usage = await $.session.usage({ breakdown: 'summary' })

  return usage.context.breakdown
}

// Pins a one-line summary as the status line and redraws the pane, which
// reads the breakdown afresh as it draws.
async function refresh($: EngineInterface): Promise<void> {
  const breakdown = await breakdownOf($)
  if (breakdown) {
    const { totalTokens, rawMaxTokens, percentage } = breakdown
    $.ui.status(`Context ${k(totalTokens)}/${k(rawMaxTokens)} · ${percentage}%`)
  }
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'context-meter',
      description: 'Show the context window breakdown in a pane',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    await refresh($)

    return started
  })

  on('command.run', { command: 'context-meter' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await refresh($)

    return { text: 'Context pane opened.' }
  })

  // Raised after each model response that moved the window's fill.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.changed.includes('context')) await refresh($)

    return result
  })

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    await refresh($)

    return compacted
  })

  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear') await refresh($)

    return ended
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // The terminal has no Svg: it draws the bar in block characters.
    const Svg = 'Svg' in table ? table.Svg : undefined
    const breakdown = await breakdownOf($)

    if (!breakdown) {
      return <Text dimColor>Measuring the context window…</Text>
    }

    const used = breakdown.categories
      .filter(row => row.kind === 'used' && row.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens)
    const buffer = breakdown.categories.find(row => row.kind === 'buffer')
    const free = breakdown.categories.find(row => row.kind === 'free')
    const usedTokens = used.reduce((sum, row) => sum + row.tokens, 0)
    const bufferTokens = buffer?.tokens ?? 0
    const freeTokens =
      free?.tokens ?? Math.max(0, breakdown.rawMaxTokens - usedTokens - bufferTokens)
    const colors = colorsOf(used.map(row => row.name))

    const width = Math.max(10, e.props.bodyColumns - 1)
    const widths = cells([...used.map(row => row.tokens), freeTokens, bufferTokens], width)
    const freeCells = widths[used.length] ?? 0
    const bufferCells = widths[used.length + 1] ?? 0

    const percent = breakdown.percentage
    const percentColor = percent >= 85 ? 'error' : percent >= 70 ? 'warning' : undefined

    return (
      <Box flexDirection="column" gap={1}>
        <Text>
          <Text bold>Context</Text>
          <Text dimColor>
            {'  '}
            {k(breakdown.totalTokens)} of {k(breakdown.rawMaxTokens)}
            {'  '}
          </Text>
          <Text color={percentColor} dimColor={percentColor === undefined}>
            {percent}%
          </Text>
        </Text>

        {Svg ? (
          <Svg
            source={barSvg(
              used.map((row, i) => ({ tokens: row.tokens, color: colors[i] ?? FREE })),
              freeTokens,
              bufferTokens,
            )}
            alt={`Context: ${k(breakdown.totalTokens)} of ${k(breakdown.rawMaxTokens)} used`}
            height={14}
          />
        ) : (
          <Text wrap="truncate">
            {used.map((row, i) => (
              <Text color={colors[i]}>{'█'.repeat(widths[i] ?? 0)}</Text>
            ))}
            <Text dimColor>{'░'.repeat(freeCells)}</Text>
            <Text color={FREE}>{'▒'.repeat(bufferCells)}</Text>
          </Text>
        )}

        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {used.map((row, i) => (
            <Text>
              <Text color={colors[i]}>■</Text> {row.name} <Text dimColor>{k(row.tokens)}</Text>
            </Text>
          ))}
        </Box>

        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>
            {buffer ? (
              <Text>
                <Text color={FREE}>■</Text> {buffer.name} {k(bufferTokens)}
                {'   '}
              </Text>
            ) : null}
            <Text dimColor>□</Text> {free?.name ?? 'Free'} {k(freeTokens)}
          </Text>
          <Button key="refresh" label="Refresh" plain onPress={() => refresh($)} />
        </Box>
      </Box>
    )
  })
}
