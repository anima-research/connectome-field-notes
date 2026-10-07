/**
 * operator-interrupt: let an operator stop the agent's current turn from chat.
 *
 * When a message from an operator starts with the interrupt phrase (default
 * `!interrupt`), any turn in progress is aborted through the framework's
 * public `abortInference`, and the agent gets a short note saying the
 * operator interrupted it. Other operator messages are left alone, so normal
 * conversation mid-turn (hear-while-acting) is unaffected.
 *
 * Why: a model stuck in a long self-continuation or tool loop keeps going
 * while ordinary messages either queue behind the turn or get answered as
 * more chat. Without this, the reliable brake is revoking the API key.
 *
 * Load it from a recipe:
 *
 *   "extensions": {
 *     "operator-interrupt": {
 *       "kind": "module",
 *       "path": "./path/to/extensions/operator-interrupt/index.ts",
 *       "config": { "operators": ["${OPERATOR_USER_ID}"] }
 *     }
 *   }
 *
 * Only type imports from @animalabs/*: they are erased at runtime, so this
 * file has no runtime dependency on any framework version. Node's fs is used
 * only when `operatorsFile` is configured.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import type {
  ContentBlock,
  EventResponse,
  McplChannelIncomingEvent,
  McplPushEvent,
  Module,
  ModuleContext,
  ProcessEvent,
  ProcessState,
  ToolCall,
  ToolDefinition,
  ToolResult,
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

/** The two public framework methods this module calls (handed over by the
 *  host through `setFramework` once the framework exists). */
interface FrameworkHandle {
  abortInference(agentName: string, reason?: string): boolean;
  getAllAgents(): Array<{ name: string }>;
}

export interface OperatorInterruptConfig {
  /** Phrase that must start the operator's message (case-insensitive,
   *  after any leading mentions). */
  phrase: string;
  /** Operator user ids, e.g. Discord user ids. */
  operators: string[];
  /** Optional JSON file of operator ids, re-read when it changes. Same format
   *  as the gate's privileged-users file: a bare array or `{ "userIds": [...] }`,
   *  so the two can share one file. */
  operatorsFile?: string;
  /** Note added to the agent's context after an interrupt. */
  note: string;
}

const DEFAULTS = {
  phrase: '!interrupt',
  note: '[Your turn was interrupted by the operator.]',
};

/** Leading `<@123>` / `<@!123>` / `@name` mentions before the phrase. */
const LEADING_MENTIONS = /^(\s*(<@!?\d+>|@\S+)[\s,:]*)+/;

export class OperatorInterruptModule implements Module {
  readonly name = 'operator-interrupt';

  private ctx: ModuleContext | null = null;
  private framework: FrameworkHandle | null = null;
  private fileIds = new Set<string>();
  private fileMtime = -1;

  constructor(private readonly config: OperatorInterruptConfig) {}

  /** Called by the host once the framework exists. */
  setFramework(framework: FrameworkHandle): void {
    this.framework = framework;
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

  async handleToolCall(call: ToolCall): Promise<ToolResult> {
    return { success: false, isError: true, error: `Unknown tool: ${call.name}` };
  }

  async onProcess(event: ProcessEvent, _state: ProcessState): Promise<EventResponse> {
    const incoming = this.readIncoming(event);
    if (!incoming || !this.isOperator(incoming.authorId)) return {};
    if (!this.startsWithPhrase(incoming.text)) return {};

    const framework = this.framework;
    if (!framework) {
      console.error('[operator-interrupt] interrupt requested, but the host never provided the framework handle');
      return {};
    }

    const targets = incoming.targetAgents ?? framework.getAllAgents().map((a) => a.name);
    for (const agentName of targets) {
      if (framework.abortInference(agentName, 'operator-interrupt')) {
        console.error(`[operator-interrupt] ${agentName}: turn interrupted by operator ${incoming.authorId}`);
        // Recorded for the agent's next turn; addMessage does not wake it.
        this.ctx?.addMessage('user', [{ type: 'text', text: this.config.note }]);
      }
    }
    return {};
  }

  /** Author, text and target agents of a channel message or a DM push event. */
  private readIncoming(
    event: ProcessEvent,
  ): { authorId: string; text: string; targetAgents?: string[] } | null {
    if (event.type === 'mcpl:channel-incoming') {
      const e = event as McplChannelIncomingEvent;
      return { authorId: String(e.author.id), text: textOf(e.content), targetAgents: e.targetAgents };
    }
    if (event.type === 'mcpl:push-event') {
      // Discord DMs (and mentions in unopened channels) arrive this way.
      const e = event as McplPushEvent;
      const authorId = e.origin?.authorId;
      if (authorId == null) return null;
      return { authorId: String(authorId), text: textOf(e.content), targetAgents: e.targetAgents };
    }
    return null;
  }

  private isOperator(authorId: string): boolean {
    if (this.config.operators.includes(authorId)) return true;
    this.reloadOperatorsFile();
    return this.fileIds.has(authorId);
  }

  private reloadOperatorsFile(): void {
    const path = this.config.operatorsFile;
    if (!path) return;
    try {
      if (!existsSync(path)) {
        this.fileIds = new Set();
        this.fileMtime = -1;
        return;
      }
      const mtime = statSync(path).mtimeMs;
      if (mtime === this.fileMtime) return;
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      const ids: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.userIds) ? raw.userIds : [];
      this.fileIds = new Set(ids.map(String));
      this.fileMtime = mtime;
    } catch (error) {
      console.error(`[operator-interrupt] could not read operatorsFile ${path}:`, error);
    }
  }

  private startsWithPhrase(text: string): boolean {
    const rest = text.replace(LEADING_MENTIONS, '').trimStart().toLowerCase();
    const phrase = this.config.phrase.toLowerCase();
    if (!rest.startsWith(phrase)) return false;
    // A whole word: "!interrupt" or "!interrupt please", not "!interrupted".
    const next = rest.charAt(phrase.length);
    return next === '' || /\s|[.,!?:;]/.test(next);
  }
}

function textOf(content: ContentBlock[] | undefined): string {
  return (content ?? [])
    .filter((b): b is ContentBlock & { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

export function parseConfig(config: Record<string, unknown>): OperatorInterruptConfig {
  const phrase = typeof config.phrase === 'string' && config.phrase.trim() ? config.phrase.trim() : DEFAULTS.phrase;
  const operators = Array.isArray(config.operators)
    ? config.operators.map(String).filter((id) => id.trim() !== '')
    : [];
  const operatorsFile =
    typeof config.operatorsFile === 'string' && config.operatorsFile.trim() ? config.operatorsFile : undefined;
  const note = typeof config.note === 'string' && config.note.trim() ? config.note : DEFAULTS.note;
  if (operators.length === 0 && !operatorsFile) {
    throw new Error('operator-interrupt needs "operators" (user ids) or "operatorsFile" in its config');
  }
  return { phrase, operators, operatorsFile, note };
}

export function register(api: ExtensionApi, config: Record<string, unknown>): void {
  const parsed = parseConfig(config ?? {});
  api.registerModule(() => new OperatorInterruptModule(parsed));
}
