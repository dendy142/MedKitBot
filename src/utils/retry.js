import { log } from './logger.js';

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

/**
 * #68 Safe send wrapper for cron jobs — handles Telegram 429 rate limits.
 * Retries once after sleeping for retry_after seconds.
 *
 * @param {import('grammy').Bot} bot
 * @param {number|string} chatId - Telegram chat ID
 * @param {string} text - Message text
 * @param {object} [opts] - sendMessage options
 * @returns {Promise<object>} - sent message
 */
export async function safeSend(bot, chatId, text, opts = {}) {
  try {
    return await bot.api.sendMessage(chatId, text, opts);
  } catch (err) {
    const errorCode = err?.error_code ?? err?.payload?.error_code;
    if (errorCode === 429) {
      const retryAfter = err?.parameters?.retry_after ?? err?.payload?.parameters?.retry_after ?? 5;
      log('warn', { action: 'safeSend_rate_limit', chatId, retryAfter });
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return await bot.api.sendMessage(chatId, text, opts);
    }
    throw err;
  }
}
