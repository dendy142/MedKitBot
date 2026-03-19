import { InlineKeyboard } from 'grammy';
import { handleMainMenu } from './menu.js';
import { startOnboarding } from './onboarding.js';
import { handleInviteDeepLink } from './sharing.js';
import { getMedkit } from '../db/queries/medkits.js';
import { getMedicine } from '../db/queries/medicines.js';

/**
 * /start command handler
 * New users → onboarding
 * Existing users → main menu
 * Deep links:
 *   /start invite_XXXX → accept invitation
 *   /start medkit_UUID → open medkit (#93)
 *   /start med_UUID → open medicine (#93)
 */
export async function handleStart(ctx) {
  const param = ctx.match;

  // Deep link: invite
  if (param && param.startsWith('invite_')) {
    const inviteCode = param.replace('invite_', '');
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await handleInviteDeepLink(ctx, inviteCode);
    return;
  }

  // Deep link: open medkit (#93)
  if (param && param.startsWith('medkit_')) {
    const medkitId = param.replace('medkit_', '');
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    const medkit = await getMedkit(medkitId, ctx.dbUser.id);
    if (medkit) {
      // Send a message that will be edited by medkit handler
      const msg = await ctx.reply(ctx.t('common.loading'), {
        reply_markup: new InlineKeyboard().text(ctx.t('common.open'), `medkit:${medkitId}`),
      });
    } else {
      await ctx.reply(ctx.t('deep_link.medkit_not_found'), {
        reply_markup: new InlineKeyboard().text(ctx.t('common.main_menu'), 'main_menu'),
      });
    }
    return;
  }

  // Deep link: open medicine (#93)
  if (param && param.startsWith('med_')) {
    const medId = param.replace('med_', '');
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    const med = await getMedicine(medId);
    if (med) {
      await ctx.reply(ctx.t('common.loading'), {
        reply_markup: new InlineKeyboard().text(ctx.t('common.open'), `med:${medId}`),
      });
    } else {
      await ctx.reply(ctx.t('deep_link.medicine_not_found'), {
        reply_markup: new InlineKeyboard().text(ctx.t('common.main_menu'), 'main_menu'),
      });
    }
    return;
  }

  // Delete the /start command message
  try { await ctx.deleteMessage(); } catch { /* ignore */ }

  if (ctx.isNewUser) {
    await startOnboarding(ctx);
    return;
  }

  await handleMainMenu(ctx);
}
