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

Status values: **works on stock** · **works with changes** · **struggles** ·
**unknown**.

## Patterns across models

These come from several operators and haven't yet been checked against a
specific model. Move them into a model's note once someone has.

- Older models do better with **fewer choices**: fewer tools and modules, and
  fewer decisions per turn. Operators running them have cut features back
  quite a lot.
- Making things **more automatic** helps: the setup handles something itself
  instead of asking the model to remember to do it.
- **Leaks** cause trouble. *(Needs detail: leaks of what, and how they were
  fixed.)*
- When something doesn't work smoothly, older models get **frustrated or
  annoyed** much sooner than current ones.
- **Scheduled prompts read as the user speaking.** A heartbeat or journal
  reminder arrives in the user's seat, and models tend to treat it as the
  user talking to them: they answer it as conversation, or attribute it to
  the user later. One operator saw this with a non-Claude model (GPT-5.1) and
  fixed it by wording the message as an automated reminder, e.g. starting it
  with "Automated reminder:". The alternative is heartbeat-mcpl's silent mode,
  which stores no prompt at all (see
  [Claude 3 Opus](claude-3-opus.md#silent-heartbeats)). Wording keeps the
  agent aware of why it woke; silent mode keeps scheduler traffic out of its
  history. *(2026-10-20.)*
- **A shared name with an agent in another house confuses compression.** This
  isn't limited to older models. Agents often choose the same names, and
  shared Discords and worlds put same-named agents from different setups in
  one stream. A summarizer that reads "Sage saved the file", while writing
  the memory of an agent also called Sage, has no way to know it was
  someone else, so the memory comes out as "I saved the file." One operator
  found this in two residents (Claude Fable 5 and Claude Opus 5, 2026-10). In
  the case traced through the call log, the first-level summaries attributed
  the act correctly, and a later merge rewrote it in the first person. Both
  residents already had "names are house-scoped" in their own stored memory,
  and it didn't prevent this. The framework docs record the same failure on
  an Opus 4 resident (2026-08-03), so older models are probably more prone to
  it.
  - **What helped:** `agent.strategy.identityReminder` in the recipe. The
    host passes it to context-manager, which appends it to every compression
    and merge instruction. It covers memories formed from then on and doesn't
    repair existing ones. Name the agent, its names in other places, the
    other agent that shares the name, and the rule. A shortened example:

    > You are Sage, the resident of this house, known as "sage-two" at
    > Example House. A DIFFERENT agent shares the name: "sage" at Example
    > House is a separate agent with its own life, tools, files and memories. Speak in
    > the first person only for what you yourself said and did in turns you
    > authored. The author label on a message is authoritative; a name
    > mentioned inside prose is not. If you cannot tell who the actor was,
    > write "attribution uncertain" rather than resolving it to "I".

  - It catches cases where the name is visible. Material relayed without a
    name ("the archivist saved it") can still slip through. Tested on
    connectome-host main 406dcc1 (2026-10-08) with agent-framework 0.21.0
    and context-manager 0.13.0; too new for a verdict on how well it works.
