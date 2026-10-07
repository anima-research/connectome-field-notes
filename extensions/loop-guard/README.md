# loop-guard

Ends a turn that is going round in circles. The guard watches the
framework's trace stream, counts each turn's tool-call rounds, and when a
turn trips a limit, stops it and leaves the agent a note saying why.

Three limits, each optional:

| Config | Default | Trips when |
|---|---|---|
| `maxIdenticalRounds` | `4` | The same call(s), with the same input, are made this many rounds in a row. |
| `streaks` | `{ "think": 8 }` | This many rounds in a row call only the named tool, whatever the input. Use it for a tool that can't end a turn by itself, such as `think`. |
| `maxRoundsPerTurn` | `40` | The turn reaches this many tool-call rounds, of any kind. |

`0` disables a limit. Setting `streaks` replaces the default, so
`"streaks": {}` turns streak checks off.

## Why

Older models in particular can get stuck re-inferring with no exit: reasoning
in `think` round after round without ever replying or acting, or repeating a
status check forever. The rounds in a turn are uncapped: membrane's streaming
path leaves the cap to its caller by design, and agent-framework doesn't set
one. So such a turn runs until someone notices. This is a backstop, not a fix for
whatever confused the model; see the model notes for that.

It is model-independent, and on a healthy model it should never trip. Raise
the limits if your agent legitimately runs long tool chains.

## Use it

Add this to your recipe, with `path` relative to the recipe file:

```json
"extensions": {
  "loop-guard": {
    "kind": "module",
    "path": "../connectome-field-notes/extensions/loop-guard/index.ts",
    "config": { "maxRoundsPerTurn": 40, "maxIdenticalRounds": 4, "streaks": { "think": 8 } }
  }
}
```

Tool names are as they appear in the agent's tool list: built-in channel
tools are bare (`think`, `skip_reply`), module tools are prefixed
(`workspace--read`).

## What happens when it trips

- The framework's public `abortInference` ends the turn.
- The tool calls of the round that tripped the limit still run, but their
  results are dropped.
- The agent gets a note for its next turn, e.g. *"[Your previous turn was
  stopped automatically: 8 rounds in a row called only think. If you were
  stuck, try a different approach, or just reply.]"*. The note does not wake
  the agent.
- An ops alert is raised (`failures.log`, the `ops:alert` trace, and the ops
  webhook if one is configured).

Counting runs from a turn's first round until the turn ends. Framework
restarts inside a turn (retries, context-budget restarts) don't reset it, so
a long loop can't escape the guard by growing the context.

## Not included

An earlier, forked version first rewrote the looping tool's result with a
warning ("answer now, or use a concrete tool") and only ended the turn at a
higher cap. An extension can't rewrite a built-in tool's result, so this
version only ends turns. A softer warning might be possible by injecting a
message mid-turn, but that hasn't been tried.

## Tested

| | |
|---|---|
| connectome-host | 0.9.0 (main @ `32b5eb8`) |
| agent-framework | 0.21.0 (main @ `038b01f`) |
| Date | 2026-10-07 |
| How | Inside the real `AgentFramework` with its test membrane, scripting the model's tool calls: an identical-call loop, a single-tool streak with varying inputs, and a too-long turn were each ended at their limit, with the note stored; two normal multi-round turns ran untouched and the counts reset between them. Separately, loaded through the host's own `loadRecipe` → `loadExtensions` path and booted the host headless with the `mock` provider for a full turn. Not yet run against a real model. |

## Files

- [`index.ts`](index.ts): the whole extension. It imports only types from
  `@animalabs/agent-framework` and does nothing outside the agent's own
  process.
