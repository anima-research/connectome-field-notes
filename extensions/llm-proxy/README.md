# llm-proxy

A stall-proof hop between the host and OpenAI-compatible providers, with
failover.

The host's OpenAI-compatible path has no stall detection: membrane's adapter
only honours a total timeout, and the framework passes none. When Xiaomi's API
wedged, a request sat silent for about 900 s and then got a 500. That happened
10 times in one day, and the resident was frozen for 2.5 hours. Healthy first
bytes arrive in 1.6–8.4 s on every provider tried, so 45 s of silence is a
stall.

The recipe's `agent.baseUrl` points at the proxy. Each request is tried
against an attempt list (for example the direct API twice, then a gateway
with a pinned provider), with a **first-byte deadline** and an **idle
deadline** between chunks. Retryable HTTP statuses (429, 5xx and the like),
network errors and streams that end without a finish marker also move on to
the next attempt.

The upstream response is buffered completely before it goes to the host, so
a retry is invisible to it. For streaming requests, the proxy commits to the
host (200 plus SSE `: keepalive` comments every 15 s) as soon as an upstream
accepts, so the host's HTTP client doesn't give up during a long generation
(Bun drops a silent response after about 300 s). If every attempt then fails,
the stream is errored and the host retries.

Buffering means no token streaming. That is fine for a chat resident, which
posts after the turn completes, and wrong for a UI that shows tokens as they
arrive.

For: [MiMo v2.6 Pro](../../models/mimo-v2-6-pro.md) on Xiaomi's direct API.
Nothing in it is specific to that provider.

## Use it

```json
"agent": {
  "provider": "openai-compatible",
  "baseUrl": "http://127.0.0.1:7391/v1",
  "model": "mimo-v2.6-pro"
},
"extensions": {
  "llm-proxy": {
    "kind": "module",
    "path": "../connectome-field-notes/extensions/llm-proxy/index.ts",
    "config": {
      "port": 7391,
      "targets": [
        { "name": "direct", "baseUrl": "https://api.xiaomimimo.com/v1", "keyEnv": "MIMO_API_KEY" },
        { "name": "gateway", "baseUrl": "https://nano-gpt.com/api/v1", "keyEnv": "NANOGPT_API_KEY",
          "models": { "mimo-v2.6-pro": "xiaomi/mimo-v2.6-pro" },
          "headers": { "X-Provider": "deepinfra" } }
      ],
      "attempts": ["direct", "direct", "gateway"],
      "firstByteTimeoutMs": 45000,
      "idleTimeoutMs": 60000
    }
  }
}
```

| Config | Default | |
|---|---|---|
| `port` | `7391` | Listens on 127.0.0.1 only. |
| `targets` | (required) | `name`, `baseUrl`, `keyEnv` (the env var holding that target's key), optional `models` (rename per target) and `headers`. |
| `attempts` | every target once | Target names in order, one per attempt. |
| `firstByteTimeoutMs` | `45000` | |
| `idleTimeoutMs` | `60000` | Silence allowed between chunks. |
| `attemptTimeoutMs` | `900000` | Hard cap for one attempt. Thinking models can take minutes; a 480 s cap lost a real generation. |
| `logPath` | `$DATA_DIR/llm-proxy.jsonl` | One JSON line per attempt: target, status, outcome, first-byte time, duration. |

Notes:

- Keys come from the environment only. The host's own `Authorization` header
  is ignored, so the host's API key setting doesn't matter for proxied
  requests.
- The proxy starts when the host loads the extension. If the port is taken
  (another host with the same recipe, say), loading fails and the host names
  the extension in the error.
- A fallback target must accept what the primary accepts. If the resident
  sends images, check that the fallback route takes image input.
- It registers no module and no strategy, so it adds no tools.

## Tested

| | |
|---|---|
| Live | One Discord resident, MiMo v2.6 Pro on Xiaomi's direct API with a NanoGPT/DeepInfra fallback, on connectome-host 0.9.0 (`5c2baab`), membrane 0.5.86. From 2026-09-27 to 2026-10-07: 893 requests, 6 failed attempts, 3 requests rescued by a retry, 1 lost (on the first day, while the per-attempt cap was 480 s). Same code; here it is loaded as its own extension instead of from a strategy extension. |
| Checked | connectome-host main @ `e82a68e`, 2026-10-07, against fake upstreams: a first-byte stall fails over to the next target (model renamed per target); a stream that goes idle after its first chunk is retried, the host gets a committed 200 and only the good target's bytes; both are logged. The recipe in [`recipes/mimo-v2-6-pro`](../../recipes/mimo-v2-6-pro/) loads it through the host's `loadRecipe` → `loadExtensions`, and the host booted with it (mock provider). |

## What it does beyond the agent's process

- Opens an HTTP server on `127.0.0.1:<port>`.
- Sends every model request, with the API keys named in `keyEnv`, to the
  configured target URLs.
- Appends one line per attempt to `logPath`: no message content, only
  metadata, plus the first 300 characters of an error response body.
