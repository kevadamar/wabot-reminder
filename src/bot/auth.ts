import { mkdir } from 'node:fs/promises';

export async function ensureAuthDirectory(authDir: string): Promise<void> {
  await mkdir(authDir, { recursive: true, mode: 0o700 });
}

export async function saveCredentialsSafely(
  authDir: string,
  saveCreds: () => Promise<void>,
  onError: (error: unknown) => void
): Promise<boolean> {
  try {
    await ensureAuthDirectory(authDir);
    await saveCreds();
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}
