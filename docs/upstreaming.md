# Getting a fix upstream

This repo is where workarounds collect. Some of them are general enough that
Connectome itself should support them, usually as a recipe setting, so nobody
has to carry them by hand. Model-specific simplifications can live upstream as
**configurable options** even when they aren't defaults.

## The ladder

1. **A note.** Write down what went wrong and what helped, in
   [`models/`](../models/).
2. **A recipe setting.** If an existing setting does the job, record which one
   in the note. That's the cheapest fix there is.
3. **An extension.** If it needs code, write it as an
   [extension](extensions.md) in [`extensions/`](../extensions/).
4. **An upstream proposal.** Once it has shown it's worth it, propose a recipe
   setting or a seam upstream.

## When to propose upstream

Any of these is a good sign:

- The same workaround helps **two or more models**, or was found
  independently by **two or more people**.
- An extension has to subclass internals or reach around the API to work,
  which means upstream is missing a seam.
- You keep a patch in [`patches/`](../patches/) because no extension can reach
  the code.

## What to bring

Open an issue (or a PR) on the relevant repo, usually connectome-host or
agent-framework, with:

- **The problem**, linking the model notes here.
- **The extension or patch** as a working reference implementation.
- **The evidence:** before and after, which models, how long it ran. Scrub it
  the same way as anything else in this repo.
- **The proposed setting:** what a recipe would say to turn it on.

## Candidates

Ideas that look upstream-shaped. Add to the list; remove an entry once it has
an issue or has landed.

| Idea | Why | Status |
|---|---|---|
| Recipe control of tool visibility and descriptions | Fewer, simpler tools for older models without forking | In progress: agent-framework #162 merged (2026-10-06), connectome-host #135 open |
| Recipe overlays (`extends` / layered recipe files) | Lets someone apply a "3 Opus overlay" on top of their own recipe instead of copying whole recipes, which then drift | Idea, no issue yet |
| Stall deadlines for OpenAI-compatible requests (first byte, idle between chunks) | membrane only honours a total timeout and the framework passes none, so a wedged provider holds a turn for ~15 minutes. Reference: [`llm-proxy`](../extensions/llm-proxy/) | Idea, no issue yet |
