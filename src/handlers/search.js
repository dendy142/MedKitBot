import { InlineKeyboard } from 'grammy';
import { searchMedicines } from '../db/queries/medicines.js';
import { getUserMedkits } from '../db/queries/medkits.js';
import { formatQuantity, medicineStatusEmoji } from '../utils/format.js';
import { startAddMedicine } from './addMedicine.js';

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
    const keyboard = new InlineKeyboard();

    // P1.6: Quick add from search "not found"
    const medkits = await getUserMedkits(ctx.dbUser.id);
    if (medkits.length === 1) {
      const safeName = query.slice(0, 40);
      keyboard.text(`➕ Добавить «${safeName}»`, `search:add:${medkits[0].id}:${safeName}`).row();
    } else if (medkits.length > 1) {
      const safeName = query.slice(0, 40);
      keyboard.text(`➕ Добавить «${safeName}»`, `search:addpick:${safeName}`).row();
    }

    keyboard.text('📦 Аптечки', 'medkits')
      .text('🔍 Искать ещё', 'search')
      .row()
      .text('◀️ Главное меню', 'main_menu');

    await ctx.reply(
      `🔍 По запросу «${query}» ничего не найдено.\n\nПопробуйте другой запрос.`,
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
      const emoji = medicineStatusEmoji(med, ctx.dbUser.settings?.thresholds);
      const qty = formatQuantity(med.quantity, med.quantity_unit);
      text += `${emoji} ${med.name}${med.dosage ? ' ' + med.dosage : ''} — ${qty}\n`;
      // P1.4: Quick restock button from search results
      keyboard.text(`${med.name}`, `med:${med.id}`);
      keyboard.text('➕', `med:${med.id}:restock`);
      keyboard.row();
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

/**
 * Register search-related callback handlers
 * P1.6: Add medicine from search "not found"
 */
export function registerSearchHandlers(bot) {
  // Add from search — single medkit (direct)
  bot.callbackQuery(/^search:add:([0-9a-f-]+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];
    const name = ctx.match[2];
    await startAddMedicine(ctx, medkitId, { prefillName: name });
  });

  // Add from search — pick medkit
  bot.callbackQuery(/^search:addpick:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const name = ctx.match[1];
    const medkits = await getUserMedkits(ctx.dbUser.id);

    const keyboard = new InlineKeyboard();
    for (const mk of medkits) {
      keyboard.text(mk.name, `search:add:${mk.id}:${name}`).row();
    }
    keyboard.text('❌ Отмена', 'main_menu');

    await ctx.editMessageText(
      `📦 В какую аптечку добавить «${name}»?`,
      { reply_markup: keyboard }
    );
  });
}
