import { InlineKeyboard } from 'grammy';
import { TIMEZONES } from '../config.js';
import { updateUserTimezone } from '../db/queries/users.js';
import { createMedkit } from '../db/queries/medkits.js';

/**
 * Onboarding conversation for new users
 * Steps:
 * 1. Welcome message
 * 2. Timezone selection
 * 3. Create first medkit "Домашняя"
 * 4. Offer to add first medicine
 */
export async function onboardingConversation(conversation, ctx) {
  // Step 1: Welcome
  await ctx.reply(
    `👋 *Добро пожаловать в Medkit Bot!*\n\n` +
    `Я помогу вам управлять домашней аптечкой:\n` +
    `• 📦 Вести каталог лекарств\n` +
    `• 📅 Отслеживать сроки годности\n` +
    `• 💊 Напоминать о приёме\n` +
    `• 👥 Делиться аптечкой с семьёй\n` +
    `• 🛒 Вести список покупок\n\n` +
    `Давайте настроим бот для вас!`,
    { parse_mode: 'Markdown' }
  );

  // Step 2: Timezone
  const tzKeyboard = new InlineKeyboard();
  for (let i = 0; i < TIMEZONES.length; i += 2) {
    tzKeyboard.text(TIMEZONES[i].label, `tz:${TIMEZONES[i].value}`);
    if (TIMEZONES[i + 1]) {
      tzKeyboard.text(TIMEZONES[i + 1].label, `tz:${TIMEZONES[i + 1].value}`);
    }
    tzKeyboard.row();
  }

  await ctx.reply('🕐 Выберите ваш часовой пояс:', {
    reply_markup: tzKeyboard,
  });

  const tzResponse = await conversation.waitForCallbackQuery(/^tz:/);
  const timezone = tzResponse.callbackQuery.data.replace('tz:', '');
  await updateUserTimezone(ctx.dbUser.id, timezone);
  await tzResponse.answerCallbackQuery('Часовой пояс установлен');

  // Step 3: Create default medkit
  const medkit = await createMedkit('Домашняя', ctx.dbUser.id);

  await ctx.reply(
    `✅ Часовой пояс установлен!\n\n` +
    `📦 Я создал вашу первую аптечку — *«Домашняя»*.\n\n` +
    `Хотите добавить первое лекарство прямо сейчас?`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('💊 Да, добавить', `onboard:add:${medkit.id}`)
        .text('⏭ Позже', 'onboard:skip'),
    }
  );

  const addResponse = await conversation.waitForCallbackQuery(/^onboard:/);
  await addResponse.answerCallbackQuery();

  if (addResponse.match.startsWith('onboard:add:')) {
    // Store medkit ID in session and enter addMedicine conversation
    ctx.session.currentMedkitId = medkit.id;
    await ctx.reply(
      '💊 *Добавление лекарства*\n\nВведите название лекарства:',
      { parse_mode: 'Markdown' }
    );
    // Continue into addMedicine flow within onboarding
    // (the user will type the medicine name, which will be handled after this conversation exits)
    ctx.session.afterOnboarding = 'addMedicine';
  } else {
    await ctx.reply(
      `🎉 Всё готово! Используйте меню ниже для навигации.`,
      {
        reply_markup: new InlineKeyboard()
          .text('📦 Аптечки', 'medkits')
          .text('⚙️ Настройки', 'settings')
          .row()
          .text('📖 Помощь', 'help'),
      }
    );
  }
}
