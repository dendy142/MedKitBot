import { InlineKeyboard } from 'grammy';
import { TIMEZONES, CATEGORY_KEYWORDS } from '../config.js';
import { updateUserTimezone } from '../db/queries/users.js';
import { createMedkit } from '../db/queries/medkits.js';
import { createMedicine } from '../db/queries/medicines.js';
import { supabase } from '../db/supabase.js';
import { logAction } from '../middleware/logging.js';
import { checkAchievements } from './achievements.js';

/**
 * Auto-detect category from medicine name
 */
function detectCategory(name) {
  const lower = name.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return category;
  }
  return 'Прочее';
}

/**
 * Send welcome message + start mini-tour (#81)
 */
export async function startOnboarding(ctx) {
  // Show tour step 1
  const msg = await ctx.reply(
    ctx.t('onboarding.tour_1'),
    {
      reply_markup: new InlineKeyboard()
        .text(ctx.t('onboarding.btn_next'), 'tour:2')
        .text(ctx.t('onboarding.btn_skip_tour'), 'tour:skip'),
    }
  );

  // Store tour message ID
  await supabase.from('sessions').upsert(
    { key: `onboard_welcome:${ctx.from.id}`, value: { msgId: msg.message_id, step: 1 }, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
}

/**
 * Register onboarding callback handlers
 */
export function registerOnboardingHandlers(bot) {
  // Tour step 2
  bot.callbackQuery('tour:2', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(ctx.t('onboarding.tour_2'), {
      reply_markup: new InlineKeyboard()
        .text(ctx.t('onboarding.btn_next'), 'tour:3')
        .text(ctx.t('onboarding.btn_skip_tour'), 'tour:skip'),
    });
  });

  // Tour step 3
  bot.callbackQuery('tour:3', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(ctx.t('onboarding.tour_3'), {
      reply_markup: new InlineKeyboard()
        .text(ctx.t('onboarding.btn_next'), 'tour:4')
        .text(ctx.t('onboarding.btn_skip_tour'), 'tour:skip'),
    });
  });

  // Tour step 4
  bot.callbackQuery('tour:4', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(ctx.t('onboarding.tour_4'), {
      reply_markup: new InlineKeyboard()
        .text(ctx.t('onboarding.btn_next'), 'tour:done')
        .text(ctx.t('onboarding.btn_skip_tour'), 'tour:skip'),
    });
  });

  // Tour done / skip → timezone picker
  bot.callbackQuery(/^tour:(done|skip)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showTimezonePicker(ctx);
  });

  // Timezone selection
  bot.callbackQuery(/^tz:(.+)$/, async (ctx) => {
    const timezone = ctx.match[1];
    await updateUserTimezone(ctx.dbUser.id, timezone);
    await ctx.answerCallbackQuery(ctx.t('onboarding.tz_set'));

    // Delete the welcome message stored earlier
    const { data: welcomeSession } = await supabase
      .from('sessions')
      .select('value')
      .eq('key', `onboard_welcome:${ctx.from.id}`)
      .single();
    if (welcomeSession?.value?.msgId && welcomeSession.value.msgId !== ctx.callbackQuery.message.message_id) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, welcomeSession.value.msgId);
      } catch { /* ignore */ }
    }
    await supabase.from('sessions').delete().eq('key', `onboard_welcome:${ctx.from.id}`);

    // Create default medkit
    const medkit = await createMedkit('Домашняя', ctx.dbUser.id);

    // Offer quick start (#82) or normal add or skip
    await ctx.editMessageText(
      ctx.t('onboarding.first_medkit'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('onboarding.btn_add'), `medkit:${medkit.id}:add:onboard`)
          .row()
          .text(ctx.t('onboarding.quick_start'), `quickstart:${medkit.id}`)
          .row()
          .text(ctx.t('onboarding.btn_skip'), 'onboard:skip'),
      }
    );
  });

  // Quick start (#82) — simplified wizard: name + quantity
  bot.callbackQuery(/^quickstart:([0-9a-f-]+)$/, async (ctx) => {
    const medkitId = ctx.match[1];
    await ctx.answerCallbackQuery();

    await supabase.from('sessions').upsert(
      {
        key: `state:${ctx.dbUser.id}`,
        value: { action: 'quick_start_name', medkitId, msgId: ctx.callbackQuery.message.message_id },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );

    await ctx.editMessageText(ctx.t('quick_start.prompt'), {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), 'onboard:skip'),
    });
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

/**
 * Show timezone picker
 */
async function showTimezonePicker(ctx) {
  const tzKeyboard = new InlineKeyboard();
  for (let i = 0; i < TIMEZONES.length; i += 3) {
    tzKeyboard.text(TIMEZONES[i].label, `tz:${TIMEZONES[i].value}`);
    if (TIMEZONES[i + 1]) tzKeyboard.text(TIMEZONES[i + 1].label, `tz:${TIMEZONES[i + 1].value}`);
    if (TIMEZONES[i + 2]) tzKeyboard.text(TIMEZONES[i + 2].label, `tz:${TIMEZONES[i + 2].value}`);
    tzKeyboard.row();
  }

  await ctx.editMessageText(ctx.t('onboarding.tz_prompt'), {
    reply_markup: tzKeyboard,
  });
}

/**
 * Handle quick start text inputs (called from textState)
 */
export async function handleQuickStartText(ctx, state) {
  const text = ctx.message.text.trim();
  try { await ctx.deleteMessage(); } catch { /* ignore */ }

  const msgId = state.msgId;

  if (state.action === 'quick_start_name') {
    // Got medicine name, ask for quantity
    state.action = 'quick_start_qty';
    state.name = text;
    state.category = detectCategory(text);
    await supabase.from('sessions').upsert(
      { key: `state:${ctx.dbUser.id}`, value: { ...state, updated_at: undefined }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );

    await ctx.api.editMessageText(ctx.chat.id, msgId,
      ctx.t('quick_start.quantity_prompt'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.skip'), `quickstart_qty_skip:${state.medkitId}`)
          .row()
          .text(ctx.t('common.cancel'), 'onboard:skip'),
      }
    );
    return true;
  }

  if (state.action === 'quick_start_qty') {
    const qty = parseFloat(text);
    const quantity = isNaN(qty) || qty < 0 ? 0 : qty;

    // Create medicine
    const medicine = await createMedicine({
      medkitId: state.medkitId,
      name: state.name,
      category: state.category,
      quantity,
      quantityUnit: 'шт',
    });

    await logAction(ctx.dbUser.id, 'create', 'medicine', medicine.id, { name: state.name });
    await supabase.from('sessions').delete().eq('key', `state:${ctx.dbUser.id}`);

    // Check achievements
    await checkAchievements(ctx, 'medicine_added');

    await ctx.api.editMessageText(ctx.chat.id, msgId,
      ctx.t('quick_start.success', { name: state.name }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('addmed.btn_open'), `med:${medicine.id}`)
          .text(ctx.t('common.main_menu'), 'main_menu'),
      }
    );
    return true;
  }

  return false;
}
