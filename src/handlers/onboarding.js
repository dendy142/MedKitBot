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
    `👋 *Добро пожаловать в Medkit Bot!*\n\n` +
    `Я помогу навести порядок в домашней аптечке:\n\n` +
    `📦 Каталог лекарств с фото и заметками\n` +
    `📅 Контроль сроков годности\n` +
    `💊 Напоминания о приёме\n` +
    `👥 Общий доступ для всей семьи\n` +
    `🛒 Список покупок\n\n` +
    `Для начала выберите ваш часовой пояс 👇`,
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

  await ctx.reply('🕐 Выберите ваш часовой пояс:', {
    reply_markup: tzKeyboard,
  });
}

export const ONBOARDING_COMPLETE_TEXT =
  `🎉 *Всё готово! Бот настроен.*\n\n` +
  `Вот что вы можете делать:\n` +
  `📦 Добавлять лекарства и следить за сроками\n` +
  `💊 Настроить напоминания о приёме\n` +
  `👥 Поделиться аптечкой с семьёй\n` +
  `🛒 Вести список покупок\n\n` +
  `Начните с раздела «Мои аптечки» 👇`;

/**
 * Register onboarding callback handlers
 */
export function registerOnboardingHandlers(bot) {
  // Timezone selection
  bot.callbackQuery(/^tz:(.+)$/, async (ctx) => {
    const timezone = ctx.match[1];
    await updateUserTimezone(ctx.dbUser.id, timezone);
    const tzLabel = TIMEZONES.find(t => t.value === timezone)?.label || timezone;
    await ctx.answerCallbackQuery('Часовой пояс установлен');

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
      `✅ Часовой пояс: *${tzLabel}*\n\n` +
      `📦 Я создал вашу первую аптечку — *«Домашняя»*.\n\n` +
      `Хотите добавить первое лекарство прямо сейчас?`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('💊 Да, добавить', `medkit:${medkit.id}:add:onboard`)
          .row()
          .text('⏭ Пропустить', 'onboard:skip'),
      }
    );
  });

  // Skip adding medicine → show onboarding complete with tips
  bot.callbackQuery('onboard:skip', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(ONBOARDING_COMPLETE_TEXT, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('📦 Мои аптечки', 'medkits')
        .text('⚙️ Настройки', 'settings')
        .row()
        .text('📖 Помощь', 'help')
        .text('🏠 Главное меню', 'main_menu'),
    });
  });

  // Called after first medicine is added during onboarding
  bot.callbackQuery('onboard:complete', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(ONBOARDING_COMPLETE_TEXT, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('📦 Мои аптечки', 'medkits')
        .text('⚙️ Настройки', 'settings')
        .row()
        .text('📖 Помощь', 'help')
        .text('🏠 Главное меню', 'main_menu'),
    });
  });
}
