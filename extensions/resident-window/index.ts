/**
 * resident-window: the autobiographical strategy with three changes for a
 * long-lived chat resident.
 *
 * 1. Segmentation by silence. The stock chunker closes L1 chunks on size
 *    only, so one memory can fuse a late-night thread with the next
 *    morning's unrelated one. Here a running chunk also closes at a quiet
 *    gap (`segmentGapMinutes`), once it holds at least `segmentMinTokens`,
 *    so bursts of chatter don't mint a flood of tiny L1s. It uses stored
 *    message timestamps, so imported history segments by its real times.
 *    Chunk boundaries are persisted the first time they are computed and
 *    never recomputed: decide this before the first fold.
 *
 * 2. Filler silences stay out of the live window (`hideSilentTurns`,
 *    default true). Every wake that ends in `skip_reply` leaves a turn in
 *    the verbatim tail. When ambient traffic wakes the agent every few
 *    minutes, those turns pile up, and after about 40 in a row one resident
 *    went on staying silent even when mentioned directly. The live window
 *    drops a `>>skip_reply` turn with a short (or empty) private body, or a
 *    bare `skip_reply` tool call, together with the tool_result that answers
 *    it. Longer `>>skip_reply` bodies are private notes the agent meant to
 *    keep, so they stay.
 *
 * 3. Discord reactions stay out of the live window (`hideReactions`,
 *    default false). A wake gate can stop `[reaction]` events from waking
 *    the agent, but they are still filed into context, so the next real
 *    wake arrives with a pile of them and the agent comments on them.
 *
 * 2 and 3 change the compiled window only. The store, the summaries and
 * any viewer keep everything, and the newest entry is never touched.
 *
 * This subclasses AutobiographicalStrategy and overrides two protected
 * hooks (`chunkBoundaryHint`, `pruneToolEntries`), so it depends on
 * context-manager internals. The runtime import resolves to the host's own
 * copy of @animalabs/context-manager.
 *
 * Load it from a recipe:
 *
 *   "agent": {
 *     "strategy": {
 *       "type": "autobiographical-resident",
 *       "summaryParticipant": "<the agent's name>",
 *       "segmentGapMinutes": 60,
 *       "segmentMinTokens": 500,
 *       "hideSilentTurns": true,
 *       "hideReactions": true
 *     }
 *   },
 *   "extensions": {
 *     "resident-window": { "kind": "strategy", "path": "./path/to/extensions/resident-window/index.ts" }
 *   }
 */

import { AutobiographicalStrategy } from '@animalabs/context-manager';
import type {
  AutobiographicalOptions,
  ContextEntry,
  StoredMessage,
} from '@animalabs/context-manager';

// The host's side of the contract (connectome-host src/extensions.ts). Only
// the parts this extension uses are listed.
interface StrategyFactoryContext {
  /** The recipe's whole `agent.strategy` block. */
  config: Record<string, unknown>;
  model: string;
  timeZone: string;
}

interface ExtensionApi {
  registerStrategy(type: string, factory: (ctx: StrategyFactoryContext) => unknown): void;
}

interface ResidentOptions {
  /** Minimum silence between two messages that ends a chunk. 0 disables. Default 60. */
  segmentGapMinutes?: number;
  /** Running-chunk size (about chars/4) required before a gap may close it. Default 500. */
  segmentMinTokens?: number;
  /** Leave filler `skip_reply` turns out of the live window. Default true. */
  hideSilentTurns?: boolean;
  /** Leave Discord `[reaction]` events out of the live window. Default false. */
  hideReactions?: boolean;
}

type Block = { type: string; text?: string; name?: string; id?: string; toolUseId?: string };
type Entry = { participant: string; content: Block[] };

/** `>>skip_reply` bodies up to this length are filler ("*listens* 🖤"), not private notes. */
const SILENCE_BODY_MAX_CHARS = 200;

function approxTokens(messages: readonly StoredMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    for (const b of m.content as Block[]) {
      if (b.type === 'text' && typeof b.text === 'string') chars += b.text.length;
    }
  }
  return Math.ceil(chars / 4);
}

class ResidentWindowStrategy extends AutobiographicalStrategy {
  private readonly segmentGapMs: number;
  private readonly segmentMinTokens: number;
  private readonly hideSilentTurns: boolean;
  private readonly hideReactions: boolean;
  private readonly agent: string;

  constructor(opts: AutobiographicalOptions, resident: ResidentOptions) {
    super(opts);
    this.segmentGapMs = (resident.segmentGapMinutes ?? 60) * 60_000;
    this.segmentMinTokens = resident.segmentMinTokens ?? 500;
    this.hideSilentTurns = resident.hideSilentTurns !== false;
    this.hideReactions = resident.hideReactions === true;
    this.agent = (opts as { summaryParticipant?: string }).summaryParticipant ?? 'agent';
  }

  protected override chunkBoundaryHint(
    prev: StoredMessage,
    next: StoredMessage,
    currentChunk: readonly StoredMessage[],
  ): boolean {
    if (this.segmentGapMs <= 0) return false;
    const gap = new Date(next.timestamp).getTime() - new Date(prev.timestamp).getTime();
    return gap >= this.segmentGapMs && approxTokens(currentChunk) >= this.segmentMinTokens;
  }

  /**
   * Runs before the base pass's tool pairing enforcement, and removes each
   * tool_use together with its result, so pairing stays intact.
   */
  protected override pruneToolEntries(entries: ContextEntry[]): void {
    super.pruneToolEntries(entries);
    const list = entries as unknown as Entry[];
    if (this.hideSilentTurns) this.dropFillerSilences(list);
    if (this.hideReactions) this.dropReactions(list);
  }

  private dropReactions(entries: Entry[]): void {
    const isReaction = (b: Block) => b.type === 'text' && /^\s*\[reaction\]/.test(b.text ?? '');
    const drop = new Set<number>();
    for (let i = 0; i < entries.length - 1; i++) {
      const e = entries[i]!;
      if (e.participant === this.agent || !e.content.some(isReaction)) continue;
      const rest = e.content.filter((b) => !isReaction(b));
      if (rest.length === 0) drop.add(i);
      else e.content = rest;
    }
    removeIndices(entries, drop);
  }

  private dropFillerSilences(entries: Entry[]): void {
    const text = (e: Entry) =>
      e.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    const isFillerSilence = (e: Entry) => {
      if (e.participant !== this.agent) return false;
      const t = text(e).trim();
      const skipTool = e.content.some((b) => b.type === 'tool_use' && b.name === 'skip_reply');
      const otherTools = e.content.some((b) => b.type === 'tool_use' && b.name !== 'skip_reply');
      if (otherTools) return false;
      if (/^>>skip_reply\b/.test(t)) {
        return t.replace(/^>>skip_reply\b(\s*\{\{unsent\}\})?/, '').trim().length <= SILENCE_BODY_MAX_CHARS;
      }
      return skipTool && t.length === 0;
    };
    const drop = new Set<number>();
    for (let i = 0; i < entries.length - 1; i++) {
      const e = entries[i]!;
      if (!isFillerSilence(e)) continue;
      const useIds = new Set(e.content.filter((b) => b.type === 'tool_use').map((b) => b.id ?? ''));
      if (useIds.size === 0) {
        drop.add(i);
        continue;
      }
      // Its tool_result sits in the next entry, which must not be the newest one.
      const next = entries[i + 1]!;
      if (i + 1 === entries.length - 1 && next.content.every((b) => b.type === 'tool_result')) continue;
      const rest = next.content.filter((b) => !(b.type === 'tool_result' && useIds.has(b.toolUseId ?? '')));
      if (rest.length === next.content.length) continue; // unanswered here: leave it to the pairing pass
      drop.add(i);
      if (rest.length === 0) drop.add(i + 1);
      else next.content = rest;
    }
    removeIndices(entries, drop);
  }
}

function removeIndices(entries: Entry[], drop: Set<number>): void {
  if (drop.size === 0) return;
  const kept = entries.filter((_, i) => !drop.has(i));
  entries.length = 0;
  entries.push(...kept);
}

const OWN_KEYS = ['type', 'segmentGapMinutes', 'segmentMinTokens', 'hideSilentTurns', 'hideReactions'];

export function register(api: ExtensionApi): void {
  api.registerStrategy('autobiographical-resident', ({ config, model }) => {
    const passthrough: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (!OWN_KEYS.includes(key)) passthrough[key] = value;
    }
    const opts = {
      // The host's defaults for the built-in "autobiographical" type
      // (connectome-host src/framework-strategy.ts), which a custom type
      // doesn't get.
      headWindowTokens: 4000,
      recentWindowTokens: 30000,
      compressionModel: model,
      autoTickOnNewMessage: true,
      maxMessageTokens: 10000,
      adaptiveResolution: true,
      foldingStrategy: 'kv-stable',
      ...passthrough,
    } as AutobiographicalOptions;
    return new ResidentWindowStrategy(opts, config as ResidentOptions);
  });
}
