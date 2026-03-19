/**
 * #78 Structured logging utility
 * Outputs JSON logs for consistent parsing in Vercel.
 */

/**
 * Log a structured JSON message.
 * @param {'info'|'warn'|'error'} level
 * @param {object} data - { userId, action, entity, entityId, result, error, ...rest }
 */
export function log(level, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    ...data,
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}
