import { InlineKeyboard } from 'grammy';
import { TIMEZONES } from '../config.js';
import { updateUserTimezone } from '../db/queries/users.js';
import { createMedkit } from '../db/queries/medkits.js';
import { supabase } from '../db/supabase.js';

/**
 * Send welcome message + timezone picker (called from /start for new users)
 */
export async function startOnboarding(ctx) {
  const welcomeMsg = await ctx.reply(
    ctx.t('onboarding.welcome'),
    { parse_mode: 'Markdown' }
  );

  // Store welcome message ID so we can delete it after timezone selection
  await supabase.from('sessions').upsert(
    { key: `onboard_welcome:${ctx.from.id}`, value: { msgId: welcomeMsg.message_id }, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );

  const tzKeyboard = new InlineKeyboard();
  for (let i = 0; i < TIMEZONES.length; i += 3) {
    tzKeyboard.text(TIMEZONES[i].label, `tz:${TIMEZONES[i].value}`);
    if (TIMEZONES[i + 1]) tzKeyboard.text(TIMEZONES[i + 1].label, `tz:${TIMEZONES[i + 1].value}`);
    if (TIMEZONES[i + 2]) tzKeyboard.text(TIMEZONES[i + 2].label, `tz:${TIMEZONES[i + 2].value}`);
    tzKeyboard.row();
  }

  await ctx.reply(ctx.t('onboarding.tz_prompt'), {
    reply_markup: tzKeyboard,
  });
}

// ONBOARDING_COMPLETE_TEXT is now fetched via ctx.t('onboarding.complete')

/**
 * Register onboarding callback handlers
 */
export function registerOnboardingHandlers(bot) {
  // Timezone selection
  bot.callbackQuery(/^tz:(.+)$/, async (ctx) => {
    const timezone = ctx.match[1];
    await updateUserTimezone(ctx.dbUser.id, timezone);
    await ctx.answerCallbackQuery(ctx.t('onboarding.tz_set'));

    // Delete the welcome message
    const { data: welcomeSession } = await supabase
      .from('sessions')
      .select('value')
      .eq('key', `onboard_welcome:${ctx.from.id}`)
      .single();
    if (welcomeSession?.value?.msgId) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, welcomeSession.value.msgId);
      } catch { /* ignore */ }
      await supabase.from('sessions').delete().eq('key', `onboard_welcome:${ctx.from.id}`);
    }

    // Create default medkit
    const medkit = await createMedkit('Домашняя', ctx.dbUser.id);

    await ctx.editMessageText(
      ctx.t('onboarding.first_medkit'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('onboarding.btn_add'), `medkit:${medkit.id}:add:onboard`)
          .row()
          .text(ctx.t('onboarding.btn_skip'), 'onboard:skip'),
      }
    );
  });

  // Skip adding medicine → show onboarding complete with tips
  bot.callbackQuery('onboard:skip', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(ctx.t('onboarding.complete'), {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text(ctx.t('common.to_medkits'), 'medkits')
        .text(ctx.t('common.to_settings'), 'settings')
        .row()
        .text(ctx.t('common.to_help'), 'help')
        .text(ctx.t('common.main_menu'), 'main_menu'),
    });
  });

  // Called after first medicine is added during onboarding
  bot.callbackQuery('onboard:complete', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(ctx.t('onboarding.complete'), {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text(ctx.t('common.to_medkits'), 'medkits')
        .text(ctx.t('common.to_settings'), 'settings')
        .row()
        .text(ctx.t('common.to_help'), 'help')
        .text(ctx.t('common.main_menu'), 'main_menu'),
    });
  });
}
