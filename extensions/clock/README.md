# clock

Keeps a long-running agent's sense of time current. The host states the time
once, at session start, and a resident goes on reasoning from that notice.
This module adds a line like

```
[clock] Wednesday, 7 October 2026 at 15:14 (Europe/Madrid).
```

to the conversation when activity arrives (an incoming channel message or a
push event) and the local day changed or `everyMinutes` passed since the last
line. Quiet hours cost nothing, and there is at most one line per interval.

The line is an ordinary stored message, not a per-turn context injection, so
it doesn't re-anchor on every turn or disturb the prompt cache.

For: any long-lived resident. Written for [MiMo v2.6 Pro](../../models/mimo-v2-6-pro.md),
which judged "bedtime" from a notice written the night before.

## Use it

```json
"extensions": {
  "clock": {
    "kind": "module",
    "path": "../connectome-field-notes/extensions/clock/index.ts",
    "config": { "everyMinutes": 60 }
  }
}
```

| Config | Default | |
|---|---|---|
| `everyMinutes` | `60` | Minimum minutes between lines. `0` turns the module off. |
| `timeZone` | the recipe's `agent.timezone` | IANA zone for the line. |
| `hideZone` | `false` | Leave the zone name out of the line. |

It pairs well with a prompt line saying what `[clock]` lines are, and that
`time--now` gives the exact time when it matters.

## Tested

| | |
|---|---|
| Live | One Discord resident, MiMo v2.6 Pro, since 2026-09-24, on connectome-host 0.9.0 (`5c2baab`), agent-framework 0.17.0. Same logic, packaged here as a standalone module. |
| Checked | connectome-host main @ `e82a68e` (agent-framework 0.21.0), 2026-10-07: loaded through the host's `loadRecipe` → `loadExtensions` → factory path; a first message adds a line, a second within the hour doesn't, a push event an hour later does, other events are ignored. The host also booted with it (mock provider) and completed a turn. |

## What it does beyond the agent's process

Nothing. It reads the clock and keeps two numbers in its module state.
