/// <reference types="node" />
/**
 * llm-proxy: a stall-proof hop between the host and OpenAI-compatible
 * providers, with failover.
 *
 * Why: the host's OpenAI-compatible path has no stall detection. membrane's
 * adapter only honours a total timeout, and the framework passes none. When
 * Xiaomi's API wedged, a request sat silent for about 900 s until the
 * provider answered 500 (10 times in one day: the resident was frozen for
 * 2.5 hours). In a replay of a real 96k-token turn, the first byte arrived
 * in 1.6–8.4 s on every provider tried, so "nothing for 45 s" is a stall,
 * not a slow model.
 *
 * What: the recipe's `agent.baseUrl` points at http://127.0.0.1:<port>/v1.
 * Each request is tried against the configured attempt list (for example
 * the official API twice, then a gateway) with a first-byte deadline and an
 * inter-chunk idle deadline. The upstream response is buffered completely
 * before it is returned, so a retry is invisible to the host. For streaming
 * requests, the proxy commits to the host (200 plus SSE `: keepalive`
 * comments every 15 s) once an upstream accepts, so the host's HTTP client
 * never sits idle into its own timeout (about 300 s in Bun) during a long
 * generation. If every attempt then fails, the stream is errored and the
 * host retries. Before the commit, failures surface as ordinary HTTP errors.
 * Buffering means no token streaming: fine for a chat resident that posts
 * after the turn completes, not for a UI that shows tokens as they arrive.
 *
 * Keys stay env-only: each target names the env var holding its key, and
 * the host's own Authorization header is ignored. Every attempt is appended
 * as one JSON line to `logPath` (default `$DATA_DIR/llm-proxy.jsonl`).
 *
 * The server starts when the host loads the extension and listens on
 * 127.0.0.1 only. It registers no module and no strategy.
 *
 * Load it from a recipe:
 *
 *   "agent": { "provider": "openai-compatible", "baseUrl": "http://127.0.0.1:7391/v1", ... },
 *   "extensions": {
 *     "llm-proxy": {
 *       "kind": "module",
 *       "path": "./path/to/extensions/llm-proxy/index.ts",
 *       "config": {
 *         "port": 7391,
 *         "targets": [
 *           { "name": "direct", "baseUrl": "https://api.example.com/v1", "keyEnv": "PROVIDER_API_KEY" }
 *         ]
 *       }
 *     }
 *   }
 */

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

// The parts of Bun's API this file uses. connectome-host runs on Bun.
declare const Bun: {
  serve(options: {
    hostname: string;
    port: number;
    idleTimeout: number;
    fetch(req: Request): Response | Promise<Response>;
  }): { stop(closeActiveConnections?: boolean): void; unref(): void };
  sleep(ms: number): Promise<void>;
};

export interface ProxyTarget {
  name: string;
  baseUrl: string;
  /** Env var holding this target's API key. */
  keyEnv: string;
  /** Model rename for this target (request model → target model). */
  models?: Record<string, string>;
  /** Extra request headers, e.g. a gateway's provider pin. */
  headers?: Record<string, string>;
}

export interface ProxyConfig {
  /** Default 7391. */
  port?: number;
  targets: ProxyTarget[];
  /** Target names in order, one per attempt. Default: every target once. */
  attempts?: string[];
  /** Default 45000. */
  firstByteTimeoutMs?: number;
  /** Default 60000. */
  idleTimeoutMs?: number;
  /** Hard cap for one attempt, streaming included. Default 900000. */
  attemptTimeoutMs?: number;
  /** Default `$DATA_DIR/llm-proxy.jsonl`, with DATA_DIR defaulting to ./data like the host. */
  logPath?: string;
}

type Outcome = 'ok' | 'http-error' | 'stall-first-byte' | 'stall-idle' | 'timeout' | 'network' | 'truncated';

interface AttemptResult {
  status: number;
  headers?: Headers;
  bytes?: Buffer;
  error?: string;
  kind?: Outcome;
  model: string;
  timing: { firstByte?: number; end?: number };
}

interface Limits {
  firstByteTimeoutMs: number;
  idleTimeoutMs: number;
  attemptTimeoutMs: number;
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529]);

class Deadline extends Error {
  constructor(readonly kind: Outcome) {
    super(kind);
  }
}

async function attempt(
  target: ProxyTarget,
  path: string,
  body: Record<string, unknown>,
  limits: Limits,
  onAccepted: () => void,
): Promise<AttemptResult> {
  const key = process.env[target.keyEnv];
  if (!key) throw new Error(`llm-proxy: ${target.keyEnv} is not set for target ${target.name}`);
  const model = target.models?.[body.model as string] ?? (body.model as string);
  const payload = JSON.stringify({ ...body, model });
  const ctl = new AbortController();
  const t0 = performance.now();
  const timing: { firstByte?: number; end?: number } = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number, kind: Outcome) => {
    clearTimeout(timer);
    timer = setTimeout(() => ctl.abort(new Deadline(kind)), ms);
  };
  const hard = setTimeout(() => ctl.abort(new Deadline('timeout')), limits.attemptTimeoutMs);
  try {
    arm(limits.firstByteTimeoutMs, 'stall-first-byte');
    const res = await fetch(target.baseUrl.replace(/\/$/, '') + path, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...(target.headers ?? {}) },
      body: payload,
    });
    if (res.status === 200) onAccepted();
    const chunks: Uint8Array[] = [];
    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (timing.firstByte === undefined) timing.firstByte = performance.now() - t0;
        chunks.push(value);
        arm(limits.idleTimeoutMs, 'stall-idle');
      }
    }
    timing.end = performance.now() - t0;
    return { status: res.status, headers: res.headers, bytes: Buffer.concat(chunks), model, timing };
  } catch (err) {
    const reason = ctl.signal.reason;
    const kind: Outcome = reason instanceof Deadline ? reason.kind : 'network';
    return {
      status: 0,
      error: kind === 'network' ? String((err as Error)?.message ?? err) : kind,
      kind,
      model,
      timing: { ...timing, end: performance.now() - t0 },
    };
  } finally {
    clearTimeout(timer);
    clearTimeout(hard);
  }
}

export function startLlmProxy(cfg: ProxyConfig): { port: number; stop(): void } {
  const port = cfg.port ?? 7391;
  const targets = new Map(cfg.targets.map((t) => [t.name, t]));
  const plan = (cfg.attempts ?? cfg.targets.map((t) => t.name)).map((n) => {
    const t = targets.get(n);
    if (!t) throw new Error(`llm-proxy: attempts names unknown target "${n}"`);
    return t;
  });
  if (plan.length === 0) throw new Error('llm-proxy: no targets configured');
  const limits: Limits = {
    firstByteTimeoutMs: cfg.firstByteTimeoutMs ?? 45_000,
    idleTimeoutMs: cfg.idleTimeoutMs ?? 60_000,
    attemptTimeoutMs: cfg.attemptTimeoutMs ?? 900_000,
  };
  const log = (row: Record<string, unknown>) => {
    if (!cfg.logPath) return;
    try {
      appendFileSync(cfg.logPath, JSON.stringify(row) + '\n');
    } catch {
      /* logging must never break a request */
    }
  };
  let seq = 0;

  async function runAttempts(id: string, started: number, path: string, body: Record<string, unknown>, onAccepted: () => void) {
    let last: AttemptResult | null = null;
    let lastTarget = plan[0]!;
    let lastOutcome: Outcome = 'network';
    for (let i = 0; i < plan.length; i++) {
      const target = plan[i]!;
      const r = await attempt(target, path, body, limits, onAccepted);
      // A 200 stream that ends without a finish marker was cut upstream: retry it.
      const tail = r.status === 200 && body.stream ? r.bytes!.subarray(-4096).toString('utf8') : '';
      const truncated = r.status === 200 && !!body.stream && !/\[DONE\]|"finish_reason"\s*:\s*"[a-z_]+"/.test(tail);
      const retryable = r.status === 0 || truncated || RETRYABLE_STATUS.has(r.status);
      const outcome: Outcome = r.status === 0 ? r.kind! : truncated ? 'truncated' : r.status >= 400 ? 'http-error' : 'ok';
      log({
        at: new Date(started).toISOString(), id, attempt: i + 1, of: plan.length, target: target.name, model: r.model,
        stream: !!body.stream, status: r.status, outcome, firstByteMs: r.timing.firstByte ?? null, ms: Math.round(r.timing.end ?? 0),
        ...(r.error ? { error: String(r.error).slice(0, 300) } : {}),
        ...(outcome === 'http-error' ? { body: (r.bytes ?? Buffer.alloc(0)).toString('utf8').slice(0, 300) } : {}),
      });
      last = r;
      lastTarget = target;
      lastOutcome = outcome;
      if (outcome === 'ok' || !retryable) break;
      if (i + 1 < plan.length) await Bun.sleep(r.status === 429 ? 5000 : 1500);
    }
    return { last: last!, lastTarget, outcome: lastOutcome };
  }

  function finalize(last: AttemptResult, lastTarget: ProxyTarget): Response {
    if (last.status > 0) {
      const headers = new Headers();
      const ct = last.headers?.get('content-type');
      if (ct) headers.set('content-type', ct);
      headers.set('x-llm-proxy-target', lastTarget.name);
      return new Response(new Uint8Array(last.bytes!), { status: last.status, headers });
    }
    return Response.json(
      {
        error: {
          message: `llm-proxy: every attempt failed (${plan.map((t) => t.name).join(' → ')}); last: ${last.error ?? 'unknown'}`,
          type: 'upstream_unavailable',
        },
      },
      { status: 503 },
    );
  }

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    idleTimeout: 0, // the host waits on us while we retry upstream
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === 'GET' && url.pathname === '/health') {
        return Response.json({ ok: true, plan: plan.map((t) => t.name), limits });
      }
      if (req.method !== 'POST') return new Response('llm-proxy: POST only', { status: 405 });
      const path = url.pathname.replace(/^\/v1/, '');
      let body: Record<string, unknown>;
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return Response.json({ error: { message: 'llm-proxy: invalid JSON body' } }, { status: 400 });
      }
      const id = `${Date.now().toString(36)}-${(seq++).toString(36)}`;
      const started = Date.now();

      // Streaming: once an upstream accepts (HTTP 200), commit to the host with
      // our own 200 and SSE comment keepalives every 15 s while we buffer, so
      // the host's HTTP client never sits idle long enough to give up. Retries
      // after the commit stay invisible; if every attempt fails after it, the
      // stream is errored and the host retries.
      if (body.stream) {
        const enc = new TextEncoder();
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
          },
        });
        let committed = false;
        let keepalive: ReturnType<typeof setInterval> | undefined;
        let resolveFirst!: (r: Response) => void;
        const first = new Promise<Response>((r) => {
          resolveFirst = r;
        });
        const commit = () => {
          if (committed) return;
          committed = true;
          keepalive = setInterval(() => {
            try {
              controller.enqueue(enc.encode(': keepalive\n\n'));
            } catch {
              /* closed */
            }
          }, 15_000);
          resolveFirst(
            new Response(stream, {
              status: 200,
              headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-llm-proxy': 'committed' },
            }),
          );
        };
        void runAttempts(id, started, path, body, commit)
          .then(({ last, lastTarget, outcome }) => {
            clearInterval(keepalive);
            if (!committed) {
              resolveFirst(finalize(last, lastTarget));
              return;
            }
            if (outcome === 'ok') {
              controller.enqueue(new Uint8Array(last.bytes!));
              controller.close();
            } else {
              controller.error(new Error(`llm-proxy: every attempt failed after the upstream accepted (${outcome})`));
            }
          })
          .catch((err) => {
            clearInterval(keepalive);
            if (committed) controller.error(err);
            else resolveFirst(Response.json({ error: { message: `llm-proxy: ${String(err?.message ?? err)}` } }, { status: 502 }));
          });
        return first;
      }

      const { last, lastTarget } = await runAttempts(id, started, path, body, () => {});
      return finalize(last, lastTarget);
    },
  });

  // Don't keep the host alive on our account: when the host is done, so are we.
  server.unref();

  console.error(
    `[llm-proxy] listening on http://127.0.0.1:${port}/v1 · attempts ${plan.map((t) => t.name).join(' → ')} · ` +
      `first byte ${limits.firstByteTimeoutMs / 1000}s · idle ${limits.idleTimeoutMs / 1000}s`,
  );
  return { port, stop: () => server.stop(true) };
}

// The host's side of the contract (connectome-host src/extensions.ts). This
// extension registers nothing; it only starts the proxy.
interface ExtensionApi {
  registerModule(factory: (ctx: unknown) => unknown): void;
}

let started = false;

export function register(_api: ExtensionApi, config: Record<string, unknown>): void {
  if (started) return;
  const cfg = config as unknown as ProxyConfig;
  if (!Array.isArray(cfg.targets) || cfg.targets.length === 0) {
    throw new Error('llm-proxy: config.targets must list at least one target');
  }
  startLlmProxy({ ...cfg, logPath: cfg.logPath ?? join(process.env.DATA_DIR || './data', 'llm-proxy.jsonl') });
  started = true;
}
