/**
 * #65 Stale callback guard.
 * When a callback references a deleted entity, show a stale-data alert
 * and return false. If the entity exists, return true.
 *
 * @param {*} entity - the fetched entity (null/undefined means deleted)
 * @param {import('grammy').Context} ctx - grammY context (must be a callback query)
 * @returns {Promise<boolean>} true if entity exists, false if stale
 */
export async function ensureExists(entity, ctx) {
  if (entity) return true;

  try {
    await ctx.answerCallbackQuery({
      text: ctx.t('common.stale_data'),
      show_alert: true,
    });
  } catch { /* ignore — query may already be answered */ }

  return false;
}
