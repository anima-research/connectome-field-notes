/**
 * clock: keeps a long-running agent's sense of time current.
 *
 * The host states the time once, at session start. A resident that runs for
 * days goes on reasoning from that notice ("it's late, go to bed" at noon).
 * This module adds a `[clock]` line to the conversation when activity arrives
 * (an incoming channel message or a push event) and either the local day
 * changed or at least `everyMinutes` passed since the last line. Quiet hours
 * cost nothing, and there is at most one line per interval.
 *
 * The line is an ordinary stored message, so it stays where it was added:
 * it does not re-anchor on every turn the way a per-turn context injection
 * would, and the prompt-cache prefix is left alone.
 *
 * Load it from a recipe:
 *
 *   "extensions": {
 *     "clock": {
 *       "kind": "module",
 *       "path": "./path/to/extensions/clock/index.ts",
 *       "config": { "everyMinutes": 60 }
 *     }
 *   }
 *
 * Only type imports from @animalabs/*.
 */

import type {
  Module,
  ModuleContext,
  ProcessEvent,
  ProcessState,
  EventResponse,
  ToolDefinition,
  ToolResult,
} from '@animalabs/agent-framework';

// The host's side of the contract (connectome-host src/extensions.ts). Only
// the parts this extension uses are listed.
interface ModuleFactoryContext {
  timeZone: string;
}

interface ExtensionApi {
  registerModule(factory: (ctx: ModuleFactoryContext) => Module): void;
}

interface ClockConfig {
  /** Minimum minutes between two lines. 0 disables the module. Default 60. */
  everyMinutes?: number;
  /** IANA zone. Default: the recipe's `agent.timezone`. */
  timeZone?: string;
  /** Leave the zone name out of the line. Default false. */
  hideZone?: boolean;
}

interface ClockState {
  lastAt?: number;
  lastDay?: string;
}

class ClockModule implements Module {
  readonly name = 'clock';

  private ctx: ModuleContext | null = null;
  private readonly everyMs: number;

  constructor(
    everyMinutes: number,
    private readonly timeZone: string,
    private readonly hideZone: boolean,
    private readonly now: () => number = Date.now,
  ) {
    this.everyMs = everyMinutes * 60_000;
  }

  async start(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
  }

  async stop(): Promise<void> {
    this.ctx = null;
  }

  getTools(): ToolDefinition[] {
    return [];
  }

  async handleToolCall(): Promise<ToolResult> {
    return { success: false, isError: true, error: 'clock has no tools' };
  }

  async onProcess(event: ProcessEvent, _state: ProcessState): Promise<EventResponse> {
    const type = (event as { type: string }).type;
    if (type !== 'mcpl:channel-incoming' && type !== 'mcpl:push-event') return {};

    const at = this.now();
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: this.timeZone }).format(at);
    const last = this.ctx?.getState<ClockState>() ?? {};
    if (last.lastAt !== undefined && last.lastDay === day && at - last.lastAt < this.everyMs) return {};

    const when = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(at);
    const state: ClockState = { lastAt: at, lastDay: day };
    return {
      addMessages: [
        {
          participant: 'user',
          content: [{ type: 'text', text: `[clock] ${when}${this.hideZone ? '' : ` (${this.timeZone})`}.` }],
          metadata: { system: true, kind: 'time-marker' },
        },
      ],
      stateUpdate: state,
    };
  }
}

export function register(api: ExtensionApi, config: Record<string, unknown>): void {
  const cfg = config as ClockConfig;
  const everyMinutes =
    typeof cfg.everyMinutes === 'number' && cfg.everyMinutes >= 0 ? cfg.everyMinutes : 60;
  if (everyMinutes === 0) return;
  api.registerModule(
    (ctx) => new ClockModule(everyMinutes, cfg.timeZone ?? ctx.timeZone, cfg.hideZone === true),
  );
}
