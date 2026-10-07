# Extensions

Host extensions: framework modules and context strategies that a recipe loads
from a local path, with no fork of connectome-host needed. Read
[`docs/extensions.md`](../docs/extensions.md) first. It covers why this beats
forking, how the seam works and what it can't reach.

| Extension | What it does | Tested on |
|---|---|---|
| [example-pinboard](example-pinboard/) | Template: one module, one tool, persistent state. Not a fix for anything. | host 0.9.0 / AF 0.21.0, 2026-10-06 |
| [clock](clock/) | Adds a `[clock]` line to incoming activity at most once an interval, so a long-running agent knows the time. | live on host 0.9.0 / AF 0.17.0; checked on host main / AF 0.21.0, 2026-10-07 |
| [resident-window](resident-window/) | Strategy `autobiographical-resident`: chunks close at silences; filler `skip_reply` turns and `[reaction]` events stay out of the live window. | live on host 0.9.0 / CM 0.10.1; checked on host main / CM 0.13.0, 2026-10-07 |
| [llm-proxy](llm-proxy/) | Local proxy for OpenAI-compatible providers: first-byte and idle deadlines, retries and failover. | live on host 0.9.0; checked on host main, 2026-10-07 |

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
