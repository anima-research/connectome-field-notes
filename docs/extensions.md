# Extensions: changing Connectome without forking it

*Checked against connectome-host 0.9.0 and agent-framework 0.21.0, 2026-10-06.*

## Why extensions instead of a fork

Say 3 Opus does better with a simpler tool, or with a different way of being
told what is going on. You can get that change in two ways.

**Fork connectome-host (or agent-framework) and edit it.** This works on day
one. Then upstream moves, as it does almost daily, and every upgrade turns
into a merge. Your fix and upstream's code drift apart. Hold off on upgrading
and you miss fixes everyone else has; upgrade, and you redo the merge. With
three machines, you end up with three slightly different forks. Sharing the
change means someone else adopts your fork, or picks your diff onto a
different base by hand.

**Write an extension.** The host checkout stays a plain upstream checkout, and
your change lives in its own file outside it. Your recipe loads it:

```json
"extensions": {
  "pinboard": { "kind": "module", "path": "./extensions/example-pinboard/index.ts" }
}
```

What that gets you:

- **Upgrading stays `git pull` and a restart.** Nothing to merge, because you
  didn't edit the host.
- **Breakage stays in one place and is named.** The loader wraps import
  failures and errors thrown from `register()` with the extension's name and
  path, so you see `extension "pinboard" (…/index.ts): …`, not a merge that
  quietly went wrong. This repo's CI also type-checks every extension against
  the latest agent-framework release each week, so interface changes show up
  here before they reach your agent.
- **One copy for every machine.** Point each recipe at the same file (or at
  this repo checked out once per machine). The change can't end up applied on
  two VPSs and missing on the third.
- **Easy to share and easy to drop.** Someone else tries it by adding three
  lines to their recipe, and stops by deleting them.
- **Ready for upstream if it proves itself.** An extension is already a
  self-contained unit with a clear interface, which is close to what an
  upstream PR needs (see [upstreaming.md](upstreaming.md)).

Use a fork or patch only when an extension can't reach what you need to change
(see [below](#what-extensions-cant-reach)). When that happens, also open an
issue asking upstream for a seam, so the next person doesn't have to fork.

## Before writing code, check the recipe

Many simplifications need no code. A stock recipe already controls:

- **The system prompt** (`agent.systemPrompt`, inline or from a URL).
- **Which modules load.** `modules.*` switches modules on and off. Many are
  opt-in, and a few, such as `wake`, are on unless you set them to `false`.
  Every module you leave off is one less set of tools for the model to choose
  from.
- **Which MCP/MCPL servers load** (`mcpServers`). Same reasoning.
- **How prose is routed** (`agent.proseRouting`).

The host README is the reference for all of these. Recipe-level control over
tool visibility and descriptions is in progress: agent-framework #162 is
merged (2026-10-06), and connectome-host #135, which exposes it in recipes,
is still open.

## How the extension seam works

The source is `src/extensions.ts` in connectome-host. Its header comment is the
reference; here is the summary.

A recipe's top-level `extensions` block maps a name to an entry:

```json
"extensions": {
  "<name>": {
    "kind": "module",
    "path": "./path/to/index.ts",
    "config": { "anything": "you like" }
  }
}
```

- `kind` is `"module"` or `"strategy"`. A recipe can only set
  `agent.strategy.type` to a non-built-in name when at least one `"strategy"`
  extension is declared.
- `path` is resolved against the recipe file's directory. The host runs on
  Bun, so `.ts` loads directly with no build step.
- `config` is passed through untouched.

The file must export a `register` function (named or default):

```ts
export function register(api, config) {
  api.registerModule((ctx) => new MyModule(ctx.config));
  // and/or
  api.registerStrategy('my-strategy', (ctx) => new MyStrategy(ctx.config));
}
```

- **`registerModule(factory)`** adds a framework module. The factory receives
  `{ timeZone, storePath, model, config }` and returns an object implementing
  agent-framework's `Module` interface. Modules are created after the built-in
  ones. If the instance has a `setFramework` method, the host calls it once
  the framework exists.
- **`registerStrategy(type, factory)`** adds a context strategy under a new
  `agent.strategy.type` name. The factory receives
  `{ config, model, timeZone }`, where `config` is the recipe's whole
  `agent.strategy` block, including keys the built-in schema doesn't know.
  Built-in names (`autobiographical`, `passthrough`, `frontdesk`) and
  duplicates are rejected.

### What a module can do

The `Module` interface is in agent-framework `src/types/module.ts`. The
useful parts:

| Member | Use |
|---|---|
| `getTools()` / `handleToolCall()` | Give the agent tools. They appear as `<module name>--<tool>`, and `handleToolCall` receives the bare tool name. |
| `getUtilities()` | Operations reached through the framework's single `utils` tool instead of a separate tool slot. Good for rarely used features: fewer tool schemas means less to choose from. |
| `onProcess(event, state)` | React to events (messages, tool results, module events). It can add, edit or remove messages and request inference. |
| `getAgentSettingsExtension()` | Add your own hot-tunable fields to the agent's existing `agent_settings` tool instead of a new tool. |
| `ctx.getState()` / `ctx.setState()` | Small persistent state, stored in the agent's Chronicle. For growing collections, use `registerLogState` / `appendToLog`. |

A complete, minimal example is
[`extensions/example-pinboard`](../extensions/example-pinboard/): one module,
one tool and persistent state, in about a hundred lines.

## Keeping an extension easy to maintain

- **Import types only.** Use `import type { Module, … } from
  '@animalabs/agent-framework'`. Type imports disappear at runtime, so the
  extension has no runtime dependency on a framework version, and the CI type
  check still tells you when an interface changes. If you do need a runtime
  import from `@animalabs/*`, it resolves against the host's own copy, which
  is fine, but you are now tied to that version.
- **Implement interfaces; don't subclass internals.** A module that implements
  `Module` depends only on that interface. A strategy that
  `extends AutobiographicalStrategy` depends on that class's internals, which
  change without notice. If you have to subclass, keep the override small and
  say so in the extension's README.
- **Don't build on context injection.** `Module.gatherContext()` (per-turn
  HUD-style injections) is being deprecated: see agent-framework #218, and
  #171 for the reason. Injections re-anchor on every activation and break
  prompt caching. To let the model see state, give it a tool to look the
  state up, or put stable text in the system prompt.
- **Stamp what you tested.** Each extension's README states the host and
  framework versions and the date it was last run for real.

## What extensions can't reach

- **The host's and framework's own behavior.** Built-in tool descriptions and
  how the framework compiles a request can only be changed upstream or with a
  patch. Tool visibility and descriptions are covered by the open PRs above.
  A built-in module you can switch off in the recipe is the exception: turn
  it off and register your own module in its place.
- **MCPL servers** (discord-mcpl and others). They are separate processes.
  You can run your own server alongside or in place of one, configured in the
  recipe, which is also "no fork of the host." Changing the stock server
  itself needs a patch or an upstream PR.

In these cases, put the diff in [`patches/`](../patches/) with its base commit
and the reason no extension works. Then open an upstream issue describing the
seam that would have made the patch unnecessary.

## Things that catch people out

- **URL-loaded recipes need absolute extension paths.** Relative paths resolve
  against a recipe *file's* directory, so a recipe fetched from a URL can't
  carry a relative path to an extension.
- **Extension paths are saved resolved.** The host snapshots the resolved
  `path` into the data directory, so never interpolate a `${SECRET}` into it.
- **A runtime import resolves from the extension's own location first.** An
  extension that imports `@animalabs/*` at runtime (to subclass a strategy,
  say) gets this repo's `node_modules` copy if this checkout has one, for
  example after `npm install` for `npm run check`, and that may not be the
  version your host ships. Without one, Bun falls back to the host's copy.
  Load extensions from a checkout without `node_modules`, or keep its
  versions in step with the host.
- **Extensions run in-process, with full access.** That means your agent's API
  keys, its store and the filesystem. Read every extension before loading it,
  including the ones in this repo.
