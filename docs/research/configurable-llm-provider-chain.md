# Rantai Provider LLM yang Dapat Dikonfigurasi: Urutan via Env, Multi-Provider, Aman, dan Andal

**Keputusan:** jadikan urutan tier AI sebagai konfigurasi env per operasi, misalnya `LLM_CHAIN_NLP=gemini,openai,antigravity,local`. Validasi konfigurasi ini sekali saat startup dan hentikan proses jika konfigurasi salah (fail-fast). `local` selalu menjadi tier terakhir yang dijamin tersedia. Bangun abstraksi tipis buatan sendiri: satu interface `LlmProvider`, adapter **Gemini** yang tetap memakai `@google/genai`, adapter **OpenAI-compatible** berbasis `fetch` yang mencakup OpenAI, OpenRouter, dan endpoint OpenAI-compatible Gemini, adapter **Antigravity bridge**, dan satu *chain runner*. Chain runner menangani timeout per percobaan dengan pembatalan nyata, total latency budget, klasifikasi error, dan circuit breaker per provider. Jangan memakai gateway self-hosted seperti LiteLLM pada VPS 512 MB–1 GB. Vercel AI SDK layak dipertimbangkan nanti jika jumlah provider bertambah, tetapi SDK itu tidak menghilangkan kebutuhan chain runner sendiri. Default tanpa env baru harus identik dengan perilaku sekarang: `gemini,antigravity,local`. Sebelum menambah provider, perkuat Antigravity bridge terlebih dahulu karena saat ini bridge tersebut tidak memiliki autentikasi.

Dokumen ini memisahkan **fakta terverifikasi** yang disertai tautan sumber dari **rekomendasi** yang merupakan inferensi untuk repository ini.

## Kondisi saat ini (fakta dari kode)

Pola "singleton Gemini → bridge → fallback lokal" ditulis ulang di lima service:

| Operasi | Lokasi | Tier saat ini | Timeout | Catatan |
|---|---|---|---|---|
| `nlp_parse` | [nlp.ts](../../src/services/nlp.ts#L493-L650) | Gemini → bridge → `parseLocalTask` | 3 s via `Promise.race` ([L497-L513](../../src/services/nlp.ts#L497-L513)); bridge 25 s via `AbortController` ([L398-L399](../../src/services/nlp.ts#L398-L399)) | Request Gemini tidak dibatalkan, hanya diabaikan |
| `affirmation` | [affirmation.ts](../../src/services/affirmation.ts#L26-L89) | Gemini → bridge → JSON lokal | 3 s `Promise.race` | Jalur bridge tidak mencatat telemetry ([L78-L84](../../src/services/affirmation.ts#L78-L84)) |
| `reminder_message` | [reminder.ts](../../src/services/reminder.ts#L281-L341) | Gemini → bridge → template | 3 s `Promise.race` | Jalur bridge tidak mencatat telemetry |
| `morning_motivation` | [morning-digest.ts](../../src/services/morning-digest.ts#L487-L544) | Hanya Gemini; caller memakai pantun lokal | 1,8 s via `abortSignal` SDK | Satu-satunya jalur yang sudah membatalkan request secara nyata |
| `vision_screen` | [media.ts](../../src/services/media.ts#L194-L267) | Hanya Gemini | 4 s `Promise.race` | Jika AI tidak tersedia atau gagal, hasilnya `isSuspicious: false` (fail-open) ([L201-L208](../../src/services/media.ts#L201-L208), [L258-L265](../../src/services/media.ts#L258-L265)) |

Celah yang relevan:

- **Urutan di-hardcode.** Gemini selalu menjadi tier pertama. Bridge hanya dipakai jika `ANTIGRAVITY_BRIDGE_URL` terisi ([nlp.ts](../../src/services/nlp.ts#L582-L583)).
- **Konfigurasi tidak divalidasi.** Nilai dibaca dengan pola `process.env.X || default` ([config](../../src/config/index.ts#L1-L25)). Typo nama variabel atau URL yang salah baru terlihat saat runtime.
- **Output tidak divalidasi schema.** Pagar markdown dibuang, lalu teks di-`JSON.parse`. Bridge mengambil `{...}` pertama dengan regex ([L515-L517](../../src/services/nlp.ts#L515-L517), [L588-L590](../../src/services/nlp.ts#L588-L590)). Post-processing Gemini dan bridge diduplikasi hampir baris per baris ([L533-L570](../../src/services/nlp.ts#L533-L570) dan [L598-L635](../../src/services/nlp.ts#L598-L635)).
- **Permukaan prompt injection.** Teks pengguna diinterpolasi mentah di dalam tanda kutip pada prompt yang sama dengan instruksi ([L473-L491](../../src/services/nlp.ts#L473-L491)). Nama task juga diinterpolasi ke prompt affirmation dan reminder ([affirmation.ts](../../src/services/affirmation.ts#L27)).
- **Bridge tanpa autentikasi.** Bridge bind ke `0.0.0.0` secara default ([bridge](../../scripts/antigravity-bridge.ts#L12-L13)) tanpa pemeriksaan token. Setiap request menjalankan `agy -p <prompt>` dan prompt dikirim lewat argv ([L42-L45](../../scripts/antigravity-bridge.ts#L42-L45)). Bridge tidak memiliki batas concurrency, timeout proses, atau batas body. Isi stderr juga dikembalikan ke caller ([L52-L55](../../scripts/antigravity-bridge.ts#L52-L55)).
- **Telemetry sudah memiliki label provider.** `recordAiUsage` mencatat `operation`, `provider`, `outcome`, durasi, dan token ([telemetry.ts](../../src/services/telemetry.ts#L179-L208)). Fondasi observability ini dapat dipakai ulang.
- **Konvensi repo.** Seam 1 mewajibkan struktur "coba AI, lalu fallback ke `parseLocalTask`". Seam 4 mewajibkan affirmation tidak pernah gagal ([AGENTS.md](../../AGENTS.md)). ADR 0002 menyimpan kredensial di `.env` ([ADR 0002](../adr/0002-database-backed-settings.md)). Test menginjeksi `geminiClient` palsu ([nlp.test.ts](../../test/services/nlp.test.ts#L49-L65), [affirmation.test.ts](../../test/services/affirmation.test.ts)).

## Fakta eksternal yang sudah diverifikasi

### Runtime dan konfigurasi

- Bun otomatis memuat `.env`, `.env.<NODE_ENV>`, dan `.env.local`. Bun juga **mengekspansi `$VAR`** di dalam nilai `.env`. Karakter `$` harus di-escape agar tidak diekspansi ([Bun env docs](https://bun.com/docs/runtime/environment-variables)). Token atau secret yang mengandung `$` dapat rusak secara diam-diam.
- `.env` sudah dikecualikan dari image Docker ([.dockerignore](../../.dockerignore)). Compose menyuntikkan env melalui `env_file` ([docker-compose.yml](../../docker-compose.yml#L5-L6)).
- `AbortSignal.any()` menggabungkan beberapa signal. `AbortSignal.timeout()` menghasilkan abort dengan `TimeoutError` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static)). `fetch` Bun menerima `signal: AbortSignal.timeout(ms)` ([Bun fetch](https://bun.com/docs/runtime/networking/fetch)). Kedua API tersedia dan berperilaku sesuai pengujian lokal pada Bun 1.4.2.
- `Bun.serve` bind ke `0.0.0.0` secara default. `Bun.serve` juga menutup koneksi setelah **10 detik idle**, termasuk request yang handler-nya belum menulis byte respons ([Bun server](https://bun.com/docs/runtime/http/server)). Bridge tidak mengatur `idleTimeout`, padahal client menunggu sampai 25 detik. Karena itu, panggilan `agy` yang lebih lama dari sekitar 10 detik kemungkinan besar diputus server. Ini inferensi dari dokumentasi dan perlu dibuktikan dengan test.
- Batas body default `Bun.serve` adalah 128 MB ([bun-types `maxRequestBodySize`](https://github.com/oven-sh/bun/blob/main/packages/bun-types/serve.d.ts)). `Bun.spawn` mendukung `stdin` (`"pipe"`, `Blob`, dan lain-lain), `timeout`, `killSignal`, dan `AbortSignal` ([Bun spawn](https://bun.com/docs/runtime/child-process)). `Bun.serve` dan `fetch` juga mendukung Unix domain socket ([server](https://bun.com/docs/runtime/http/server), [fetch](https://bun.com/docs/runtime/networking/fetch)).

### SDK dan opsi abstraksi

- `@google/genai` 2.24.0 yang terpasang menerima `abortSignal` per request. Type SDK mencatat bahwa abort hanya terjadi di sisi client. Request di server tidak ikut dibatalkan, dan pemakaian **tetap ditagih**. Retry SDK hanya aktif jika `retryOptions` diberikan. Default retry mencakup kode 408, 429, dan 5xx dengan maksimal lima percobaan ([genai.d.ts](../../node_modules/@google/genai/dist/genai.d.ts), [kode `apiCall`](../../node_modules/@google/genai/dist/node/index.mjs); repo: [js-genai](https://github.com/googleapis/js-genai)).
- Gemini menyediakan endpoint OpenAI-compatible di `https://generativelanguage.googleapis.com/v1beta/openai/`. Endpoint ini mendukung structured output dan input gambar `image_url`, tetapi masih **beta**. Google merekomendasikan API Gemini langsung jika aplikasi belum memakai library OpenAI ([Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)).
- Vercel AI SDK menyediakan structured output melalui `generateText` dengan `Output.object({ schema })`. Schema dapat ditulis dengan Zod, Valibot, atau JSON Schema. SDK melempar `NoObjectGeneratedError` jika output tidak lolos validasi ([structured data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)). Default `maxRetries` adalah **2**, dan SDK mendukung `abortSignal` serta `timeout` ([generateText](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text)). `createProviderRegistry` hanya memetakan ID `provider:model` dan middleware. Dokumentasinya tidak menyediakan fallback antarprovider ([provider registry](https://ai-sdk.dev/docs/reference/ai-sdk-core/provider-registry)). Paket `@ai-sdk/openai-compatible` tersedia untuk endpoint OpenAI-compatible ([docs](https://ai-sdk.dev/providers/openai-compatible-providers)).
- Ukuran paket dari npm registry per 8 Okt 2026 (unpacked):

| Paket | Ukuran | Catatan |
|---|---|---|
| `ai` | 8,0 MB | `ai@7.0.133`, bergantung pada `@ai-sdk/gateway` dan `provider-utils` |
| `@ai-sdk/google` | 2,3 MB | — |
| `@ai-sdk/openai` | 3,1 MB | — |
| `@ai-sdk/openai-compatible` | 0,4 MB | — |
| `openai` | 21,0 MB | — |
| `@anthropic-ai/sdk` | 13,1 MB | — |
| `zod` | 6,1 MB | — |
| `valibot` | 1,9 MB | — |
| `@google/genai` | 11,9 MB | Sudah terpasang |

  Ukuran unpacked bukan ukuran RAM, tetapi menjadi indikator jumlah dependency.
- OpenRouter mendukung array `models` sebagai fallback server-side. Setiap error dapat memicu fallback, dan biaya mengikuti model yang akhirnya dipakai ([OpenRouter model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)).
- LiteLLM Proxy merekomendasikan **1 vCPU dan 4 Gi memori per pod**. Dokumentasinya menyebut 4 Gi sebagai batas bawah ([LiteLLM production](https://docs.litellm.ai/docs/proxy/prod), [fallbacks](https://docs.litellm.ai/docs/proxy/reliability)).

### Structured output

- **Gemini** mendukung subset JSON Schema melalui `response_format`. Gemini 3.1 Flash-Lite, model default repo ini, termasuk model yang didukung. Google menegaskan bahwa structured output menjamin JSON yang valid secara sintaks, tetapi **tidak menjamin nilainya benar secara semantik**. Aplikasi harus tetap memvalidasi hasilnya ([Gemini structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)). SDK terpasang menandai `responseMimeType` dan `responseSchema` lama sebagai deprecated dan menggantinya dengan `responseFormat` ([genai.d.ts](../../node_modules/@google/genai/dist/genai.d.ts)).
- **OpenAI** Structured Outputs menjamin respons mengikuti JSON Schema yang diberikan, termasuk field wajib dan nilai enum. Chat Completions menerima `response_format`, termasuk helper `zodResponseFormat` ([OpenAI structured outputs](https://platform.openai.com/docs/guides/structured-outputs)).
- **Anthropic** menyediakan JSON outputs melalui `output_config.format` (`type: "json_schema"`) dan *strict tool use*. Keduanya memakai constrained decoding dengan beberapa batasan JSON Schema ([Anthropic structured outputs](https://docs.anthropic.com/en/docs/build-with-claude/structured-outputs)).

### Reliability

- Google merekomendasikan exponential backoff dengan jitter dan batas jumlah retry. Retry hanya untuk error transien seperti 429, 408, dan 5xx; jangan me-retry 400, 402, atau 403 ([Gemini troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting)).
- AWS menunjukkan bahwa backoff tanpa jitter tetap menghasilkan lonjakan retry yang bergerombol. *Full jitter* mengurangi pekerjaan client secara signifikan ([AWS Architecture Blog](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)).
- Di Anthropic, 429 karena spend cap **tidak memiliki header `retry-after` dan akan terus gagal**. 529 berarti layanan overloaded. SDK resmi Anthropic melakukan retry dua kali secara default ([Anthropic errors](https://docs.anthropic.com/en/api/errors)). `Retry-After` dapat berupa jumlah detik atau HTTP-date ([RFC 9110 §10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after)).
- Circuit breaker memakai state Closed, Open, dan Half-Open. Pola ini menolak cepat operasi yang kemungkinan besar gagal. Retry harus berhenti saat breaker terbuka. Error yang menunjukkan layanan overload dapat langsung membuka breaker (*accelerated circuit breaking*). Breaker juga sebaiknya dipisah per resource independen ([Azure Circuit Breaker](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)).

## Perbandingan opsi abstraksi multi-LLM

Penilaian berikut merupakan rekomendasi untuk repo ini, berdasarkan fakta di atas.

| Opsi | Dependency/RAM | Structured output | Vision | Fallback dan breaker | Lock-in | Beban maintenance |
|---|---|---|---|---|---|---|
| **(a) Interface sendiri + adapter (`@google/genai` + `fetch`)** | Tanpa paket baru selain validator | Per adapter: `responseFormat` untuk Gemini, `response_format` untuk OpenAI | Gemini native; OpenAI-compatible jika endpoint mendukung `image_url` | Ditulis sendiri dan dapat dikontrol penuh | Rendah | Sedang: sekitar tiga adapter kecil dan perlu mengikuti perubahan API |
| (b) Vercel AI SDK | `ai` dan paket provider, sekitar 10 MB+ unpacked | Seragam melalui `Output.object` + Zod | Seragam melalui `ImagePart` | **Tidak tersedia secara built-in**; `maxRetries` harus diatur ke 0 | Rendah ke provider, tetapi sedang ke SDK karena versi mayor sering berubah | Rendah untuk adapter, tetapi tetap perlu chain runner sendiri |
| (c) Hanya OpenAI-compatible, termasuk Gemini via `/v1beta/openai/` | Paling kecil, cukup `fetch` | Bervariasi antar endpoint; Gemini compat masih beta | Bervariasi | Ditulis sendiri | Rendah | Rendah, tetapi fitur khusus seperti `thinkingLevel` bergantung pada `extra_body` |
| (d1) LiteLLM Proxy | **≥ 4 Gi per pod**, tidak sesuai target 512 MB–1 GB | Ya | Ya | Built-in | Sedang | Tinggi: service Python tambahan beserta DB atau Redis |
| (d2) OpenRouter `models` | Nol di host | Bergantung model | Bergantung model | Built-in di sisi server | Sedang: pihak ketiga baru di jalur data | Rendah, tetapi menjadi titik gagal tunggal baru |

**Rekomendasi:** gunakan **(a)**. Adapter Gemini tetap native karena repo sudah memakai `thinkingLevel`, `abortSignal`, dan vision. Satu adapter **OpenAI-compatible** berbasis `fetch` dapat dipakai untuk OpenAI, OpenRouter, atau endpoint OpenAI-compatible lain melalui `OPENAI_BASE_URL`. OpenRouter dapat menjadi salah satu entri chain tanpa menjadi fondasi arsitektur. Adapter Anthropic native via `fetch` ke Messages API dapat ditambahkan jika benar-benar dibutuhkan. Alasan utamanya adalah dua operasi inti di repo ini sederhana: JSON terstruktur dan teks pendek. Fallback, budget, dan breaker juga tetap harus ditulis sendiri pada semua opsi selain gateway. Pertimbangkan migrasi adapter ke opsi (b) jika jumlah provider melebihi tiga atau jika tool calling dan streaming mulai dibutuhkan. Interface di bawah dirancang agar migrasi tersebut tidak mengubah caller.

## Kontrak env yang diusulkan

Usulan ini merupakan rekomendasi. Model tetap ditulis sebagai placeholder kecuali default Gemini yang sudah ada.

```dotenv
# ---------- Rantai provider LLM ----------
# Daftar dipisah koma, prioritas dari kiri ke kanan.
# ID valid: gemini, openai, anthropic, antigravity, local.
# `local` selalu menjadi tier terakhir; jika tidak ditulis, ditambahkan otomatis.
LLM_CHAIN_DEFAULT=gemini,antigravity,local
# Override per operasi (kosong = LLM_CHAIN_DEFAULT)
LLM_CHAIN_NLP=
LLM_CHAIN_AFFIRMATION=
LLM_CHAIN_REMINDER=
LLM_CHAIN_MORNING=gemini,local        # perilaku sekarang: tanpa bridge
LLM_CHAIN_VISION=gemini,local         # hanya provider dengan capability vision

# ---------- Budget & reliability ----------
LLM_TOTAL_BUDGET_MS=28000             # = perilaku sekarang (3 s + 25 s); turunkan setelah p95 diukur
LLM_MAX_RETRIES=0                     # provider berikutnya dalam chain berfungsi sebagai "retry"
LLM_MAX_INPUT_CHARS=2000
LLM_BREAKER_FAILURE_THRESHOLD=5
LLM_BREAKER_WINDOW_MS=60000
LLM_BREAKER_COOLDOWN_MS=30000

# ---------- Gemini (nama lama dipertahankan) ----------
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_THINKING_LEVEL=MEDIUM
GEMINI_TIMEOUT_MS=3000

# ---------- OpenAI / endpoint OpenAI-compatible (Chat Completions) ----------
OPENAI_API_KEY=
OPENAI_MODEL=                         # wajib jika `openai` ada di chain
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_TIMEOUT_MS=5000
OPENAI_STRUCTURED_OUTPUT=true         # false untuk endpoint tanpa response_format json_schema
OPENAI_VISION=false

# ---------- Anthropic (opsional, fase 3) ----------
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
ANTHROPIC_TIMEOUT_MS=5000

# ---------- Antigravity CLI bridge ----------
ANTIGRAVITY_BRIDGE_URL=
ANTIGRAVITY_BRIDGE_TOKEN=             # wajib jika URL diisi; buat dengan: openssl rand -hex 32
ANTIGRAVITY_TIMEOUT_MS=25000

# Host yang boleh memakai http:// (hanya jaringan internal)
LLM_INSECURE_HOST_ALLOWLIST=localhost,127.0.0.1,host.docker.internal
```

Aturan validasi dijalankan sekali saat startup di [src/index.ts](../../src/index.ts), sebelum socket WhatsApp dibuka. Proses keluar dengan pesan yang jelas jika aturan dilanggar:

1. **Format.** Pisahkan dengan koma, lakukan trim, lalu ubah ke lowercase. Entri kosong diabaikan. ID duplikat menyebabkan error.
2. **ID tidak dikenal menyebabkan error**, misalnya `gemni`. Daftar ID tertutup (enum) mencegah typo yang diam-diam menonaktifkan tier.
3. **`local` adalah terminal.** Jika `local` tidak ditulis, sistem menambahkannya. Entri setelah `local` tidak akan pernah dijangkau, sehingga menyebabkan error.
4. **Provider yang ditulis eksplisit tetapi belum dikonfigurasi menyebabkan error.** Contohnya `openai` tanpa `OPENAI_API_KEY` atau `OPENAI_MODEL`. Provider pada **default bawaan** yang belum dikonfigurasi dilewati dengan satu warning. Aturan ini mempertahankan perilaku saat ini, ketika `GEMINI_API_KEY` kosong cukup membuat Gemini dilewati.
5. **Capability.** `LLM_CHAIN_VISION` hanya boleh berisi provider dengan `vision: true` (`gemini`, `anthropic`, `antigravity`, `openai` dengan `OPENAI_VISION=true`). `nlp_parse` memakai structured output jika tersedia. Provider tanpa structured output tetap boleh dipakai, tetapi output-nya selalu melewati validasi aplikasi.
6. **Vision via Antigravity.** Bridge menerima `images: [{ mimeType, data(base64) }]` (maks 4 gambar, 5 MB per gambar, JPEG/PNG/WebP/GIF dengan validasi magic bytes), menulisnya ke direktori temp privat (`0600`), meneruskannya ke CLI lewat `--add-dir`, lalu menghapusnya di `finally`. Latensi CLI 13–30 detik per gambar, jadi budget vision (`LLM_VISION_BUDGET_MS`) otomatis memakai `LLM_TOTAL_BUDGET_MS` jika `antigravity` ada di chain vision.
7. **URL.** `*_BASE_URL` dan `ANTIGRAVITY_BRIDGE_URL` harus `https:` untuk host publik. `http:` otomatis diizinkan untuk host lokal/jaringan privat (loopback, RFC 1918, CGNAT, link-local, IPv6 ULA, nama service Docker, `*.internal`, `*.local`), atau untuk host yang ada di `LLM_INSECURE_HOST_ALLOWLIST` (entri boleh berupa host, `host:port`, atau URL lengkap). URL tidak boleh berisi kredensial (`user:pass@`), query, atau fragment.
8. **Angka.** Timeout, budget, dan threshold harus berupa bilangan bulat positif dalam rentang wajar, misalnya 100–60000 ms. Gunakan `Number.isInteger`, bukan `parseInt` yang diam-diam menerima `"3s"`.
9. **Secret tidak pernah dicetak.** Objek config hasil parse menyembunyikan key di `toJSON` dan `inspect`, sehingga log startup hanya menampilkan chain efektif dan model.

Gunakan **Zod** untuk schema env dan output model. Gemini dan OpenAI sama-sama memakai contoh Zod di dokumentasinya, sehingga satu dependency dapat melayani dua kebutuhan. Valibot lebih kecil dan dapat dipakai jika ukuran dependency menjadi prioritas. Untuk kompatibilitas mundur, pertahankan `GEMINI_*` dan `ANTIGRAVITY_BRIDGE_URL`. Kosongnya semua `LLM_CHAIN_*` harus menghasilkan perilaku saat ini. Jika `ANTIGRAVITY_BRIDGE_TOKEN` kosong, berikan masa transisi satu rilis dengan warning keras sebelum token menjadi wajib.

## Sketsa interface dan chain runner

Satu metode `generate` dengan `jsonSchema` opsional lebih sederhana daripada metode `generateText` dan `generateStructured` yang terpisah. Metode ini cukup untuk teks pendek, JSON, dan vision.

```ts
// src/services/llm/types.ts
export type ProviderId = 'gemini' | 'openai' | 'anthropic' | 'antigravity';
export type Operation = 'nlp_parse' | 'affirmation' | 'reminder_message' | 'morning_motivation' | 'vision_screen';
export type ErrorKind =
  | 'timeout' | 'rate_limited' | 'quota_exhausted' | 'auth' | 'bad_request'
  | 'server_error' | 'network' | 'invalid_output' | 'aborted';

export interface LlmRequest {
  operation: Operation;
  system: string;                       // instruksi tetap milik developer
  userContent: string;                  // teks pengguna: dipotong dan diberi delimiter
  images?: { data: Uint8Array; mimeType: string }[];
  jsonSchema?: Record<string, unknown>; // jika diisi dan didukung, provider memakai structured output
  maxOutputTokens: number;
  signal: AbortSignal;                  // wajib diteruskan ke fetch/SDK
}

export interface LlmProvider {
  readonly id: ProviderId;
  readonly model: string;
  readonly capabilities: { structuredOutput: boolean; vision: boolean };
  generate(req: LlmRequest): Promise<{ text: string; usage?: TokenUsage }>;
}

export class LlmError extends Error {
  constructor(readonly kind: ErrorKind, readonly status?: number, readonly retryAfterMs?: number) {
    super(kind);
  }
}
```

```ts
// src/services/llm/chain.ts
export async function runChain<T>(
  op: Operation,
  req: Omit<LlmRequest, 'operation' | 'signal'>,
  validate: (text: string) => T,   // JSON.parse + Zod + validasi semantik; throw = invalid_output
  local: () => T,                  // tidak boleh melempar error (Seam 1 & 4)
  deps: ChainDeps = defaultDeps,
): Promise<{ value: T; provider: ProviderId | 'local' }> {
  const deadline = deps.now() + deps.budgetMs(op);
  for (const p of deps.providersFor(op)) {
    if (!deps.breaker.allow(p.id)) { deps.record(op, p, 'skipped_breaker_open'); continue; }
    const remaining = deadline - deps.now();
    if (remaining < deps.minAttemptMs) { deps.record(op, p, 'skipped_budget'); break; }
    const signal = AbortSignal.timeout(Math.min(deps.timeoutMs(p.id), remaining));
    const startedAt = performance.now();
    try {
      const res = await p.generate({ ...req, operation: op, signal });
      const value = validate(res.text);
      deps.breaker.onSuccess(p.id);
      deps.record(op, p, 'success', startedAt, res.usage);
      return { value, provider: p.id };
    } catch (err) {
      const kind = classify(err, signal);   // TimeoutError → 'timeout', HTTP status → kind
      deps.breaker.onFailure(p.id, kind);
      deps.record(op, p, kind, startedAt);
    }
  }
  deps.record(op, 'local', 'selected');
  return { value: local(), provider: 'local' };
}
```

Catatan desain:

- **Seam tetap utuh.** `parseTaskMessage` hanya memanggil `runChain(..., validateParse, () => parseLocalTask(...))`. Duplikasi post-processing digabung menjadi satu fungsi `toParseResult`.
- **Test injection.** `ParseOptions.geminiClient` dipertahankan sebagai shim yang membungkus client palsu menjadi provider `gemini`. `providers?: LlmProvider[]` ditambahkan untuk test baru.
- **Retry tetap opsional.** Jika `LLM_MAX_RETRIES > 0`, retry hanya dilakukan untuk `rate_limited` dan `server_error`. `retryAfterMs` harus muat dalam sisa budget, dan jeda memakai full jitter. Retry tidak ditampilkan dalam sketsa agar contoh tetap ringkas.

## Reliability

Semua poin di bagian ini merupakan rekomendasi berdasarkan sumber di atas.

- **Pembatalan nyata.** Ganti seluruh `Promise.race` dengan `AbortSignal.timeout`, lalu teruskan signal tersebut ke `abortSignal` Gemini atau `signal` pada `fetch`. Pola ini sudah dipakai di [morning-digest.ts](../../src/services/morning-digest.ts#L495-L506). Abort membebaskan socket dan memori, tetapi **tidak menghentikan tagihan** di sisi Gemini.
- **Total budget.** Pengguna WhatsApp sedang menunggu balasan. Setiap percobaan mendapat `min(timeout provider, sisa budget)`. Provider dilewati jika sisa budget terlalu kecil. Default awal 28 s hanya untuk menjaga kompatibilitas. Setelah p95 per provider diukur, target yang masuk akal untuk `nlp_parse` adalah di bawah 10 s.
- **Tanpa hedging paralel.** Request paralel ke dua provider menggandakan biaya karena abort tidak membatalkan tagihan. Chain harus berjalan berurutan.
- **Matikan retry tersembunyi.** Atur `maxRetries: 0` jika memakai AI SDK atau SDK Anthropic, karena keduanya default 2. Jangan memberi `retryOptions` pada `@google/genai`. Retry tersembunyi di dalam satu tier dapat menghabiskan seluruh budget.
- **Klasifikasi error:**

| Kelas | Contoh | Retry di provider yang sama | Breaker |
|---|---|---|---|
| `timeout`, `network` | `TimeoutError`, `ECONNREFUSED` | Tidak; lanjut ke provider berikutnya | Dihitung sebagai kegagalan |
| `rate_limited` | 429 dengan `Retry-After` | Hanya jika `LLM_MAX_RETRIES > 0` dan masih muat dalam budget | Dihitung |
| `quota_exhausted` | 429 tanpa `retry-after` (Anthropic spend cap), 402 | Tidak | **Langsung dibuka** dengan cooldown panjang |
| `server_error` | 408, 5xx, 529 | Opsional sekali dengan jitter | Dihitung |
| `auth`, `bad_request` | 400, 401, 403, 404 | Tidak; kemungkinan besar masalah konfigurasi | Langsung dibuka dan dicatat sekali sebagai error |
| `invalid_output` | JSON rusak, schema gagal, deadline tidak masuk akal | Tidak | Dihitung dengan threshold lebih tinggi |

- **Breaker per provider** disimpan di memori karena hanya ada satu proses. Closed berubah menjadi Open setelah N kegagalan dalam window. Setelah cooldown, breaker Half-Open mengizinkan satu probe, lalu kembali Closed atau Open. `GET /health` bridge dapat dipakai sebagai probe murah. Breaker di-reset saat restart, dan itu dapat diterima.
- **Idempotensi.** Panggilan LLM tidak memiliki efek samping. Efek samping seperti `createTask` terjadi satu kali setelah `runChain` selesai. Pembatalan nyata memastikan respons terlambat dari percobaan yang sudah dibatalkan tidak diproses.

## Security checklist

**Secrets** (rujukan: [Gemini API key](https://ai.google.dev/gemini-api/docs/api-key), [OpenAI production](https://platform.openai.com/docs/guides/production-best-practices), [Anthropic errors](https://docs.anthropic.com/en/api/errors)):

- [ ] Key hanya disimpan di env atau secret store Dokploy, tidak pernah di repo. `.env` sudah masuk `.gitignore` dan `.dockerignore`.
- [ ] Gunakan key terpisah per environment. OpenAI menyarankan project staging dan production terpisah dengan rate limit dan spend limit masing-masing, serta expiry key dan rotasi berkala.
- [ ] Gemini: pakai *auth key* atau key yang dibatasi ke Gemini API. Unrestricted standard key ditolak. Aktifkan billing alert dan batasi IP jika memungkinkan.
- [ ] Aktifkan spend limit atau alert di setiap provider. OpenAI menyediakan hard spend limit, dan Anthropic menyediakan spend limit per organisasi atau workspace.
- [ ] Jangan pernah me-log key, header `Authorization`, atau body request. Potong pesan error provider dan redaksi pola key sebelum di-log.
- [ ] Buat token bridge dengan karakter hex agar aman dari ekspansi `$` oleh Bun.

**URL yang dapat dikonfigurasi (SSRF)** ([OWASP SSRF Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)):

- [ ] Wajibkan `https:` dengan allowlist eksplisit untuk host internal yang memakai `http:`.
- [ ] Gunakan `redirect: 'error'` pada `fetch` adapter. OWASP menyarankan redirect dimatikan agar validasi URL tidak dapat dilewati.
- [ ] URL hanya berasal dari env operator, tidak pernah dari pesan pengguna atau output model.

**Prompt injection dan output** (OWASP Top 10 LLM 2025: [LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/), [LLM02](https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/), [LLM05](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/), [LLM10](https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/)):

- [ ] Pisahkan instruksi ke `system` (`systemInstruction` Gemini, pesan `system` OpenAI, `system` Anthropic). Bungkus teks pengguna dengan delimiter seperti `<pesan_pengguna>…</pesan_pengguna>` dan escape tag penutupnya. Ini sesuai mitigasi LLM01 "segregate and identify external content". **Forwarded message** adalah konten pihak ketiga, sehingga termasuk *indirect injection*.
- [ ] Batasi panjang input dengan `LLM_MAX_INPUT_CHARS` dan `maxOutputTokens` per operasi (LLM10).
- [ ] Perlakukan output sebagai input tidak tepercaya (LLM05). Validasi dengan Zod. Validasi semantik mencakup deadline yang dapat di-parse, tidak terlalu jauh di masa lalu atau masa depan, `taskTitle` tidak kosong dan dibatasi panjangnya, serta `reminderLeadMinutes` di-clamp seperti saat ini. Output yang gagal diperlakukan sebagai `invalid_output`, lalu chain lanjut ke tier berikutnya.
- [ ] Teks affirmation dan reminder dibatasi panjangnya sebelum dikirim ke WhatsApp. Pertimbangkan untuk menghapus URL dari output karena model tidak punya alasan sah untuk menyisipkan tautan. Ini inferensi.
- [ ] Jangan menempatkan secret atau data pengguna lain di prompt (LLM02).

**Privasi data per provider:**

| Provider | Pemakaian data untuk training | Retensi |
|---|---|---|
| Gemini **unpaid** | Dipakai untuk meningkatkan produk dan dapat ditinjau manusia. Google meminta data sensitif tidak dikirim ([terms](https://ai.google.dev/gemini-api/terms)) | — |
| Gemini **paid** | Tidak dipakai untuk meningkatkan produk ([terms](https://ai.google.dev/gemini-api/terms)) | Log terbatas untuk mendeteksi penyalahgunaan |
| OpenAI API | Tidak dipakai untuk training sejak 1 Mar 2023 kecuali opt-in ([data controls](https://platform.openai.com/docs/guides/your-data)) | Log abuse monitoring hingga 30 hari; ZDR tersedia dengan persetujuan |
| Anthropic API | Tidak dipakai untuk training tanpa izin eksplisit ([API data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)) | Dihapus dalam 30 hari dengan beberapa pengecualian ([privacy center](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)) |
| Antigravity CLI | **Belum diketahui** | **Belum diketahui** |
| OpenRouter dan endpoint compat lain | Belum diverifikasi; bergantung pada provider downstream | — |
| `local` | Data tetap di host | — |

Rekomendasi: urutan chain juga merupakan keputusan privasi. Provider dengan ketentuan data yang belum jelas sebaiknya tidak ditempatkan sebelum provider berbayar yang ketentuannya sudah jelas.

**Hardening Antigravity bridge** ([script](../../scripts/antigravity-bridge.ts)):

- [ ] Gunakan default `HOST=127.0.0.1`. Karena container mengaksesnya melalui `host.docker.internal:host-gateway` ([compose](../../docker-compose.yml#L26-L27)), bind ke alamat gateway bridge Docker atau Unix socket yang di-mount ke container. Bun mendukung keduanya. Port juga harus ditutup di firewall host.
- [ ] Wajibkan `Authorization: Bearer <ANTIGRAVITY_BRIDGE_TOKEN>`. Bandingkan hash SHA-256 kedua nilai dengan `crypto.timingSafeEqual` karena fungsi itu mensyaratkan panjang yang sama ([Node crypto](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b)). Kembalikan 401 tanpa detail.
- [ ] Atur `maxRequestBodySize`, misalnya 64 KB, dan tolak prompt di atas batas karakter.
- [ ] Batasi concurrency, misalnya satu atau dua proses `agy`. Request berlebih menerima 429 atau 503 agar client langsung pindah ke tier berikutnya.
- [ ] Gunakan `Bun.spawn({ timeout, killSignal: 'SIGKILL' })` dan teruskan `req.signal` agar proses dimatikan saat client membatalkan request. Atur `idleTimeout` server sedikit di atas timeout proses.
- [ ] Jangan mengembalikan stderr atau `err.message` ke client. Log stderr di host dalam bentuk terpotong.
- [ ] Jangan mengirim prompt lewat argv jika `agy` mendukung stdin, karena argv dapat terlihat oleh pengguna lain di host melalui `ps`. Dukungan stdin pada `agy` **belum diverifikasi**.

## Observability

Rekomendasi:

- Pertahankan `ai_call_total`, `ai_duration_ms`, dan `ai_tokens` di [telemetry.ts](../../src/services/telemetry.ts#L179-L208). Seragamkan nilai `outcome` dengan `ErrorKind`, ditambah `success`, `skipped_breaker_open`, `skipped_unconfigured`, dan `skipped_budget`. Semua provider, termasuk jalur bridge di affirmation dan reminder, wajib mencatat telemetry.
- Tambahkan `ai_chain_total{operation, final_provider, attempts}`. **Fallback rate** dihitung sebagai bagian hasil dengan `final_provider` yang berbeda dari provider pertama yang aktif.
- Pantau latensi per provider dengan p50/p95 dari `ai_duration_ms`. Ukur juga latensi end-to-end chain terhadap `LLM_TOTAL_BUDGET_MS`.
- Catat perubahan state breaker sebagai event telemetry dengan `provider`, `from`, `to`, dan `kind`. Tampilkan state tersebut di dashboard.
- Saat startup, tulis satu log berisi chain efektif per operasi beserta `provider:model`. Untuk setiap chain, tulis satu log terstruktur berisi daftar `{provider, model, outcome, ms}`. Jangan memasukkan prompt, key, atau isi pesan. `morning_motivation` sudah menyimpan `model` efektif ([morning-digest.ts](../../src/services/morning-digest.ts#L514-L518)).

## Rencana migrasi bertahap (TDD: Red → Green)

**Fase 0: hardening tanpa mengubah urutan.**
File: [scripts/antigravity-bridge.ts](../../scripts/antigravity-bridge.ts), `callAntigravityBridge` di [nlp.ts](../../src/services/nlp.ts#L395-L420), dan `Promise.race` di nlp, affirmation, reminder, serta media.
Test yang ditulis lebih dulu di `test/scripts/antigravity-bridge.test.ts`:

- tanpa token atau token salah menghasilkan 401;
- body melebihi batas menghasilkan 413;
- request melebihi batas concurrency menghasilkan 429 atau 503;
- respons error tidak memuat stderr;
- proses yang macet dimatikan saat timeout.

Handler bridge perlu diekspor agar dapat dites tanpa membuka port. Tambahkan test bahwa client mengirim header `Authorization`, dan test bahwa signal pada client Gemini palsu menjadi `aborted` setelah timeout.

**Fase 1: config dan chain untuk `nlp_parse`.**
File baru: `src/config/llm.ts` (`loadLlmConfig(env)` murni dan dapat dites), `src/services/llm/{types,errors,breaker,chain}.ts`, serta `providers/{gemini,antigravity}.ts`.
Test di `test/config/llm-config.test.ts`:

- tanpa env menghasilkan `gemini,antigravity,local`;
- ID tidak dikenal, entri setelah `local`, dan duplikat menyebabkan throw;
- `local` ditambahkan otomatis;
- provider eksplisit tanpa key menyebabkan throw, sedangkan provider default tanpa key dilewati;
- `http://` non-allowlist menyebabkan throw;
- angka tidak valid menyebabkan throw;
- `JSON.stringify(config)` tidak memuat key.

Test di `test/services/llm/chain.test.ts`:

- urutan dihormati, dan provider kedua tidak dipanggil jika provider pertama berhasil;
- semua provider gagal menghasilkan `local`;
- timeout membatalkan signal lalu chain lanjut ke provider berikutnya;
- budget habis membuat provider sisanya dilewati;
- breaker terbuka setelah N kegagalan, lalu Half-Open setelah cooldown;
- 401 tidak di-retry dan langsung membuka breaker;
- `invalid_output` membuat chain lanjut ke provider berikutnya;
- telemetry tercatat per percobaan.

Di [nlp.test.ts](../../test/services/nlp.test.ts):

- `LLM_CHAIN_NLP=antigravity,gemini` memanggil bridge lebih dulu;
- fixture injection berisi `"}` dan "abaikan instruksi" tetap berada di dalam delimiter;
- deadline tidak valid dari model ditolak;
- test lama dengan `geminiClient` tetap hijau.

**Fase 2: operasi lain.**
Migrasikan [affirmation.ts](../../src/services/affirmation.ts), [reminder.ts](../../src/services/reminder.ts), [morning-digest.ts](../../src/services/morning-digest.ts), dan [media.ts](../../src/services/media.ts) dengan capability `vision`. Test yang sudah ada menjadi regression net. Tambahkan test bahwa `LLM_CHAIN_VISION` berisi `antigravity` ditolak saat startup.

**Fase 3: provider baru.**
Tambahkan `providers/openai-compatible.ts` dan, jika dibutuhkan, `providers/anthropic.ts` berbasis `fetch`. Tulis test kontrak dengan `fetch` palsu:

- body memuat `response_format` jika `structuredOutput: true`;
- status 429 dengan `Retry-After` dipetakan ke `rate_limited` beserta `retryAfterMs`;
- 401 dipetakan ke `auth`;
- `redirect: 'error'` dipasang;
- key tidak muncul di pesan error.

**Fase 4: dokumentasi dan observability.**
Perbarui [.env.example](../../.env.example), [README](../../README.md), dan [ARCHITECTURE.md](../ARCHITECTURE.md). Tambahkan panel fallback rate dan breaker di dashboard. Tulis **ADR 0003** "Configurable LLM provider chain" yang mencatat keputusan opsi (a), aturan `local` sebagai terminal, dan alasan tidak memakai gateway.

Jalankan `bun test` dan `bun run typecheck` di setiap fase.

## Risiko dan pertanyaan terbuka

- **Provider apa yang benar-benar diinginkan?** Contohnya OpenAI, Anthropic, OpenRouter, atau model lokal. Jawaban ini menentukan apakah fase 3 cukup memakai satu adapter OpenAI-compatible.
- **Satu atau lebih endpoint OpenAI-compatible sekaligus?** Contohnya OpenRouter dan Ollama secara bersamaan. Kontrak di atas hanya menyediakan satu slot `openai`. Instance bernama seperti `openai:groq` dapat ditambahkan nanti, tetapi menambah kompleksitas parsing.
- **Anggaran biaya dan latensi.** Berapa p95 yang dapat diterima pengguna? Berapa batas spend bulanan per provider?
- **Privasi.** Apakah Gemini memakai tier paid atau unpaid? Bagaimana ketentuan data Antigravity CLI? Apakah ada data yang tidak boleh keluar dari host? Jika ada, chain untuk operasi tersebut sebaiknya `local` saja.
- **Model berbeda menghasilkan output berbeda.** Prompt yang sama dapat menghasilkan kualitas parsing yang berbeda antar provider. Jalankan gold dataset dari [riset sebelumnya](./slm-vs-llm-task-parsing.md) per provider sebelum mengubah urutan production.
- **Vision fail-open.** Saat AI tidak tersedia, screening scam meloloskan gambar ([media.ts](../../src/services/media.ts#L201-L208)). Ini keputusan produk yang terpisah, tetapi menjadi lebih penting setelah chain vision dapat dikonfigurasi.
- **Breaker in-memory** di-reset setiap kali deploy. Ini dapat diterima untuk satu instance dan perlu ditinjau jika bot di-scale out.
- **Endpoint compat Gemini masih beta**, dan perilaku endpoint OpenAI-compatible pihak ketiga bervariasi. Capability flag per provider harus dapat dimatikan melalui env.
