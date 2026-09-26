import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureAuthDirectory, saveCredentialsSafely } from '../../src/bot/auth.js';

describe('Baileys auth persistence', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('recreates a missing auth directory before saving credentials', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'todo-reminder-auth-'));
    temporaryRoots.push(temporaryRoot);
    const authDir = join(temporaryRoot, 'auth_info');

    await ensureAuthDirectory(authDir);
    await rm(authDir, { recursive: true });

    const errors: unknown[] = [];
    const saved = await saveCredentialsSafely(
      authDir,
      async () => {
        await writeFile(join(authDir, 'creds.json'), '{}');
      },
      (error) => errors.push(error)
    );

    expect(saved).toBe(true);
    expect(errors).toHaveLength(0);
    expect(await Bun.file(join(authDir, 'creds.json')).text()).toBe('{}');
  });

  it('reports a credential save failure without rejecting the socket listener', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'todo-reminder-auth-'));
    temporaryRoots.push(temporaryRoot);
    const authDir = join(temporaryRoot, 'auth_info');
    const expectedError = new Error('volume is read-only');
    const errors: unknown[] = [];

    const saved = await saveCredentialsSafely(
      authDir,
      async () => {
        throw expectedError;
      },
      (error) => errors.push(error)
    );

    expect(saved).toBe(false);
    expect(errors).toEqual([expectedError]);
  });
});
