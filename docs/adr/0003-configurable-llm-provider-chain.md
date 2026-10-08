# 3. Configurable LLM Provider Chain

Task parsing, affirmations, reminder copy, morning pantun, and image screening call a configurable chain of LLM providers. The chain order lives in environment variables. A local fallback is always last. The bot is not locked to Gemini.

## Context

The previous code hardcoded Gemini, then the Antigravity CLI bridge, then a local parser. The same client and fallback were copied across five services. Timeouts used `Promise.race`, so a slow Gemini request kept running after the caller moved on. The bridge listened on all interfaces without authentication. Model output was parsed with `JSON.parse` and no schema check.

Operators need to reorder providers, add an OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq, Ollama, or Gemini's compatibility endpoint), and keep the bot working when one provider is down. The deployment target is still a small VPS, so a self-hosted gateway such as LiteLLM is out of scope. See [the research note](../research/configurable-llm-provider-chain.md).

## Decision

- One `LlmProvider` interface and a chain runner in `src/services/llm/`. Adapters: Gemini via `@google/genai`, OpenAI-compatible via `fetch`, Anthropic via `fetch`, and the Antigravity bridge.
- Order comes from `LLM_CHAIN_*`. With no new variables, behavior matches the previous tiers: Gemini, then Antigravity when a URL is set, then local. Morning pantun and vision stay Gemini then local unless overridden.
- `local` is always the terminal tier. Startup fails if the config names an unknown provider, repeats one, puts anything after `local`, uses `http://` to a public host that is not allowlisted, or lists a provider that has no key. Plain `http://` to loopback, private-network, and in-server hosts (Docker service names, `*.internal`) is allowed, because that traffic never leaves the server.
- Each attempt uses `AbortSignal.timeout`. The chain has a total time budget. A provider that fails auth or quota is skipped until its circuit breaker cools down. Requests are not sent to two providers at once.
- Model output is validated in the app. Instructions stay in the system prompt. User text is wrapped in `<pesan_pengguna>` and length-limited.
- The bridge binds to `127.0.0.1` by default, requires a bearer token when `ANTIGRAVITY_BRIDGE_TOKEN` is set, caps body size and concurrency, and does not return stderr to the caller.
- Schema checks are written in code. A validator library was not added; the output shapes are fixed and small.

## Consequences

- New providers that speak the Chat Completions API need only `OPENAI_API_KEY`, `OPENAI_MODEL`, and `OPENAI_BASE_URL`.
- Anthropic is optional and uses its own key and model.
- Cancelling a Gemini request still does not stop the provider from billing that request.
- Vision screening still fails open when every provider fails. That is unchanged product behavior.
- `Promise.race` timeouts are gone from these paths. Callers that inject a fake Gemini client still work.

## Amendment (Oct 2026): Antigravity vision

The bridge now accepts images. It validates type and size, writes them to a private temp dir, passes the dir to `agy` with `--add-dir`, and deletes it afterwards. `antigravity` is therefore a valid `LLM_CHAIN_VISION` entry. The CLI takes 13–30 s per image, so the vision budget (`LLM_VISION_BUDGET_MS`) defaults to the full LLM budget when `antigravity` is in the vision chain, and stays at 8 s otherwise. Non-vision providers inherited from `LLM_CHAIN_DEFAULT` are dropped from the vision chain with a warning instead of failing startup.
