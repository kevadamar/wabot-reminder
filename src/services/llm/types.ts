export type ProviderId = 'gemini' | 'openai' | 'anthropic' | 'antigravity';
export type ChainId = ProviderId | 'local';
export type Operation =
  | 'nlp_parse'
  | 'affirmation'
  | 'reminder_message'
  | 'morning_motivation'
  | 'vision_screen';

export type ErrorKind =
  | 'timeout'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'auth'
  | 'bad_request'
  | 'server_error'
  | 'network'
  | 'invalid_output'
  | 'aborted';

export interface TokenUsage {
  promptTokens?: number | null;
  outputTokens?: number | null;
  thoughtTokens?: number | null;
  totalTokens?: number | null;
}

export interface LlmImage {
  data: Uint8Array;
  mimeType: string;
}

export interface LlmRequest {
  operation: Operation;
  system: string;
  userContent: string;
  images?: LlmImage[];
  jsonSchema?: Record<string, unknown>;
  maxOutputTokens: number;
  signal: AbortSignal;
  thinkingLevel?: string;
  candidateCount?: number;
  requestId?: string;
}

export interface LlmResult {
  text: string;
  usage?: TokenUsage;
  model?: string;
  providerRequestId?: string;
}

export interface LlmProvider {
  readonly id: ProviderId;
  readonly model: string;
  readonly timeoutMs: number;
  readonly capabilities: { structuredOutput: boolean; vision: boolean };
  generate(req: LlmRequest): Promise<LlmResult>;
}
