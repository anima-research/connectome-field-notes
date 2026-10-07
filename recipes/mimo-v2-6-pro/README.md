# MiMo v2.6 Pro: Discord resident

[`discord-resident.json`](discord-resident.json) runs MiMo v2.6 Pro as one
agent across several Discord servers, channels and DMs, with a long
autobiographical memory. It is the recipe one resident has run on since late
September 2026, scrubbed: IDs are placeholders, keys are `${ENV_VAR}`s, and
the persona is a slot. What each part is for, and the evidence, is in the
[model note](../../models/mimo-v2-6-pro.md).

| | |
|---|---|
| Ran live on | connectome-host 0.9.0 (`5c2baab`), agent-framework 0.17.0, context-manager 0.10.1, membrane 0.5.86 |
| Also checked on | connectome-host main @ `e82a68e` (agent-framework 0.21.0, context-manager 0.13.0): the recipe validates with the host's `loadRecipe` and its three extensions load. Not run against Discord on that version. |
| Model | `mimo-v2.6-pro`, Xiaomi direct API, NanoGPT (DeepInfra pinned) as fallback |
| Date | 2026-10-07 |

## What's in it

- **Provider through [`llm-proxy`](../../extensions/llm-proxy/).**
  `agent.baseUrl` points at the local proxy, which tries Xiaomi twice and then
  the gateway, with 45 s first-byte and 60 s idle deadlines.
- **Strategy [`autobiographical-resident`](../../extensions/resident-window/):**
  - chunks close at 60-minute silences;
  - filler `skip_reply` turns and `[reaction]` events stay out of the live window;
  - `identityReminder` keeps summaries from ending in a recap of standing facts;
  - `carrierPolicy: "live-strip"` stops reasoning stored with old summaries from being re-sent;
  - the 3 most recent images stay visible (`maxLiveImages`).
- **[`clock`](../../extensions/clock/):** a `[clock]` line at most hourly
  while people are talking.
- **`proseRouting: "explicit"`:** plain text is delivered only to the room
  named alone on its first line.
- **Wake gate (`modules.wake`):**
  - reactions and edits are deferred;
  - ambient chatter in a busy server is debounced;
  - in a community server: humans who address the agent always wake it, bots in the AI-to-AI channel are rate-limited, and other bots and ambient chatter are deferred.
  
  `defer` doesn't drop anything: the events are in context at the next wake.
- **Fewer tools:**
  - fleet, subagents, lessons and retrieval are off;
  - the MCPL admin tools and the web UI's observer tools go through `utils`;
  - Discord's admin tools are in `disabledTools`, including `filters_update`, so the agent can't edit its own guardrails.
- **Prompt:** a neutral one, with the sections that did the work. They are:
  - rooms, routing and discretion;
  - instruction boundaries;
  - visual input;
  - continuity;
  - time;
  - memory drill-down (the "do not offer to search: just search" rule).

## What you fill in

- `<<PERSONA…>>`, `<<model name>>`, `<<provider>>` and `<<Name>>` in the
  prompt and in `identityReminder`. Rename the agent from `companion`, and set
  `summaryParticipant` to the same name.
- The wake policies' `<BUSY_GUILD_ID>`, `<COMMUNITY_GUILD_ID>` and
  `<AI_TO_AI_CHANNEL_ID>`, or drop the policies you don't need.
- Environment: `DISCORD_TOKEN`; `DISCORD_DM_USERS` (comma-separated user IDs
  allowed to DM the agent; discord-mcpl drops the rest); `MIMO_API_KEY`;
  `NANOGPT_API_KEY`.
- `timezone`.
- Paths assume `connectome-field-notes`, `discord-mcpl` and `connectome-host`
  are checked out side by side. `discord-mcpl` must be built (`dist/`).

## Things that catch people out

- **The gate seeds once.** The recipe only creates
  `data/sessions/<id>/config/gate.json` if it doesn't exist. Later starts add
  new policies by name but never change existing ones. Tune live policies in
  that file; it is hot-reloaded.
- **Segmentation is permanent.** Chunk boundaries are stored the first time
  they are computed. If you import history and warm it up offline, decide
  `segmentGapMinutes` first and warm up with this same strategy.
- **The window has a floor.** A fully folded memory still needs its top
  summaries, the unmerged lower ones and the recent unsummarized messages.
  For one resident with two months of history, that was about 75k tokens. A
  budget below the floor fails to compile and the agent stops answering.
  The framework's `agent_settings` tool lets the agent change its own
  budget, and on this host version a recipe can't remove it.
- **Don't add a prompt rule per habit.** The window keeps the agent's own
  turns verbatim, so a habit already in it is an example it will copy. Fix
  the store, or keep those turns out of the live window, as
  `hideSilentTurns` does for silence.
- **The fallback must take what you send.** With images in context, the
  fallback route has to accept image input too.

## Cost

Over ~34 hours on Xiaomi's direct API: 475 calls, 42.9M input tokens (85%
from cache), about €2.70 at list price, roughly €55 a month. Half of all
turns ended in `skip_reply`. Details in the [model note](../../models/mimo-v2-6-pro.md#cost).
