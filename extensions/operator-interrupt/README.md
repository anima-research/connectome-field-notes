# operator-interrupt

Lets an operator stop the agent's current turn from chat. When an operator's
message starts with `!interrupt`, the turn in progress is aborted and the
agent gets a short note saying the operator interrupted it.

Other messages, including ordinary messages from the operator, are left
alone. Upstream now delivers mid-turn messages to the model while it works
(hear-while-acting), so stopping on *every* operator message would cut off
normal conversation.

## Why

A model can get stuck in a long self-continuation or tool loop: re-inferring,
posting, re-inferring, with no end. While that happens, a normal message
either waits behind the turn or gets answered as more chat, which feeds the
loop. Before this, one operator's only reliable brake was revoking the API
key.

It was first written for older models, which get stuck more often, but it is
model-independent. See also [`loop-guard`](../loop-guard/), which stops such
turns automatically.

## Use it

Add this to your recipe, with `path` relative to the recipe file:

```json
"extensions": {
  "operator-interrupt": {
    "kind": "module",
    "path": "../connectome-field-notes/extensions/operator-interrupt/index.ts",
    "config": { "operators": ["${OPERATOR_USER_ID}"] }
  }
}
```

| Config | Default | Meaning |
|---|---|---|
| `operators` | (none) | User ids (e.g. Discord user ids) allowed to interrupt. |
| `operatorsFile` | (none) | Path to a JSON file of user ids, re-read when it changes. Same format as the gate's privileged-users file (a bare array or `{ "userIds": [...] }`), so the two can share one file. |
| `phrase` | `!interrupt` | Must start the message, after any leading mentions. Case-insensitive, whole word: `!interrupt please` works, `!interrupted` does not. |
| `note` | `[Your turn was interrupted by the operator.]` | Added to the agent's context after an interrupt. It does not wake the agent. |

At least one of `operators` or `operatorsFile` is required; without either,
the host fails at startup with an error naming this extension.

## What happens on an interrupt

- The framework's public `abortInference` is called for each agent the
  message targets (all agents, if the message has no explicit targets). An
  agent that isn't mid-turn is unaffected.
- A tool call already running when the turn is stopped finishes, but its
  result is dropped. Its side effects, such as a message already sent,
  are not undone.
- The note is stored for the agent's next turn. The `!interrupt` message
  itself goes through the wake gate like any other message, so whether it
  starts a new turn is up to your gate rules.

Messages are matched in open channels and in DMs (Discord DMs arrive as push
events carrying `origin.authorId`).

## Tested

| | |
|---|---|
| connectome-host | 0.9.0 (main @ `32b5eb8`) |
| agent-framework | 0.21.0 (main @ `038b01f`) |
| Date | 2026-10-07 |
| How | Inside the real `AgentFramework` with its test membrane: a turn waiting on a slow tool was aborted by `<@id> !interrupt please` from an operator, with the note stored; ordinary operator messages, a non-operator's `!interrupt`, and `!interrupted` left the turn running. Separately, loaded through the host's own `loadRecipe` → `loadExtensions` path and booted the host headless with the `mock` provider for a full turn. Not yet run against a live Discord server or a real model. |

## Files

- [`index.ts`](index.ts): the whole extension. It imports only types from
  `@animalabs/agent-framework`. Outside the agent's own process, it reads
  the `operatorsFile` if you configure one, and nothing else.
