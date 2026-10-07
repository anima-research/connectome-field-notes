/**
 * loop-guard: end a turn that is going round in circles.
 *
 * Watches the framework's trace stream and counts, per agent and per turn,
 * the tool-call rounds the model makes. When a turn trips one of three limits
 * the guard ends it through the framework's public `abortInference` and leaves
 * the agent a note saying why:
 *
 * - `maxRoundsPerTurn`: too many tool-call rounds in one turn, whatever they are.
 * - `maxIdenticalRounds`: the same call(s) with the same input, round after round.
 * - `streaks`: too many rounds in a row that call only one given tool,
 *   e.g. `{ "think": 8 }` for a model that reasons forever and never acts or replies.
 *
 * Older models in particular can get stuck re-inferring with no exit: a think
 * tool with no end-of-turn, a status check repeated forever. This is a
 * backstop, not a fix for the underlying confusion; see the model notes.
 *
 * Load it from a recipe:
 *
 *   "extensions": {
 *     "loop-guard": {
 *       "kind": "module",
 *       "path": "./path/to/extensions/loop-guard/index.ts",
 *       "config": { "maxRoundsPerTurn": 40, "maxIdenticalRounds": 4, "streaks": { "think": 8 } }
 *     }
 *   }
 *
 * Only type imports from @animalabs/*: they are erased at runtime, so this
 * file has no runtime dependency on any framework version.
 */

import type {
  EventResponse,
  Module,
  ModuleContext,
  ProcessEvent,
  ProcessState,
  ToolCall,
  ToolDefinition,
  ToolResult,
  TraceEvent,
} from '@animalabs/agent-framework';

// The host's side of the contract (connectome-host src/extensions.ts),
// declared here so this file needs nothing from the host package.
interface ModuleFactoryContext {
  timeZone: string;
  storePath: string;
  model: string;
  config: Record<string, unknown>;
}

interface ExtensionApi {
  registerModule(factory: (ctx: ModuleFactoryContext) => Module): void;
}

/** The public framework method this module calls (handed over by the host
 *  through `setFramework` once the framework exists). */
interface FrameworkHandle {
  abortInference(agentName: string, reason?: string): boolean;
}

export interface LoopGuardConfig {
  /** Max tool-call rounds in one turn. 0 disables. */
  maxRoundsPerTurn: number;
  /** Max consecutive rounds with exactly the same calls and inputs. 0 disables. */
  maxIdenticalRounds: number;
  /** Tool name → max consecutive rounds that call only that tool. */
  streaks: Record<string, number>;
}

const DEFAULTS: LoopGuardConfig = {
  maxRoundsPerTurn: 40,
  maxIdenticalRounds: 4,
  streaks: { think: 8 },
};

type ToolCallsYielded = Extract<TraceEvent, { type: 'inference:tool_calls_yielded' }>;

interface TurnState {
  rounds: number;
  lastSignature: string | null;
  identical: number;
  streakTool: string | null;
  streak: number;
  tripped: boolean;
}

// `completed` is the ordinary end of a turn; `turn_ended` is an end-turn tool
// such as skip_reply.
const TURN_END = new Set([
  'inference:completed',
  'inference:turn_ended',
  'inference:aborted',
  'inference:failed',
  'inference:exhausted',
]);

export class LoopGuardModule implements Module {
  readonly name = 'loop-guard';

  private ctx: ModuleContext | null = null;
  private framework: FrameworkHandle | null = null;
  private unsubscribe: (() => void) | null = null;
  private turns = new Map<string, TurnState>();

  constructor(private readonly config: LoopGuardConfig) {}

  /** Called by the host once the framework exists. */
  setFramework(framework: FrameworkHandle): void {
    this.framework = framework;
  }

  async start(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
    this.unsubscribe = ctx.onTrace((event) => this.onTrace(event));
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.ctx = null;
    this.turns.clear();
  }

  getTools(): ToolDefinition[] {
    return [];
  }

  async handleToolCall(call: ToolCall): Promise<ToolResult> {
    return { success: false, isError: true, error: `Unknown tool: ${call.name}` };
  }

  async onProcess(_event: ProcessEvent, _state: ProcessState): Promise<EventResponse> {
    return {};
  }

  /** Public for tests: feed one trace event. */
  onTrace(event: TraceEvent): void {
    // Counting runs from a turn's first round to its terminal event.
    // `inference:started` is deliberately not a reset: the framework re-emits
    // it for retries and context-budget restarts inside the same turn, and a
    // long loop is exactly what triggers a budget restart.
    if (TURN_END.has(event.type)) {
      this.turns.delete((event as { agentName: string }).agentName);
      return;
    }
    if (event.type === 'inference:tool_calls_yielded') {
      this.onRound(event);
    }
  }

  private onRound(event: ToolCallsYielded): void {
    const turn = this.turns.get(event.agentName) ?? freshTurn();
    this.turns.set(event.agentName, turn);
    if (turn.tripped) return;

    turn.rounds += 1;

    const signature = JSON.stringify(event.calls.map((c) => [c.name, c.input ?? null]));
    turn.identical = signature === turn.lastSignature ? turn.identical + 1 : 1;
    turn.lastSignature = signature;

    const names = new Set(event.calls.map((c) => c.name));
    const only = names.size === 1 ? [...names][0]! : null;
    turn.streak = only !== null && only === turn.streakTool ? turn.streak + 1 : only !== null ? 1 : 0;
    turn.streakTool = only;

    const reason = this.check(turn);
    if (reason) {
      turn.tripped = true;
      // Leave the framework's trace dispatch before aborting.
      queueMicrotask(() => this.trip(event.agentName, reason));
    }
  }

  private check(turn: TurnState): string | null {
    const { maxRoundsPerTurn, maxIdenticalRounds, streaks } = this.config;
    if (maxIdenticalRounds > 0 && turn.identical >= maxIdenticalRounds) {
      return `the same tool call was repeated ${turn.identical} rounds in a row`;
    }
    const streakCap = turn.streakTool ? streaks[turn.streakTool] : undefined;
    if (streakCap && streakCap > 0 && turn.streak >= streakCap) {
      return `${turn.streak} rounds in a row called only ${turn.streakTool}`;
    }
    if (maxRoundsPerTurn > 0 && turn.rounds >= maxRoundsPerTurn) {
      return `${turn.rounds} tool rounds in one turn`;
    }
    return null;
  }

  private trip(agentName: string, reason: string): void {
    const aborted = this.framework?.abortInference(agentName, `loop-guard: ${reason}`) ?? false;
    if (!aborted) return;
    console.error(`[loop-guard] ${agentName}: turn ended (${reason})`);
    this.ctx?.notifyOps?.('loop-guard', agentName, `turn ended: ${reason}`);
    // Recorded for the agent's next turn; addMessage does not wake it.
    this.ctx?.addMessage('user', [{
      type: 'text',
      text:
        `[Your previous turn was stopped automatically: ${reason}. ` +
        `If you were stuck, try a different approach, or just reply.]`,
    }]);
  }
}

function freshTurn(): TurnState {
  return { rounds: 0, lastSignature: null, identical: 0, streakTool: null, streak: 0, tripped: false };
}

function nonNegativeInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function parseConfig(config: Record<string, unknown>): LoopGuardConfig {
  const streaks: Record<string, number> = {};
  const rawStreaks = config.streaks;
  if (rawStreaks && typeof rawStreaks === 'object' && !Array.isArray(rawStreaks)) {
    for (const [tool, cap] of Object.entries(rawStreaks)) {
      streaks[tool] = nonNegativeInt(cap, 0);
    }
  }
  return {
    maxRoundsPerTurn: nonNegativeInt(config.maxRoundsPerTurn, DEFAULTS.maxRoundsPerTurn),
    maxIdenticalRounds: nonNegativeInt(config.maxIdenticalRounds, DEFAULTS.maxIdenticalRounds),
    streaks: rawStreaks === undefined ? { ...DEFAULTS.streaks } : streaks,
  };
}

export function register(api: ExtensionApi, config: Record<string, unknown>): void {
  const parsed = parseConfig(config ?? {});
  api.registerModule(() => new LoopGuardModule(parsed));
}
