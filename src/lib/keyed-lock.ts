/**
 * Process-local serialization for work that must not overlap for the same key.
 *
 * This deliberately does not claim cross-process safety. The current runtime is
 * one Node process with one SQLite handle; a multi-process deployment would need
 * a database-backed reservation or compare-and-swap instead.
 */
export class KeyedLock<Key> {
  private readonly tails = new Map<Key, Promise<void>>();

  async run<Result>(key: Key, task: () => Promise<Result>): Promise<Result> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => turn);
    this.tails.set(key, tail);

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      // Only the last waiter owns cleanup. If another task queued while this
      // one ran, its tail remains in the map until that task finishes.
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
