/**
 * Paces automated (bot-initiated) messages per recipient so one chat never
 * receives a burst of messages, e.g. several reminders sharing the same minute.
 *
 * WhatsApp enforces a per sender/recipient "pair rate limit" (Cloud API error
 * 131056, roughly 1 message / 6s); unofficial clients such as Baileys are also
 * flagged for bursty, machine-like sending. A jittered 20–30s gap per chat plus
 * a small global gap between any two automated sends keeps us well clear of both.
 */

/** Meta's documented pair-rate floor; never pace below it. */
export const PAIR_RATE_FLOOR_MS = 6_000;

export interface SendPacerOptions {
  minGapMs?: number;
  maxGapMs?: number;
  /** Minimum spacing between any two automated sends, across recipients. */
  globalGapMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface SendPacer {
  /** Runs `send` once `recipient` may receive another automated message. */
  run<T>(recipient: string, send: () => Promise<T>): Promise<T>;
}

export function createSendPacer(options: SendPacerOptions = {}): SendPacer {
  const minGapMs = options.minGapMs ?? 20_000;
  const maxGapMs = options.maxGapMs ?? 30_000;
  const globalGapMs = options.globalGapMs ?? 1_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
  const random = options.random ?? Math.random;

  if (![minGapMs, maxGapMs, globalGapMs].every((ms) => Number.isFinite(ms) && ms >= 0)) {
    throw new RangeError('Pacing gaps must be non-negative numbers of milliseconds');
  }
  if (minGapMs < PAIR_RATE_FLOOR_MS) {
    throw new RangeError(`minGapMs must be >= ${PAIR_RATE_FLOOR_MS}ms (WhatsApp pair rate limit)`);
  }
  if (maxGapMs < minGapMs) {
    throw new RangeError('maxGapMs must be >= minGapMs');
  }

  const lastSentAt = new Map<string, number>();
  const queues = new Map<string, Promise<unknown>>();
  let nextGlobalSlot = 0;

  const jitteredGap = () => minGapMs + Math.floor(random() * (maxGapMs - minGapMs + 1));

  const forgetStale = () => {
    if (lastSentAt.size < 1_000) return;
    const cutoff = now() - maxGapMs;
    for (const [recipient, at] of lastSentAt) {
      if (at < cutoff) lastSentAt.delete(recipient);
    }
  };

  async function sendInTurn<T>(recipient: string, send: () => Promise<T>): Promise<T> {
    const last = lastSentAt.get(recipient);
    const recipientReadyAt = last === undefined ? now() : Math.max(now(), last + jitteredGap());
    const sendAt = Math.max(recipientReadyAt, nextGlobalSlot);
    nextGlobalSlot = sendAt + globalGapMs;

    const waitMs = sendAt - now();
    if (waitMs > 0) await sleep(waitMs);

    try {
      return await send();
    } finally {
      lastSentAt.set(recipient, now());
      forgetStale();
    }
  }

  return {
    run<T>(recipient: string, send: () => Promise<T>): Promise<T> {
      const previous = queues.get(recipient) ?? Promise.resolve();
      const turn = previous.catch(() => undefined).then(() => sendInTurn(recipient, send));
      queues.set(recipient, turn);
      void turn
        .catch(() => undefined)
        .finally(() => {
          if (queues.get(recipient) === turn) queues.delete(recipient);
        });
      return turn;
    },
  };
}
