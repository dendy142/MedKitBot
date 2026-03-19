/**
 * #67 Retry wrapper for critical Supabase operations.
 *
 * @param {() => Promise<T>} fn - async function to retry
 * @param {number} retries - number of retries (default 1)
 * @param {number} delay - delay between retries in ms (default 500)
 * @returns {Promise<T>}
 */
export async function withRetry(fn, retries = 1, delay = 500) {
  try {
    return await fn();
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, delay));
      return withRetry(fn, retries - 1, delay);
    }
    throw err;
  }
}
