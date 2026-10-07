# resident-window

The autobiographical strategy with three changes for a long-lived chat
resident. It registers a strategy type, `autobiographical-resident`.

1. **Segmentation by silence.** The stock chunker closes L1 chunks on size
   only, so one memory can fuse a late-night thread with the next morning's
   unrelated one. Here a chunk also closes at a quiet gap
   (`segmentGapMinutes`), once it holds `segmentMinTokens`. It uses stored
   timestamps, so imported history segments by its real times.
2. **Filler silences stay out of the live window** (`hideSilentTurns`). Every
   wake that ends in `skip_reply` leaves a turn in the verbatim tail. When
   ambient traffic wakes the agent often, those turns pile up and become the
   pattern: after about 40 in a row, one resident went on staying silent even
   when mentioned directly. A `>>skip_reply` turn with a short private body
   (200 characters or less), or a bare `skip_reply` call, is dropped together
   with its tool_result. Longer bodies are notes the agent meant to keep, so
   they stay.
3. **Discord reactions stay out of the live window** (`hideReactions`). A wake
   gate can stop `[reaction]` events from waking the agent, but they are still
   filed into context, and the next real wake arrives with a pile of them that
   the agent then comments on.

2 and 3 change only the compiled window. The store, the summaries and any
viewer keep everything, and the newest entry is never touched.

For: [MiMo v2.6 Pro](../../models/mimo-v2-6-pro.md) as a Discord resident,
where all three were needed. Nothing in it is model-specific.

## Use it

```json
"agent": {
  "strategy": {
    "type": "autobiographical-resident",
    "summaryParticipant": "<the agent's name>",
    "segmentGapMinutes": 60,
    "segmentMinTokens": 500,
    "hideSilentTurns": true,
    "hideReactions": true
  }
},
"extensions": {
  "resident-window": {
    "kind": "strategy",
    "path": "../connectome-field-notes/extensions/resident-window/index.ts"
  }
}
```

| Strategy key | Default | |
|---|---|---|
| `segmentGapMinutes` | `60` | Silence that ends a chunk. `0` turns segmentation off. |
| `segmentMinTokens` | `500` | Chunk size (about chars/4) needed before a gap may close it. |
| `hideSilentTurns` | `true` | Drop filler silences from the live window. |
| `hideReactions` | `false` | Drop `[reaction]` events from the live window. |

Every other key in `agent.strategy` goes to the autobiographical strategy as
usual. A custom strategy type doesn't get the host's defaults for the
built-in one, so this extension applies the same ones itself
(`headWindowTokens` 4000, `recentWindowTokens` 30000, `maxMessageTokens`
10000, adaptive resolution, `kv-stable`); the recipe can override them.

**Set `summaryParticipant` to the agent's name.** The host fills it in only
for the built-in type, and `hideSilentTurns` uses it to tell the agent's own
turns apart.

**Decide segmentation before the first fold.** Chunk boundaries are persisted
the first time they are computed and never recomputed. If you import history
and warm it up offline, warm it up with this same strategy.

## How it depends on the host

This one is not type-imports-only. It subclasses `AutobiographicalStrategy`
and overrides two protected hooks, `chunkBoundaryHint` and
`pruneToolEntries`, so a context-manager release can break it. Both hooks
exist with the same signatures in context-manager 0.10.1 and 0.13.0.

The runtime import of `@animalabs/context-manager` resolves from this file's
location first. If this checkout has its own `node_modules` (for example
after `npm install` for `npm run check`), the strategy uses that copy, which
may not be the version your host ships. Without one, Bun falls back to the
host's copy.

## Tested

| | |
|---|---|
| Live | One Discord resident, MiMo v2.6 Pro, on connectome-host 0.9.0 (`5c2baab`), context-manager 0.10.1: segmentation since 2026-09-23 (including a two-month offline warmup), `hideSilentTurns` since late September, `hideReactions` since early October. Same logic, without that deployment's other overrides. |
| Checked | connectome-host main @ `e82a68e` (agent-framework 0.21.0, context-manager 0.13.0), 2026-10-07: built through the host's own `buildFrameworkStrategy`; recipe keys and defaults reach the base class and the extension's own keys don't; gap boundaries; on a synthetic window, filler turns and their results, reaction-only entries and reaction blocks are dropped while long notes, speech and the newest entry stay. The host also booted with it (mock provider) and compiled and completed a turn. |

## What it does beyond the agent's process

Nothing.
