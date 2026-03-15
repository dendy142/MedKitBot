import { handleMainMenu } from './menu.js';
import { startOnboarding } from './onboarding.js';
import { handleInviteDeepLink } from './sharing.js';

/**
 * /start command handler
 * New users → onboarding
 * Existing users → main menu
 * Deep links (invite_XXX) → handled separately
 */
export async function handleStart(ctx) {
  // Check for deep link parameter (e.g., /start invite_XXXX)
  const param = ctx.match;
  if (param && param.startsWith('invite_')) {
    const inviteCode = param.replace('invite_', '');
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await handleInviteDeepLink(ctx, inviteCode);
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
