import { InlineKeyboard } from 'grammy';
import { TIMEZONES } from '../config.js';
import { updateUserTimezone } from '../db/queries/users.js';
import { createMedkit } from '../db/queries/medkits.js';
import { supabase } from '../db/supabase.js';

/**
 * Send welcome message + timezone picker (called from /start for new users)
 */
export async function startOnboarding(ctx) {
  const tzKeyboard = new InlineKeyboard();
  for (let i = 0; i < TIMEZONES.length; i += 3) {
    tzKeyboard.text(TIMEZONES[i].label, `tz:${TIMEZONES[i].value}`);
    if (TIMEZONES[i + 1]) tzKeyboard.text(TIMEZONES[i + 1].label, `tz:${TIMEZONES[i + 1].value}`);
    if (TIMEZONES[i + 2]) tzKeyboard.text(TIMEZONES[i + 2].label, `tz:${TIMEZONES[i + 2].value}`);
    tzKeyboard.row();
  }

  await ctx.reply(
    `👋 *Добро пожаловать в «Моя аптечка»!*\n\n` +
    `Я помогу навести порядок в домашней аптечке:\n\n` +
    `📦 Каталог лекарств с фото и заметками\n` +
    `📅 Контроль сроков годности\n` +
    `💊 Напоминания о приёме\n` +
    `👥 Общий доступ для всей семьи\n` +
    `🛒 Список покупок\n\n` +
    `🕐 Для начала выберите ваш часовой пояс:`,
    { parse_mode: 'Markdown', reply_markup: tzKeyboard }
  );
}

export const ONBOARDING_COMPLETE_TEXT =
  `🎉 *Бот настроен!*\n\n` +
  `Вот что умеет «Моя аптечка»:\n` +
  `📦 Каталог лекарств с фото\n` +
  `📅 Контроль сроков годности\n` +
  `💊 Напоминания о приёме\n` +
  `👥 Общий доступ для семьи\n` +
  `🛒 Список покупок\n\n` +
  `Начните с аптечек 👇`;

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
        .text('🏠 Меню', 'main_menu'),
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
        .text('🏠 Меню', 'main_menu'),
    });
  });
}
