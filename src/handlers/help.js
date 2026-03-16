import { InlineKeyboard } from 'grammy';

const HELP_TEXT = `📖 *Помощь — Medkit Bot*

Ваш помощник в управлении домашней аптечкой!

📦 *Аптечки* — создавайте несколько (Домашняя, Дачная, В дорогу), делитесь с семьёй

💊 *Лекарства* — дозировка, категория, срок годности, количество, фото, заметки, избранное ⭐

📆 *Курсы приёма* — точное время или период дня, автосписание остатка, напоминания

👥 *Общий доступ* — по ссылке или @username, роли: владелец / редактор / просмотр

🛒 *Покупки* — список покупок с отметкой «куплено» и пополнением остатка

🔍 *Поиск* — просто напишите название лекарства в чат

📊 *Статистика* — соблюдение курсов, стрики, история по периодам

📤📥 *Экспорт/Импорт* — данные в CSV

⚙️ *Настройки* — часовой пояс, уведомления, пороги, дайджест, отображение

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
  .text('◀️ Главное меню', 'main_menu');

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
