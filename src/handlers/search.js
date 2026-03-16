import { InlineKeyboard } from 'grammy';
import { searchMedicines } from '../db/queries/medicines.js';
import { getUserMedkits } from '../db/queries/medkits.js';
import { formatQuantity, medicineStatusEmoji } from '../utils/format.js';
import { startAddMedicine } from './addMedicine.js';
import { supabase } from '../db/supabase.js';

/**
 * Callback: user pressed 🔍 Поиск
 * Stores search state so subsequent text input edits this message instead of creating new ones.
 */
export async function handleSearchCallback(ctx) {
  await ctx.answerCallbackQuery();

  const msgId = ctx.callbackQuery.message.message_id;
  await supabase.from('sessions').upsert(
    { key: `state:${ctx.dbUser.id}`, value: { action: 'search', msgId }, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );

  await ctx.editMessageText(
    '🔍 *Поиск лекарства*\n\nВведите название лекарства:',
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('◀️ Назад', 'main_menu'),
    }
  );
}

/**
 * Helper: send or edit search results
 */
async function sendSearchResult(ctx, text, keyboard, searchState) {
  const opts = { parse_mode: 'Markdown', reply_markup: keyboard };
  if (searchState?.msgId) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, searchState.msgId, text, opts);
      return;
    } catch { /* message might be deleted — fall through to reply */ }
  }
  await ctx.reply(text, opts);
}

/**
 * Fallback handler: user typed text → try to search.
 * If triggered after 🔍 button (search state exists), edits the bot message in-place.
 */
export async function handleSearch(ctx) {
  const query = ctx.message.text.trim();
  if (!query || query.startsWith('/')) return;

  // Check for search state (set by handleSearchCallback)
  const { data: stateData } = await supabase
    .from('sessions')
    .select('value')
    .eq('key', `state:${ctx.dbUser.id}`)
    .single();
  const searchState = stateData?.value?.action === 'search' ? stateData.value : null;

  // Delete user's typed message to keep chat clean
  if (searchState) {
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
  }

  const results = await searchMedicines(ctx.dbUser.id, query);

  if (results.length === 0) {
    const keyboard = new InlineKeyboard();

    // P1.6: Quick add from search "not found"
    const medkits = await getUserMedkits(ctx.dbUser.id);
    if (medkits.length === 1) {
      const safeName = query.slice(0, 40).replace(/:/g, '');
      keyboard.text(`➕ Добавить «${safeName}»`, `search:add:${medkits[0].id}:${safeName}`).row();
    } else if (medkits.length > 1) {
      const safeName = query.slice(0, 40).replace(/:/g, '');
      keyboard.text(`➕ Добавить «${safeName}»`, `search:addpick:${safeName}`).row();
    }

    keyboard.text('📦 Аптечки', 'medkits')
      .text('🔍 Искать ещё', 'search')
      .row()
      .text('🏠 Меню', 'main_menu');

    await sendSearchResult(ctx,
      `🔍 По запросу «${query}» ничего не найдено.\n\nПопробуйте другой запрос.`,
      keyboard, searchState
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
  keyboard.text('🏠 Меню', 'main_menu');

  await sendSearchResult(ctx, text, keyboard, searchState);
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
