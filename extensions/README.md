# Extensions

Host extensions: framework modules and context strategies that a recipe loads
from a local path, with no fork of connectome-host needed. Read
[`docs/extensions.md`](../docs/extensions.md) first. It covers why this beats
forking, how the seam works and what it can't reach.

| Extension | What it does | Tested on |
|---|---|---|
| [example-pinboard](example-pinboard/) | Template: one module, one tool, persistent state. Not a fix for anything. | host 0.9.0 / AF 0.21.0, 2026-10-06 |
| [loop-guard](loop-guard/) | Ends a turn stuck in a tool loop (identical calls, a single-tool streak such as endless `think`, or too many rounds) and tells the agent why. | host 0.9.0 / AF 0.21.0, 2026-10-07 |
| [operator-interrupt](operator-interrupt/) | An operator's `!interrupt` message stops the agent's current turn; other messages are left alone. | host 0.9.0 / AF 0.21.0, 2026-10-07 |

## Adding one

- One directory per extension: `extensions/<name>/index.ts` plus a `README.md`.
- The README says what it does, which models it's for (linking their notes
  in `models/`), what it was tested on and when, and anything it does beyond
  the agent's own process (network calls, files outside the store).
- Import only types from `@animalabs/*` where you can (see
  [keeping an extension easy to maintain](../docs/extensions.md#keeping-an-extension-easy-to-maintain)).
- `npm run check` passes.

**Read before you load.** An extension runs inside your agent's process, with
its keys. That applies to everything here too.
