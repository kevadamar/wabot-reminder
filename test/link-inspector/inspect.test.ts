import { describe, expect, it } from 'bun:test';
import net from 'node:net';
import type { Browser } from 'playwright-core';
import { classifyNavigationError, inspectUrl } from '../../src/link-inspector/inspect.ts';

const FAILED = 'goto: net::ERR_HTTP_RESPONSE_CODE_FAILURE at https://promo.xyz/';

describe('classifyNavigationError', () => {
  it('reports a redirect hop the guard refused as blocked_target', () => {
    const blocked = [{ host: '127.0.0.1', reason: 'private_address' }];
    expect(classifyNavigationError(FAILED, blocked, new Set(['promo.xyz', '127.0.0.1']))).toBe('blocked_target');
  });

  it('matches IPv6 hosts with or without brackets', () => {
    const blocked = [{ host: '[::1]', reason: 'private_address' }];
    expect(classifyNavigationError(FAILED, blocked, new Set(['::1']))).toBe('blocked_target');
  });

  it('reports dns_failed when the navigated host does not resolve', () => {
    const blocked = [{ host: 'promo.xyz', reason: 'dns_failed' }];
    expect(classifyNavigationError(FAILED, blocked, new Set(['promo.xyz']))).toBe('dns_failed');
  });

  it('ignores blocked subresources that were never navigated to', () => {
    const blocked = [{ host: '10.0.0.5', reason: 'private_address' }];
    expect(classifyNavigationError(FAILED, blocked, new Set(['promo.xyz']))).toBe('navigation_failed');
    expect(classifyNavigationError('page.goto: Timeout 15000ms exceeded.', blocked, new Set(['promo.xyz']))).toBe('timeout');
  });
});

describe('inspectUrl', () => {
  it('closes the guard proxy when the browser cannot create a context', async () => {
    let proxyUrl = '';
    const browser = {
      version: () => '156.0.0.0',
      newContext: async (options: { proxy: { server: string } }) => {
        proxyUrl = options.proxy.server;
        throw new Error('Target page, context or browser has been closed');
      },
    } as unknown as Browser;

    await expect(
      inspectUrl(browser, 'https://promo.xyz/', {
        lookup: async () => [],
        upstreamProxy: null,
        navigationTimeoutMs: 1000,
        settleMs: 0,
        maxTextChars: 500,
      })
    ).rejects.toThrow('closed');

    const port = Number(new URL(proxyUrl).port);
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
    });
    expect(reachable).toBe(false);
  });
});
