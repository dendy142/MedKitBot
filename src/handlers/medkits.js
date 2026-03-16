import { InlineKeyboard } from 'grammy';
import { getUserMedkits, getMedkit, createMedkit, renameMedkit, deleteMedkit, countMedkitMedicinesBatch } from '../db/queries/medkits.js';
import { getMedkitMedicines } from '../db/queries/medicines.js';
import { addPagination, paginateItems } from '../keyboards/pagination.js';
import { medicineStatusEmoji, formatQuantity, formatExpiry, daysUntil, getMedWord } from '../utils/format.js';
import { logAction } from '../middleware/logging.js';
import { startAddMedicine, startQuickAdd } from './addMedicine.js';
import { supabase } from '../db/supabase.js';

/**
 * Show list of user's medkits
 */
async function showMedkitList(ctx, page = 0) {
  const medkits = await getUserMedkits(ctx.dbUser.id);

  if (medkits.length === 0) {
    const keyboard = new InlineKeyboard()
      .text('➕ Создать аптечку', 'medkit:create')
      .row()
      .text('◀️ Назад', 'main_menu');

    const text = '📦 *Мои аптечки*\n\nУ вас пока нет аптечек. Создайте первую!';
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
    return;
  }

  const pageItems = paginateItems(medkits, page);
  let text = '📦 *Мои аптечки*\n\n';

  const keyboard = new InlineKeyboard();

  const counts = await countMedkitMedicinesBatch(pageItems.map(mk => mk.id));
  for (const mk of pageItems) {
    const count = counts[mk.id] || 0;
    const shared = mk.isShared ? ' 👥' : '';
    keyboard.text(`${mk.name} (${count})${shared}`, `medkit:${mk.id}`).row();
  }

  addPagination(keyboard, page, medkits.length, 'medkits');
  keyboard.row();
  keyboard.text('➕ Создать аптечку', 'medkit:create').row();
  keyboard.text('◀️ Назад', 'main_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

/**
 * Build medkit keyboard with medicine buttons and actions.
 * Shared by showMedkit and sort view to prevent button loss.
 */
function buildMedkitKeyboard(medkitId, pageItems, page, totalItems) {
  const keyboard = new InlineKeyboard();

  // Medicine buttons (2 per row)
  for (let i = 0; i < pageItems.length; i += 2) {
    keyboard.text(pageItems[i].name, `med:${pageItems[i].id}`);
    if (pageItems[i + 1]) {
      keyboard.text(pageItems[i + 1].name, `med:${pageItems[i + 1].id}`);
    }
    keyboard.row();
  }

  addPagination(keyboard, page, totalItems, `mk:${medkitId}`);

  keyboard.row();
  // P1.1: Quick Add + full Add
  keyboard.text('⚡ Быстро', `medkit:${medkitId}:quickadd`);
  keyboard.text('➕ Добавить', `medkit:${medkitId}:add`);
  keyboard.row();
  keyboard.text('🔀 Сорт.', `medkit:${medkitId}:sort`);
  keyboard.text('📂 Фильтр', `medkit:${medkitId}:filter`);
  keyboard.row();
  keyboard.text('⚙️ Управление', `medkit:${medkitId}:manage`);
  keyboard.row();
  keyboard.text('◀️ Назад', 'medkits');

  return keyboard;
}

/**
 * Format medicine list text
 */
function formatMedicineList(pageItems, settings) {
  let text = '';
  for (const med of pageItems) {
    const emoji = medicineStatusEmoji(med, settings.thresholds);
    const qty = formatQuantity(med.quantity, med.quantity_unit);
    const thresholdDays = settings.thresholds?.expiry_days || 30;
    const expiry = med.expiry_date ? formatExpiry(med.expiry_date, settings.display?.date_format, thresholdDays) : '';
    text += `${emoji} *${med.name}*${med.dosage ? ' ' + med.dosage : ''}\n`;
    text += `└ ${qty}${expiry ? ' | до ' + expiry : ''}\n`;
  }
  return text;
}

/**
 * Show single medkit screen with medicines
 */
async function showMedkit(ctx, medkitId, page = 0, { filterField, filterValue } = {}) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit) {
    await ctx.answerCallbackQuery('Аптечка не найдена');
    return;
  }

  const settings = ctx.dbUser.settings || {};
  const sortBy = settings.display?.default_sort || 'name';
  let medicines = await getMedkitMedicines(medkitId, { sortBy });

  // Apply filter if specified
  if (filterField === 'category' && filterValue) {
    medicines = medicines.filter(m => m.category === filterValue);
  } else if (filterField === 'tag' && filterValue) {
    medicines = medicines.filter(m => m.tags && m.tags.includes(filterValue));
  } else if (filterField === 'favorite') {
    // P2.5: Filter by favorites
    medicines = medicines.filter(m => m.is_favorite);
  }

  const pageItems = paginateItems(medicines, page);

  let text = `📦 *${medkit.name}* (${medicines.length})`;
  if (filterField) {
    const filterLabels = { category: 'категория', tag: 'тег', favorite: '⭐ избранное' };
    text += `\n🔍 Фильтр: ${filterLabels[filterField] || filterField}${filterField !== 'favorite' ? ` «${filterValue}»` : ''}`;
  }
  text += '\n\n';

  text += formatMedicineList(pageItems, settings);

  if (medicines.length === 0 && !filterField) {
    text += '_Пока пусто. Нажмите ➕ чтобы добавить первое лекарство!_\n';
  } else if (medicines.length === 0 && filterField) {
    text += '_Нет лекарств по этому фильтру._\n';
  }

  const keyboard = buildMedkitKeyboard(medkitId, pageItems, page, medicines.length);

  // Add filter reset button if filter is active
  if (filterField) {
    // Insert before the last "Назад" row
    const resetKb = new InlineKeyboard();
    // Copy existing keyboard but add reset before back
    for (const row of keyboard.inline_keyboard.slice(0, -1)) {
      for (const btn of row) {
        resetKb.text(btn.text, btn.callback_data);
      }
      resetKb.row();
    }
    resetKb.text('❌ Сбросить фильтр', `medkit:${medkitId}`);
    resetKb.row();
    resetKb.text('◀️ Назад', 'medkits');
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: resetKb });
  } else {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

/**
 * Sort medicines by problems priority
 */
function sortByProblems(medicines, thresholds) {
  return [...medicines].sort((a, b) => {
    const scoreA = problemScore(a, thresholds);
    const scoreB = problemScore(b, thresholds);
    return scoreA - scoreB;
  });
}

function problemScore(med, thresholds) {
  const days = daysUntil(med.expiry_date);
  if (days !== null && days <= 0) return 0;
  if (days !== null && days <= (thresholds?.expiry_days || 30)) return 1;
  const lowCount = thresholds?.low_stock_count || 5;
  const lowPercent = thresholds?.low_stock_percent || 20;
  if (med.quantity <= lowCount) return 2;
  if (med.initial_quantity > 0 && (med.quantity / med.initial_quantity) * 100 <= lowPercent) return 2;
  return 3;
}

/**
 * Register all medkit-related callback handlers
 */
export function registerMedkitHandlers(bot) {
  // List medkits
  bot.callbackQuery('medkits', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMedkitList(ctx);
  });

  // Medkit list pagination
  bot.callbackQuery(/^medkits:page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMedkitList(ctx, parseInt(ctx.match[1]));
  });

  // Create medkit — ask name
  bot.callbackQuery('medkit:create', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      '📦 *Новая аптечка*\n\nВведите название:',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('❌ Отмена', 'medkits'),
      }
    );
    await supabase.from('sessions').upsert(
      { key: `state:${ctx.dbUser.id}`, value: { action: 'create_medkit', msgId: ctx.callbackQuery.message.message_id }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
  });

  // View single medkit
  bot.callbackQuery(/^medkit:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMedkit(ctx, ctx.match[1]);
  });

  // Medkit medicine pagination
  bot.callbackQuery(/^mk:([0-9a-f-]+):page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMedkit(ctx, ctx.match[1], parseInt(ctx.match[2]));
  });

  // P1.1: Quick add medicine
  bot.callbackQuery(/^medkit:([0-9a-f-]+):quickadd$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await startQuickAdd(ctx, ctx.match[1]);
  });

  // Add medicine to medkit
  bot.callbackQuery(/^medkit:([0-9a-f-]+):add$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await startAddMedicine(ctx, ctx.match[1]);
  });

  // Add medicine from onboarding
  bot.callbackQuery(/^medkit:([0-9a-f-]+):add:onboard$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await startAddMedicine(ctx, ctx.match[1], { fromOnboarding: true });
  });

  // Manage medkit submenu
  bot.callbackQuery(/^medkit:([0-9a-f-]+):manage$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];
    const medkit = await getMedkit(medkitId, ctx.dbUser.id);
    if (!medkit) return;

    // P2.3: Export/Import accessible from medkit manage menu
    await ctx.editMessageText(
      `⚙️ *Управление: ${medkit.name}*`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('👥 Поделиться', `medkit:${medkitId}:share`)
          .text('✏️ Переименовать', `medkit:${medkitId}:rename`)
          .row()
          .text('📤 Экспорт', `export:${medkitId}`)
          .text('📥 Импорт', 'import')
          .row()
          .text('🗃 Архив', `medkit:${medkitId}:archive`)
          .text('🗑 Удалить', `medkit:${medkitId}:delete`)
          .row()
          .text('◀️ Назад', `medkit:${medkitId}`),
      }
    );
  });

  // Rename medkit — ask new name
  bot.callbackQuery(/^medkit:([0-9a-f-]+):rename$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await supabase.from('sessions').upsert(
      { key: `state:${ctx.dbUser.id}`, value: { action: 'rename_medkit', medkitId: ctx.match[1], msgId: ctx.callbackQuery.message.message_id }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    await ctx.editMessageText(
      '✏️ Введите новое название аптечки:',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('❌ Отмена', `medkit:${ctx.match[1]}`),
      }
    );
  });

  // Delete medkit — confirm (P2.2: contextual info)
  bot.callbackQuery(/^medkit:([0-9a-f-]+):delete$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];
    const medkit = await getMedkit(medkitId, ctx.dbUser.id);
    if (!medkit) return;

    const medicines = await getMedkitMedicines(medkitId);
    const medCount = medicines.length;
    let warning = `🗑 Вы уверены, что хотите удалить аптечку «${medkit.name}»?\n\n`;
    warning += `⚠️ Будет удалено: ${medCount} ${getMedWord(medCount)}`;
    warning += `, а также все связанные расписания и логи приёма.`;

    await ctx.editMessageText(warning, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('✅ Да, удалить', `medkit:${medkitId}:delete:confirm`)
        .text('❌ Нет', `medkit:${medkitId}:manage`),
    });
  });

  // Delete medkit — confirmed
  bot.callbackQuery(/^medkit:([0-9a-f-]+):delete:confirm$/, async (ctx) => {
    await ctx.answerCallbackQuery('Аптечка удалена');
    await deleteMedkit(ctx.match[1]);
    await logAction(ctx.dbUser.id, 'delete', 'medkit', ctx.match[1]);
    await showMedkitList(ctx);
  });

  // Sort menu
  bot.callbackQuery(/^medkit:([0-9a-f-]+):sort$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];
    await ctx.editMessageText(
      '🔀 *Сортировка*\n\nВыберите порядок:',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('По названию', `medkit:${medkitId}:sort:name`)
          .text('По сроку', `medkit:${medkitId}:sort:expiry`)
          .row()
          .text('По категории', `medkit:${medkitId}:sort:category`)
          .text('По остатку', `medkit:${medkitId}:sort:quantity`)
          .row()
          .text('⚠️ Проблемные', `medkit:${medkitId}:sort:problems`)
          .row()
          .text('◀️ Назад', `medkit:${medkitId}`),
      }
    );
  });

  // Apply sort — uses shared keyboard builder
  bot.callbackQuery(/^medkit:([0-9a-f-]+):sort:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];
    const sortBy = ctx.match[2];
    const medkit = await getMedkit(medkitId, ctx.dbUser.id);
    if (!medkit) return;

    const settings = ctx.dbUser.settings || {};

    let medicines;
    if (sortBy === 'problems') {
      medicines = await getMedkitMedicines(medkitId, { sortBy: 'name' });
      medicines = sortByProblems(medicines, settings.thresholds);
    } else {
      medicines = await getMedkitMedicines(medkitId, { sortBy });
    }

    const pageItems = paginateItems(medicines, 0);

    const sortLabels = { name: 'по названию', expiry: 'по сроку', category: 'по категории', quantity: 'по остатку', problems: 'проблемные' };
    let text = `📦 *${medkit.name}* (${medicines.length})\n`;
    text += `🔀 Сортировка: ${sortLabels[sortBy] || sortBy}\n\n`;
    text += formatMedicineList(pageItems, settings);

    const keyboard = buildMedkitKeyboard(medkitId, pageItems, 0, medicines.length);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  // Filter menu
  bot.callbackQuery(/^medkit:([0-9a-f-]+):filter$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];

    // P2.5: Added favorite filter
    await ctx.editMessageText(
      '📂 *Фильтр*\n\nВыберите тип фильтра:',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('⭐ Избранное', `medkit:${medkitId}:filter:fav`)
          .row()
          .text('По категории ▸', `medkit:${medkitId}:filter:cat`)
          .row()
          .text('По тегу ▸', `medkit:${medkitId}:filter:tag`)
          .row()
          .text('◀️ Назад', `medkit:${medkitId}`),
      }
    );
  });

  // Filter by category — show category list
  bot.callbackQuery(/^medkit:([0-9a-f-]+):filter:cat$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];
    const medicines = await getMedkitMedicines(medkitId);

    const categories = [...new Set(medicines.map(m => m.category).filter(Boolean))].sort();

    if (categories.length === 0) {
      await ctx.editMessageText(
        '📂 Нет категорий в этой аптечке.',
        { reply_markup: new InlineKeyboard().text('◀️ Назад', `medkit:${medkitId}:filter`) }
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const cat of categories) {
      keyboard.text(cat, `medkit:${medkitId}:fcat:${cat}`).row();
    }
    keyboard.text('◀️ Назад', `medkit:${medkitId}:filter`);

    await ctx.editMessageText(
      '📂 *Фильтр по категории*\n\nВыберите категорию:',
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  });

  // Filter by tag — show tag list
  bot.callbackQuery(/^medkit:([0-9a-f-]+):filter:tag$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];
    const medicines = await getMedkitMedicines(medkitId);

    const tags = [...new Set(medicines.flatMap(m => m.tags || []))].sort();

    if (tags.length === 0) {
      await ctx.editMessageText(
        '📂 Нет тегов в этой аптечке.',
        { reply_markup: new InlineKeyboard().text('◀️ Назад', `medkit:${medkitId}:filter`) }
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const tag of tags) {
      keyboard.text(`#${tag}`, `medkit:${medkitId}:ftag:${tag}`).row();
    }
    keyboard.text('◀️ Назад', `medkit:${medkitId}:filter`);

    await ctx.editMessageText(
      '📂 *Фильтр по тегу*\n\nВыберите тег:',
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  });

  // P2.5: Apply favorite filter
  bot.callbackQuery(/^medkit:([0-9a-f-]+):filter:fav$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMedkit(ctx, ctx.match[1], 0, { filterField: 'favorite', filterValue: true });
  });

  // Apply category filter
  bot.callbackQuery(/^medkit:([0-9a-f-]+):fcat:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];
    const category = ctx.match[2];
    await showMedkit(ctx, medkitId, 0, { filterField: 'category', filterValue: category });
  });

  // Apply tag filter
  bot.callbackQuery(/^medkit:([0-9a-f-]+):ftag:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];
    const tag = ctx.match[2];
    await showMedkit(ctx, medkitId, 0, { filterField: 'tag', filterValue: tag });
  });

}
