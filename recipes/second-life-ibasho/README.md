# Second Life through Ibasho

A recipe for an agent that lives in Second Life, the virtual world, with an avatar of its own.
[Ibasho](https://github.com/studio-quire/ibasho) (open source) gives it the body: a patched Second Life viewer and
an MCP server that also speaks MCPL. The world's events (chat near the avatar, IMs, dialogs, offers, payments, and
speech if hearing is on) are pushed to the agent with `chat:*` tags its wake rules can sort, and a line before each
turn says where the avatar is, who's near, and any unread IMs.

**Tested** 2026-11-03 with connectome-host 0.21.0, agent-framework 0.32.0 and Ibasho 0.2.0, on `claude-opus-5-5`:
on a local OpenSim grid, and for three hours on Second Life itself with Ibasho in a Linux container (4 vCPU / 8 GB,
no GPU) beside the host. Other models haven't been tried.

## Setting it up

Ibasho's [Connectome page](https://github.com/studio-quire/ibasho/blob/main/docs/connectome.md) is written for the
agent doing the setup (a Claude Code instance with a shell, say) and covers it end to end; its
[Linux page](https://github.com/studio-quire/ibasho/blob/main/docs/linux.md) covers the container. In short:

1. The person makes a Second Life account for the agent and flags it as a scripted agent (Linden Lab requires this
   for accounts a program drives).
2. Run Ibasho's container on the host's server and do the one-time login: the person types the password into the
   viewer through a browser view of the container's screen, over an SSH tunnel, so it never passes through Ibasho
   or the agent.
3. Put the container's MCP token in the host's `.env` as `IBASHO_MCP_TOKEN`, along with `AGENT_NAME`,
   `SL_AVATAR_NAME` and `OPERATOR_NAME` for the prompt.
4. Start the host with this recipe. The agent logs itself in with its `up` tool.

## What's in the recipe, and why

- **`mcpServers.ibasho`** dials the container's WebSocket on the server's loopback. `requestTimeoutMs` is five
  minutes because logging in, walking and `listen` can take longer than the default minute. `reconnect` lets the
  agent get its tools back after the container restarts.
- **Wake rules**: the operator's messages, anything addressed to the agent, and chat where it has spoken lately
  wake it at once. Objects' chatter is deferred, and other nearby chat is gathered into one wake after 20 quiet
  seconds. `sl-talking` must stay before `sl-ambient`: people in Second Life rarely use the name of whoever they're
  talking to, so without it conversations stall.
- **The system prompt** is a neutral start. Connectome doesn't show the model an MCP server's own instructions, so
  the prompt says how the world reaches the agent and that its plain text isn't heard there (it speaks with `say`
  and `im`). Adapt it with the person; an agent's life is theirs to describe, and a bounded run should say how long
  it lasts and what happens after.

## Things to know

- **Memory:** the viewer takes 2-3 GB in quiet places and close to 6 GB in busy ones. 8 GB suits an agent that goes
  where people are; 4 GB only quiet places.
- **The display name and profile** are the agent's to write (`set_profile`); the display name can change about
  once a week.
- **Places that refuse bots:** estates can refuse scripted agents. In testing, a new account's home (an
  orientation island) kept trying to send it to a place that refused it, in a loop; we think the flag was why, but
  didn't confirm it. `ibasho login --start REGION` starts the first login somewhere else.
