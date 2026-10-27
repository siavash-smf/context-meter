import type { SessionContextBreakdown } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'context-meter',
  component: 'Pane',
  requestId: 'context-meter',
  props: {
    title: 'Context',
    isFocused: false,
    bodyColumns: 60,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const BREAKDOWN: SessionContextBreakdown = {
  autocompactSource: 'model-default',
  gridRows: [],
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  isAutoCompactEnabled: true,
  apiUsage: null,
  totalTokens: 146_000,
  maxTokens: 350_000,
  rawMaxTokens: 350_000,
  percentage: 42,
  model: 'claude-opus-5-5',
  categories: [
    { name: 'Messages', tokens: 52_000, color: 'claude', isDeferred: false, kind: 'used' },
    { name: 'System tools', tokens: 28_000, color: 'inactive', isDeferred: false, kind: 'used' },
    { name: 'MCP tools', tokens: 24_000, color: 'success', isDeferred: false, kind: 'used' },
    { name: 'MCP tools (deferred)', tokens: 90_000, color: 'inactive', isDeferred: true, kind: 'deferred' },
    { name: 'Free space', tokens: 171_000, color: 'subtle', isDeferred: false, kind: 'free' },
    { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
  ],
}

test('with no breakdown yet the pane says it is measuring', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 350_000 }, rateLimits: [] } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })

  expect((await ui.find({ type: 'Text' }))?.text).toBe('Measuring the context window…')
  await ui.unmount()
})

test('the pane draws the breakdown on every surface', async ($, on) => {
  // Nothing sits beneath the plugin: each hook here stands for the engine.
  on('command.register', () => ({ value: { command: 'context-meter' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 350_000, tokens: 146_000, percent: 42, breakdown: BREAKDOWN },
      rateLimits: [],
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'vscode', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ type: 'Text', text: /146k of 350k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Messages 52k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Free space 171k/ })).toBeDefined()
    // The terminal has no Svg; every other surface draws the bar as one.
    const bar = await ui.find({ type: 'Svg' })
    if (surface === 'terminal') expect(bar).toBeUndefined()
    else expect(bar).toBeDefined()
    // A deferred row stays out of the window, as /context leaves it out.
    expect(await ui.find({ type: 'Text', text: /deferred/ })).toBeUndefined()
    await ui.unmount()
  }
})
