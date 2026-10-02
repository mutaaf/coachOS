/** Run `fn` as someone who isn't signed in. See tests/setup.ts. */
export async function signedOut<T>(fn: () => Promise<T>): Promise<T> {
  (globalThis as any).__signedOut = true;
  try {
    return await fn();
  } finally {
    (globalThis as any).__signedOut = false;
  }
}
