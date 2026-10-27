# context-meter

A Claude Code mod that keeps the context window in view: a pane with a colored bar and the breakdown `/context` shows — tokens used of the window, each category (Messages, System tools, MCP tools, Memory files, Skills, …), the autocompact buffer and free space.

- Updates after every model response, after a compaction and after `/clear`.
- Also pins a one-line summary to the status line, e.g. `Context 146k/350k · 42%`.
- The percentage turns yellow at 70% and red at 85%.
- Figures are local estimates (no API calls), so they can differ slightly from `/context`.

If the pane doesn't open on its own (a narrow window or editor panel), run `/context-meter`.

## Install

At the prompt of a terminal session:

```
/plugin install context-meter --marketplace siavash-smf/context-meter
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```
claude plugin install context-meter --marketplace siavash-smf/context-meter
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `siavash-smf/context-meter`, then Add plugin.

Needs a recent Claude Code release with mod (function hooks) support.
