import { InlineKeyboard } from 'grammy';

const HELP_TEXT = `📖 *Помощь — Моя аптечка*

📦 *Аптечки* — несколько аптечек, общий доступ для семьи
💊 *Лекарства* — дозировка, срок, остаток, фото, заметки
📆 *Курсы приёма* — точное время или период дня, напоминания
🛒 *Покупки* — список с отметкой «куплено» и пополнением
🔍 *Поиск* — напишите название лекарства в чат
📊 *Статистика* — соблюдение курсов, стрики
📤📥 *Экспорт/Импорт* — данные в CSV
⚙️ *Настройки* — часовой пояс, уведомления, пороги

*Команды:*
/start — Главное меню
/help — Эта справка
/cancel — Отмена текущего действия`;

const HELP_KEYBOARD = new InlineKeyboard()
  .text('📦 Аптечки', 'medkits')
  .text('💊 Приём', 'intake_today')
  .row()
  .text('🛒 Покупки', 'shopping')
  .text('📊 Статистика', 'stats')
  .row()
  .text('🔍 Поиск', 'search')
  .text('⚙️ Настройки', 'settings')
  .row()
  .text('🏠 Меню', 'main_menu');

export async function handleHelp(ctx) {
  if (ctx.callbackQuery) {
    await ctx.editMessageText(HELP_TEXT, {
      parse_mode: 'Markdown',
      reply_markup: HELP_KEYBOARD,
    });
  } else {
    await ctx.reply(HELP_TEXT, {
      parse_mode: 'Markdown',
      reply_markup: HELP_KEYBOARD,
    });
  }
}

export async function handleHelpCallback(ctx) {
  await ctx.answerCallbackQuery();
  await handleHelp(ctx);
}
