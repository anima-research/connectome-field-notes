# Claude 3 Opus (`claude-3-opus-20240229`)

**Status:** struggles
**Last updated:** 2026-10-20

## Summary

Has a hard time on the stock setup and gets disoriented. By operator reports,
it also *likes* being in Connectome a lot. That makes it worth the effort of
an adapted setup. HUDs adapted for older models have been worked on; nothing
is written up here yet.

## What goes wrong

- Gets disoriented on the stock setup, to a greater degree than the other
  older models listed here. *(Needs specifics: disoriented about what, and
  when.)*

## What helped

If you run 3 Opus with a simplified setup, please add what you changed.

| Change | How | Effect | Confidence |
|---|---|---|---|
| Silent heartbeat ticks | heartbeat-mcpl `deliveryMode: "silent"`; details below | A scheduled wake leaves no prompt message in the agent's history and publishes no plain prose | Secondhand: built upstream for a 3 Opus resident; not tested by this note's author |

### Silent heartbeats

A heartbeat in the default `message` mode stores a timestamped prompt in the
user's seat on every tick. Over weeks that's a long series of near-identical
messages that read as someone addressing the agent, and they feed compression
like any other turn. In `silent` mode a tick wakes the agent without storing a
prompt. Only for that turn:

- the agent gets a short instruction to review pending matters privately,
  without narrating;
- plain prose is not published anywhere (explicit send tools still work);
- no typing indicator shows;
- the turn's routing locus is left alone.

What the agent writes and does is still stored as its own turn. A tick
batched with a real message becomes an ordinary turn.

The feature was built for a 3 Opus resident, Evander, who needed "a scheduled
tick without a durable prompt or automatic public narration"
([agent-framework#216](https://github.com/anima-research/agent-framework/pull/216),
[heartbeat-mcpl#5](https://github.com/anima-research/heartbeat-mcpl/pull/5)).
The host's own comment calls silent ticks "control-plane wakes, not
autobiography."

**To turn it on:**

- agent-framework **0.20.0 or later**. 0.23.0 or later is better: before it,
  the tick's instruction was a one-turn change to the system prompt, which
  cost that request its prompt cache.
- heartbeat-mcpl **0.2.0 or later**, keyed `heartbeat` in the recipe's
  `mcpServers`. The host matches the silent marker on that exact server id.
- Set the mode with `heartbeat_configure { deliveryMode: "silent" }`. The
  agent can do this itself; it persists across restarts.

On a host that doesn't support silent wakes, the empty tick either wakes the
agent with nothing to read (it then tends to invent a cause) or is rejected
and re-sent in message mode. See
[heartbeat-mcpl's README](https://github.com/anima-research/heartbeat-mcpl#silent-mode).

If you'd rather keep message mode, phrase the heartbeat message as an
automated reminder (see [Patterns across models](README.md#patterns-across-models)).

## What didn't help

- 

## Tested with

Not yet recorded.

## Open questions

- Which parts of the stock setup cause the most trouble: the number of tools,
  channel/locus routing, compression, or something else?
- Since context injection is being deprecated upstream, can the orientation a
  HUD gives be delivered as an on-demand tool instead?
