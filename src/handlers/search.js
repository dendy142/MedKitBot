import { InlineKeyboard } from 'grammy';
import { searchMedicines } from '../db/queries/medicines.js';
import { formatQuantity, medicineStatusEmoji } from '../utils/format.js';

/**
 * Callback: user pressed 🔍 Поиск
 */
export async function handleSearchCallback(ctx) {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    '🔍 *Поиск лекарства*\n\nВведите название лекарства:',
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('◀️ Назад', 'main_menu'),
    }
  );
}

/**
 * Fallback handler: user typed text → try to search
 */
export async function handleSearch(ctx) {
  const query = ctx.message.text.trim();
  if (!query || query.startsWith('/')) return;

  const results = await searchMedicines(ctx.dbUser.id, query);

  if (results.length === 0) {
    const keyboard = new InlineKeyboard()
      .text('📦 Аптечки', 'medkits')
      .text('🔍 Искать ещё', 'search')
      .row()
      .text('◀️ Главное меню', 'main_menu');

    await ctx.reply(
      `🔍 По запросу «${query}» ничего не найдено.\n\nПопробуйте другое название или перейдите в аптечку.`,
      { reply_markup: keyboard }
    );
    return;
  }

  // Group by medkit
  const grouped = {};
  for (const med of results) {
    const medkitName = med.medkits?.name || 'Без аптечки';
    if (!grouped[medkitName]) grouped[medkitName] = [];
    grouped[medkitName].push(med);
  }

  let text = `🔍 Результаты по «${query}»:\n\n`;
  const keyboard = new InlineKeyboard();

  for (const [medkitName, meds] of Object.entries(grouped)) {
    text += `📦 *${medkitName}*\n`;
    for (const med of meds) {
      const emoji = medicineStatusEmoji(med);
      const qty = formatQuantity(med.quantity, med.quantity_unit);
      text += `${emoji} ${med.name}${med.dosage ? ' ' + med.dosage : ''} — ${qty}\n`;
      keyboard.text(`${med.name}`, `med:${med.id}`).row();
    }
    text += '\n';
  }

  keyboard.text('🔍 Искать ещё', 'search').row();
  keyboard.text('◀️ Главное меню', 'main_menu');

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}
