import { describe, expect, it } from 'bun:test';
import { createSendPacer } from '../../src/services/send-pacer.js';

function fakeClock(start = 1_000_000) {
  let now = start;
  const sleeps: number[] = [];
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
  };
}

describe('Send pacer (per-recipient anti-spam spacing)', () => {
  it('sends the first message to a recipient immediately', async () => {
    const clock = fakeClock();
    const pacer = createSendPacer({ now: clock.now, sleep: clock.sleep, random: () => 0.5 });

    const result = await pacer.run('a@s.whatsapp.net', async () => 'sent');

    expect(result).toBe('sent');
    expect(clock.sleeps).toEqual([]);
  });

  it('spaces consecutive messages to the same recipient by a jittered 20-30s gap', async () => {
    const low = fakeClock();
    const lowPacer = createSendPacer({ now: low.now, sleep: low.sleep, random: () => 0 });
    await lowPacer.run('a', async () => null);
    await lowPacer.run('a', async () => null);
    expect(low.sleeps).toEqual([20_000]);

    const high = fakeClock();
    const highPacer = createSendPacer({ now: high.now, sleep: high.sleep, random: () => 1 - Number.EPSILON });
    await highPacer.run('a', async () => null);
    await highPacer.run('a', async () => null);
    expect(high.sleeps).toEqual([30_000]);
  });

  it('only waits for the remainder of the gap when time has already passed', async () => {
    const clock = fakeClock();
    const pacer = createSendPacer({ now: clock.now, sleep: clock.sleep, random: () => 0 });
    await pacer.run('a', async () => null);
    clock.advance(15_000);
    await pacer.run('a', async () => null);
    expect(clock.sleeps).toEqual([5_000]);

    clock.advance(60_000);
    await pacer.run('a', async () => null);
    expect(clock.sleeps).toEqual([5_000]);
  });

  it('does not make other recipients wait for the per-recipient gap', async () => {
    const clock = fakeClock();
    const pacer = createSendPacer({ now: clock.now, sleep: clock.sleep, random: () => 0, globalGapMs: 1_000 });
    await pacer.run('a', async () => null);
    await pacer.run('b', async () => null);

    expect(clock.sleeps).toEqual([1_000]);
  });

  it('serializes concurrent sends to the same recipient', async () => {
    const clock = fakeClock();
    const pacer = createSendPacer({ now: clock.now, sleep: clock.sleep, random: () => 0, globalGapMs: 0 });
    const order: string[] = [];

    await Promise.all([
      pacer.run('a', async () => order.push('first')),
      pacer.run('a', async () => order.push('second')),
    ]);

    expect(order).toEqual(['first', 'second']);
    expect(clock.sleeps).toEqual([20_000]);
  });

  it('still paces after a failed send and propagates the error', async () => {
    const clock = fakeClock();
    const pacer = createSendPacer({ now: clock.now, sleep: clock.sleep, random: () => 0 });

    await expect(
      pacer.run('a', async () => {
        throw new Error('socket closed');
      })
    ).rejects.toThrow('socket closed');
    await pacer.run('a', async () => null);

    expect(clock.sleeps).toEqual([20_000]);
  });

  it('rejects a gap window below the WhatsApp pair-rate floor', () => {
    expect(() => createSendPacer({ minGapMs: 1_000, maxGapMs: 2_000 })).toThrow();
    expect(() => createSendPacer({ minGapMs: 30_000, maxGapMs: 20_000 })).toThrow();
    expect(() => createSendPacer({ minGapMs: Number.NaN, maxGapMs: 30_000 })).toThrow();
  });
});
