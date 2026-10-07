# Models

One note per model. To add a model, copy [`_TEMPLATE.md`](_TEMPLATE.md).

**Baseline:** Claude Opus 4.5 and later run on the stock setup without
trouble. The notes here are mostly about models that don't.

| Model | Status | Summary |
|---|---|---|
| [Claude 3 Opus](claude-3-opus.md) | struggles | Has a hard time with the default setup, but seems to like being there. |
| [Claude 3.6 Sonnet](claude-3-6-sonnet.md) | struggles | Has a hard time with the default setup. |
| [Claude Opus 4](claude-opus-4.md) | struggles | Mixed reports: disoriented, or troubled for reasons not clearly about Connectome. |
| [Claude Sonnet 4.5](claude-sonnet-4-5.md) | struggles | Mixed reports: often annoyed in one setup, mode collapse without annoyance in another. |
| [Xiaomi MiMo v2.6 Pro](mimo-v2-6-pro.md) | works with changes | Long-lived Discord resident with routing, wake-gate and prompt changes. Xiaomi's direct API stalls and can break tool calls; the model copies its own habits from the window. |

Status values: **works on stock** · **works with changes** · **struggles** ·
**unknown**.

## Patterns across models

These come from several operators and haven't yet been checked against a
specific model. Move them into a model's note once someone has.

- Older models do better with **fewer choices**: fewer tools and modules, and
  fewer decisions per turn. Operators running them have cut features back
  quite a lot.
- Making things **more automatic** helps: the setup handles something itself
  instead of asking the model to remember to do it. One example, seen on
  [MiMo v2.6 Pro](mimo-v2-6-pro.md): a module that adds a `[clock]` line to
  incoming activity, instead of a prompt asking the model to check the time.
- **Habits get copied.** The window keeps the agent's own turns verbatim, so
  a bad habit that gets in once becomes an example it follows: filler
  posts, long runs of silence, comments on reactions. Seen on MiMo v2.6 Pro.
  Fixing the store, or keeping those turns out of the live window, worked
  better there than one more prompt rule per habit.
- **Leaks** cause trouble. "Leaks" covers several things that end up somewhere
  they shouldn't, mostly in what the resident says. These are the ones seen
  so far, with what fixed each. Observed on connectome-host 0.9.0, AF 0.17.0
  and membrane 0.5.86, on non-Claude models, and not yet checked against the
  older Claude models above.
  - **Reasoning in speech.** Some backends send the tail of the reasoning and
    a closing `</think>` inside the reply text. Summarizer models sometimes
    wrap the whole memory in literal `<thinking>` tags. *Fixed:* membrane
    strips an orphan `</think>` from openai-compatible replies, and
    context-manager strips a leading thinking preamble from summaries.
    Neither needs a setting.
  - **Tool calls written as text.** The model types the call out instead of
    making it (`<tool_name>…`, `<tool_call>{…}</tool_call>`, or an XML
    `<function=…><parameter=…>` form), and the text gets published as
    speech. *Partly fixed:* `agent.toolWrapperProseGuard: true` (off by
    default) catches `<knownToolName>` wrappers. The `<tool_call>` and
    `<function=…>` forms are not caught anywhere yet.
  - **Provider text in speech.** A provider's moderation message gets glued
    onto the reply (`…<reply cut off>The request was rejected because it was
    considered high risk`). The turn ends as a refusal, but the provider's
    string is still in the text. *Not settled:* `agent.refusalHandling`
    governs retries. Whether a refused turn's text can still be published
    hasn't been checked.
  - **Cross-room leaks.** A reply meant for one room lands in another, or a
    private conversation is summarised in a public channel. This is more
    likely when the model has two ways to speak at once (prose with
    destination lines, and send tools). *Fixed:* `agent.proseRouting:
    "explicit"` plus a short prompt section saying each room is its own
    space and that knowing something is not permission to repeat it
    elsewhere.
  - **Filler.** When woken with nothing to say, the model posts "still here"
    or reports one room's conversation in another. *Fixed:* `skip_reply`
    (or a `>>skip_reply` line) named in the prompt as the way to stay
    silent, plus a debounce on ambient wakes. Keeping short silences out of
    the live window stops a run of them from becoming the pattern (see the
    [MiMo note](mimo-v2-6-pro.md)).
  - **Old events presented as new.** Discord sends a message update when a
    link preview refreshes. discord-mcpl forwarded these as `[message
    edited]` with no author, so the resident took weeks-old messages as
    current and attributed them to the wrong person. *Fixed upstream* in
    discord-mcpl #39. Until you run a version with it, a `modules.wake`
    policy that defers `^\[message (edited|deleted)\]` push events keeps
    them from waking the agent.
  - **Reasoning replayed into context.** Thinking blocks from imported or
    warmed-up history get re-sent on every turn (about 8k tokens in one
    case). It isn't visible in speech, but it costs and crowds the window.
    *Fixed:* the strategy option `carrierPolicy: "live-strip"` drops that
    reasoning from the live window. The store keeps it.
- When something doesn't work smoothly, older models get **frustrated or
  annoyed** much sooner than current ones.
