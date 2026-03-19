import { InlineKeyboard } from 'grammy';
import { searchMedicines } from '../db/queries/medicines.js';
import { formatQuantity, medicineStatusEmoji } from '../utils/format.js';

/**
 * Callback: user pressed 🔍 Поиск
 */
export async function handleSearchCallback(ctx) {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    ctx.t('search.prompt'),
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'main_menu'),
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
      .text(ctx.t('menu.btn_medkits'), 'medkits')
      .text(ctx.t('search.btn_search_again'), 'search')
      .row()
      .text(ctx.t('common.main_menu'), 'main_menu');

    await ctx.reply(
      ctx.t('search.no_results', { query }),
      { reply_markup: keyboard }
    );
    return;
  }

  // Group by medkit
  const grouped = {};
  for (const med of results) {
    const medkitName = med.medkits?.name || ctx.t('common.not_found');
    if (!grouped[medkitName]) grouped[medkitName] = [];
    grouped[medkitName].push(med);
  }

  let text = ctx.t('search.results_title', { query });
  const keyboard = new InlineKeyboard();

  for (const [medkitName, meds] of Object.entries(grouped)) {
    text += ctx.t('search.medkit_header', { name: medkitName });
    for (const med of meds) {
      const emoji = medicineStatusEmoji(med);
      const qty = formatQuantity(med.quantity, med.quantity_unit);
      text += `${emoji} ${med.name}${med.dosage ? ' ' + med.dosage : ''} — ${qty}\n`;
      keyboard.text(`${med.name}`, `med:${med.id}`).row();
    }
    text += '\n';
  }

  keyboard.text(ctx.t('search.btn_search_again'), 'search').row();
  keyboard.text(ctx.t('common.main_menu'), 'main_menu');

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}
