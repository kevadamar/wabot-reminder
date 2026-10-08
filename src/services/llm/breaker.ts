import type { ErrorKind, ProviderId } from './types.js';
import { telemetry } from '../telemetry.js';

export type BreakerState = 'closed' | 'open' | 'half_open';

interface Failure {
  at: number;
  weight: number;
}

interface Slot {
  state: BreakerState;
  openUntil: number;
  probeInFlight: boolean;
  failures: Failure[];
  cooldownMs: number;
}

export class CircuitBreaker {
  private readonly slots = new Map<string, Slot>();

  constructor(
    private readonly options: {
      threshold: number;
      windowMs: number;
      cooldownMs: number;
      now?: () => number;
    }
  ) {}

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private slot(id: string): Slot {
    let current = this.slots.get(id);
    if (!current) {
      current = { state: 'closed', openUntil: 0, probeInFlight: false, failures: [], cooldownMs: this.options.cooldownMs };
      this.slots.set(id, current);
    }
    return current;
  }

  private transition(id: string, slot: Slot, to: BreakerState, kind?: ErrorKind): void {
    if (slot.state === to) return;
    const from = slot.state;
    slot.state = to;
    telemetry.recordEvent({
      component: 'llm',
      operation: 'circuit_breaker',
      outcome: to === 'half_open' ? 'half_open' : to,
      provider: id,
      errorCode: kind ?? null,
      durationMs: null,
    });
    void from;
  }

  allow(id: string): boolean {
    const slot = this.slot(id);
    const now = this.now();
    if (slot.state === 'closed') return true;
    if (slot.state === 'open') {
      if (now < slot.openUntil) return false;
      this.transition(id, slot, 'half_open');
    }
    if (slot.probeInFlight) return false;
    slot.probeInFlight = true;
    return true;
  }

  onSuccess(id: string): void {
    const slot = this.slot(id);
    slot.failures = [];
    slot.probeInFlight = false;
    slot.openUntil = 0;
    this.transition(id, slot, 'closed');
  }

  onFailure(id: string, kind: ErrorKind): void {
    const slot = this.slot(id);
    const now = this.now();
    slot.probeInFlight = false;
    if (slot.state === 'half_open') {
      this.open(id, slot, slot.cooldownMs, kind);
      return;
    }
    if (kind === 'auth' || kind === 'bad_request') {
      this.open(id, slot, slot.cooldownMs, kind);
      return;
    }
    if (kind === 'quota_exhausted') {
      this.open(id, slot, slot.cooldownMs * 10, kind);
      return;
    }
    const weight = kind === 'invalid_output' ? 0.5 : 1;
    slot.failures.push({ at: now, weight });
    slot.failures = slot.failures.filter((failure) => now - failure.at <= this.options.windowMs);
    const total = slot.failures.reduce((sum, failure) => sum + failure.weight, 0);
    if (total >= this.options.threshold) this.open(id, slot, slot.cooldownMs, kind);
  }

  private open(id: string, slot: Slot, cooldownMs: number, kind: ErrorKind): void {
    slot.failures = [];
    slot.openUntil = this.now() + cooldownMs;
    slot.cooldownMs = cooldownMs;
    this.transition(id, slot, 'open', kind);
  }

  snapshot(): { provider: string; state: BreakerState }[] {
    return [...this.slots.entries()].map(([provider, slot]) => ({ provider, state: slot.state }));
  }
}

export function createCircuitBreaker(options: {
  threshold: number;
  windowMs: number;
  cooldownMs: number;
  now?: () => number;
}): CircuitBreaker {
  return new CircuitBreaker(options);
}

let shared: CircuitBreaker | null = null;

export function getSharedBreaker(options: { threshold: number; windowMs: number; cooldownMs: number }): CircuitBreaker {
  if (!shared) shared = new CircuitBreaker(options);
  return shared;
}

export function resetSharedBreaker(): void {
  shared = null;
}

export type { ProviderId };
