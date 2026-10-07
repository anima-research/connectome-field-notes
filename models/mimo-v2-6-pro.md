# Xiaomi MiMo v2.6 Pro (`mimo-v2.6-pro`)

**Status:** works with changes
**Last updated:** 2026-10-07

## Summary

It runs well as a long-lived Discord resident, but the setup around it
matters more than the model. Xiaomi's own API stalls and sometimes breaks
tool calls, so put deadlines and a fallback route in front of it. With many
tools exposed it uses only a handful. It needs blunt instructions before it
searches its memory, and it copies its own habits from the window, silence
included.

## What goes wrong

- **The direct API stalls.** A request sits silent for about 900 s and then
  gets a 500. This happened 10 times in one day, and the resident was frozen
  for 2.5 hours. The host's OpenAI-compatible path has no stall detection:
  membrane only honours a total timeout, and the framework passes none.
  Healthy requests get their first byte in 1.6–8.4 s on every provider tried,
  so 45 s of silence is a stall, not a slow model.
- **Broken tool calls on Xiaomi's direct API.** Here is what happened in a
  probe asking it to search history:
  1. The model wrote its tool call in its XML form with a doubled closing
     tag.
  2. Xiaomi's server returned arguments missing the closing `}`, and also left
     the raw `<tool_call><function=…>` text in the reply.
  3. membrane 0.5.86 could not parse the arguments and **ran the tool with
     empty input**, with only a console warning.

  It happened 2 of 2 times on that probe. The same model through a gateway
  provider was clean on the same probe (2 of 2). In a month of one
  resident's real history on the direct API, all 24 history searches did
  carry arguments, so this doesn't happen every time. It is a known shape,
  though, and it fails silently.
- **Provider moderation text in the reply.** About 8 times in ~1,600 turns,
  the reply was cut off and the provider's "The request was rejected
  because it was considered high risk" was glued onto it.
- **Most of a wide tool surface goes unused.** One resident had 82 tool
  definitions on every request and used 10. Another had 55 exposed; across
  ~200 turns, 52 were never called, and almost every call was `send_dm` or
  `skip_reply`. With send tools and prose routing both available, about a
  quarter of turns used both prose and a tool call. It hasn't been checked
  whether that ever duplicated a message.
- **Rooms bleeding into each other** (once, early, before the fix below): a
  turn that held messages from two rooms was answered in one message, in
  the wrong room, and the private part was later repeated in public.
- **It doesn't search its memory unprompted.** It answers from a
  similar-sounding memory instead of calling the history tools. On a probe of
  seven questions about specific past moments it got 5 right; the misses
  were details the summaries had blurred, and it never searched.
- **It copies its own habits.** The window keeps its own turns verbatim, so a
  habit that gets in once becomes the example:
  - Woken by ambient traffic with nothing to say, it posted "still here"
    filler, or commented on one room in another (17 times in one private
    channel).
  - After about 40 silent turns in a row, it kept staying silent even when
    mentioned directly.
  - With Discord reactions piling up in context, it commented on them at the
    next real wake.
- **It loses track of time.** The host announces the time once, at session
  start. It judged "bedtime" from a notice written the night before.
- **The texture rules slip.** It uses em dashes and Markdown bold despite
  explicit "never" rules, more as the context grows.

## What helped

| Change | How | Effect | Confidence |
|---|---|---|---|
| Deadlines and failover for the direct API | A local OpenAI-compatible proxy in front of the provider: 45 s first-byte and 60 s idle deadlines, attempts Xiaomi → Xiaomi → gateway (pinned provider), SSE keepalives to the host while it buffers | Over 10 days: 893 requests, 3 rescued by a retry, 1 lost (on day one, while the per-attempt cap was still 480 s; long generations need more) | One resident, 10 days |
| Use a gateway route, or pin a provider, for tool-heavy work | Gateway provider instead of Xiaomi direct | Clean tool calls on the probe that broke on direct | 2 probe runs. Small sample. |
| Use one speech channel and state the room rules | `agent.proseRouting: "explicit"`, with the destination alone on the first line, plus a prompt section: answer each room separately, each room is its own space, knowing something is not permission to repeat it elsewhere | No wrong-room posts after the change | Weeks on one resident |
| Say how to stay silent, and debounce what wakes it | Name `skip_reply` / `>>skip_reply` in the prompt as the way to say nothing, with no status lines; `modules.wake` policies: reactions and edits `defer`, other bots `rate_limit`, ambient traffic debounced (90 s) or `defer` | Filler and "still here" posts stopped. Reactions had been 76 of 475 wakes, and 75 of those ended silent | Weeks on one resident |
| Keep its filler silences and reactions out of the live window | A strategy extension that drops short `skip_reply` turns and `[reaction]` events from the compiled window only (the store keeps them), plus rewriting the 14 filler turns in the store to `>>skip_reply` | The silence streak and the comments on reactions stopped | One resident: 10 days (silences), 5 days (reactions) |
| Blunt retrieval instruction | Prompt: "when a question asks for a specific past detail, call the history search first; do not offer to search, just search" | The same probe went from 5/7 to 7/7, and it searched on its own | One probe, one resident |
| A clock | A small module that adds a `[clock]` line to incoming activity at most once an hour, or when the day changes | It stopped reasoning from a stale time | One resident, weeks |
| Fewer tools | `modules.fleet: false`, `modules.subagents: false`, Discord admin tools in the server's `disabledTools` | 82 → ~54 definitions. It saves little money, because tools sit in the cached prefix | One resident |

## What didn't help

- Repeating the texture rules (no em dashes, no Markdown) in the prompt
  reduces them but doesn't stop them in long contexts.
- Adding one more prompt rule per bad habit. The habit is already in the
  window as an example; fixing the store and the live window worked better.

## Cost

One resident on Xiaomi's direct API, over ~34 hours of normal use: 475
calls, 42.9M input tokens with 85% served from cache, 192k output tokens
(88k of them reasoning). At list price that is about €2.70, roughly €55 a
month. A cache hit is about 120× cheaper than uncached input, so most of the
bill is the uncached part, and a cache-stable prefix (the `kv-stable` solver)
matters a lot. Half of all turns ended in `skip_reply`, so deciding to stay
quiet is about half the bill.

## Tested with

| | |
|---|---|
| connectome-host | 0.9.0 (`5c2baab`) |
| agent-framework | 0.17.0 |
| context-manager | 0.10.1 |
| membrane | 0.5.86 |
| Provider / access path | Xiaomi direct API; NanoGPT gateway (pinned to `deepinfra`) as fallback and for the probes |
| Setup | Discord residents (two, one operator), several servers and DMs, ~85–95k-token windows, 54–82 tools |
| Reported by | ajaniramon |

## Open questions

- How often does the direct-API tool-call breakage happen in real contexts,
  as opposed to short probes?
- Does trimming the tool surface with recipe tool presentation
  (agent-framework #162, connectome-host #135) change which tools it uses, or
  how often it speaks twice?
- Is the older `mimo-v2.5-pro:thinking` variant different? Through one
  gateway it rejects image input, so images have to be described or
  dropped.
