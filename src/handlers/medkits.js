import { InlineKeyboard } from 'grammy';
import { getUserMedkits, getMedkit, createMedkit, renameMedkit, deleteMedkit, countMedkitMedicines } from '../db/queries/medkits.js';
import { getMedkitMedicines } from '../db/queries/medicines.js';
import { addPagination, paginateItems } from '../keyboards/pagination.js';
import { medicineStatusEmoji, formatQuantity, formatExpiry, daysUntil } from '../utils/format.js';
import { logAction } from '../middleware/logging.js';
import { startAddMedicine } from './addMedicine.js';
import { supabase } from '../db/supabase.js';

/**
 * Show list of user's medkits
 */
async function showMedkitList(ctx, page = 0) {
  const medkits = await getUserMedkits(ctx.dbUser.id);

  if (medkits.length === 0) {
    const keyboard = new InlineKeyboard()
      .text(ctx.t('medkit.btn_create'), 'medkit:create')
      .row()
      .text(ctx.t('common.back'), 'main_menu');

    const text = ctx.t('medkit.list_empty');
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
    return;
  }

  const pageItems = paginateItems(medkits, page);
  let text = ctx.t('medkit.list_title');

  const keyboard = new InlineKeyboard();

  for (const mk of pageItems) {
    const count = await countMedkitMedicines(mk.id);
    const shared = mk.isShared ? ' 👥' : '';
    keyboard.text(`${mk.name} (${count})${shared}`, `medkit:${mk.id}`).row();
  }

  addPagination(keyboard, page, medkits.length, 'medkits');
  keyboard.row();
  keyboard.text(ctx.t('medkit.btn_create'), 'medkit:create').row();
  keyboard.text(ctx.t('common.back'), 'main_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

/**
 * Show single medkit screen with medicines
 */
async function showMedkit(ctx, medkitId, page = 0, { filterField, filterValue } = {}) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit) {
    await ctx.answerCallbackQuery(ctx.t('addmed.medkit_not_found'));
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
  }

  const pageItems = paginateItems(medicines, page);

  let text = ctx.t('medkit.title', { name: medkit.name, count: medicines.length });
  if (filterField) {
    const filterType = filterField === 'category' ? ctx.t('medkit.filter_category') : ctx.t('medkit.filter_tag');
    text += ctx.t('medkit.filter_active', { type: filterType, value: filterValue });
  }
  text += '\n\n';

  for (const med of pageItems) {
    const emoji = medicineStatusEmoji(med, settings.thresholds);
    const qty = formatQuantity(med.quantity, med.quantity_unit);
    const expiry = med.expiry_date ? formatExpiry(med.expiry_date, settings.display?.date_format) : '';
    text += `${emoji} *${med.name}*${med.dosage ? ' ' + med.dosage : ''}\n`;
    text += ctx.t('medkit.med_line_remainder', { qty }) + (expiry ? ctx.t('medkit.med_line_expiry', { expiry }) : '') + '\n';
  }

  if (medicines.length === 0) {
    text += ctx.t('medkit.empty');
  }

  const keyboard = new InlineKeyboard();

  // Medicine buttons (2 per row)
  for (let i = 0; i < pageItems.length; i += 2) {
    keyboard.text(pageItems[i].name, `med:${pageItems[i].id}`);
    if (pageItems[i + 1]) {
      keyboard.text(pageItems[i + 1].name, `med:${pageItems[i + 1].id}`);
    }
    keyboard.row();
  }

  addPagination(keyboard, page, medicines.length, `mk:${medkitId}`);

  keyboard.row();
  keyboard.text(ctx.t('medkit.btn_add'), `medkit:${medkitId}:add`);
  keyboard.text(ctx.t('medkit.btn_sort'), `medkit:${medkitId}:sort`);
  keyboard.text(ctx.t('medkit.btn_filter'), `medkit:${medkitId}:filter`);
  keyboard.row();
  keyboard.text(ctx.t('medkit.btn_share'), `medkit:${medkitId}:share`);
  keyboard.text(ctx.t('medkit.btn_edit'), `medkit:${medkitId}:rename`);
  keyboard.text(ctx.t('medkit.btn_delete'), `medkit:${medkitId}:delete`);
  keyboard.row();
  keyboard.text(ctx.t('medkit.btn_archive'), `medkit:${medkitId}:archive`);
  keyboard.text(ctx.t('common.back'), 'medkits');

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

/**
 * Sort medicines by problems priority: expired -> expiring soon -> low stock -> rest
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
  // Expired — highest priority (lowest score)
  if (days !== null && days <= 0) return 0;
  // Expiring soon
  if (days !== null && days <= (thresholds?.expiry_days || 30)) return 1;
  // Low stock
  const lowCount = thresholds?.low_stock_count || 5;
  const lowPercent = thresholds?.low_stock_percent || 20;
  if (med.quantity <= lowCount) return 2;
  if (med.initial_quantity > 0 && (med.quantity / med.initial_quantity) * 100 <= lowPercent) return 2;
  // Normal
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
      ctx.t('medkit.create_prompt'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), 'medkits'),
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

  // Rename medkit — ask new name
  bot.callbackQuery(/^medkit:([0-9a-f-]+):rename$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await supabase.from('sessions').upsert(
      { key: `state:${ctx.dbUser.id}`, value: { action: 'rename_medkit', medkitId: ctx.match[1], msgId: ctx.callbackQuery.message.message_id }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    await ctx.editMessageText(
      ctx.t('medkit.rename_prompt'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), `medkit:${ctx.match[1]}`),
      }
    );
  });

  // Delete medkit — confirm
  bot.callbackQuery(/^medkit:([0-9a-f-]+):delete$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkit = await getMedkit(ctx.match[1], ctx.dbUser.id);
    if (!medkit) return;

    await ctx.editMessageText(
      ctx.t('medkit.delete_confirm', { name: medkit.name }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.yes_delete'), `medkit:${ctx.match[1]}:delete:confirm`)
          .text(ctx.t('common.no'), `medkit:${ctx.match[1]}`),
      }
    );
  });

  // Delete medkit — confirmed
  bot.callbackQuery(/^medkit:([0-9a-f-]+):delete:confirm$/, async (ctx) => {
    await ctx.answerCallbackQuery(ctx.t('medkit.delete_toast'));
    await deleteMedkit(ctx.match[1]);
    await logAction(ctx.dbUser.id, 'delete', 'medkit', ctx.match[1]);
    await showMedkitList(ctx);
  });

  // Sort menu
  bot.callbackQuery(/^medkit:([0-9a-f-]+):sort$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];
    await ctx.editMessageText(
      ctx.t('medkit.sort_title'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('medkit.sort_name'), `medkit:${medkitId}:sort:name`)
          .text(ctx.t('medkit.sort_expiry'), `medkit:${medkitId}:sort:expiry`)
          .row()
          .text(ctx.t('medkit.sort_category'), `medkit:${medkitId}:sort:category`)
          .text(ctx.t('medkit.sort_quantity'), `medkit:${medkitId}:sort:quantity`)
          .row()
          .text(ctx.t('medkit.sort_problems'), `medkit:${medkitId}:sort:problems`)
          .row()
          .text(ctx.t('common.back'), `medkit:${medkitId}`),
      }
    );
  });

  // Apply sort (temporary — changes display sort for this view)
  bot.callbackQuery(/^medkit:([0-9a-f-]+):sort:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];
    const sortBy = ctx.match[2];
    // Show medkit with selected sort
    const medkit = await getMedkit(medkitId, ctx.dbUser.id);
    if (!medkit) return;

    const settings = ctx.dbUser.settings || {};

    let medicines;
    if (sortBy === 'problems') {
      // Client-side sorting by problem priority
      medicines = await getMedkitMedicines(medkitId, { sortBy: 'name' });
      medicines = sortByProblems(medicines, settings.thresholds);
    } else {
      medicines = await getMedkitMedicines(medkitId, { sortBy });
    }

    const pageItems = paginateItems(medicines, 0);

    let text = ctx.t('medkit.title', { name: medkit.name, count: medicines.length }) + '\n\n';
    for (const med of pageItems) {
      const emoji = medicineStatusEmoji(med, settings.thresholds);
      const qty = formatQuantity(med.quantity, med.quantity_unit);
      const expiry = med.expiry_date ? formatExpiry(med.expiry_date, settings.display?.date_format) : '';
      text += `${emoji} *${med.name}*${med.dosage ? ' ' + med.dosage : ''}\n`;
      text += ctx.t('medkit.med_line_remainder', { qty }) + (expiry ? ctx.t('medkit.med_line_expiry', { expiry }) : '') + '\n';
    }

    const keyboard = new InlineKeyboard();
    for (let i = 0; i < pageItems.length; i += 2) {
      keyboard.text(pageItems[i].name, `med:${pageItems[i].id}`);
      if (pageItems[i + 1]) keyboard.text(pageItems[i + 1].name, `med:${pageItems[i + 1].id}`);
      keyboard.row();
    }
    addPagination(keyboard, 0, medicines.length, `mk:${medkitId}`);
    keyboard.row();
    keyboard.text(ctx.t('medkit.btn_add'), `medkit:${medkitId}:add`);
    keyboard.text(ctx.t('medkit.btn_sort'), `medkit:${medkitId}:sort`);
    keyboard.text(ctx.t('medkit.btn_filter'), `medkit:${medkitId}:filter`);
    keyboard.row();
    keyboard.text(ctx.t('common.back'), 'medkits');

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  // Filter menu
  bot.callbackQuery(/^medkit:([0-9a-f-]+):filter$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];

    await ctx.editMessageText(
      ctx.t('medkit.filter_title'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('medkit.filter_by_category'), `medkit:${medkitId}:filter:cat`)
          .row()
          .text(ctx.t('medkit.filter_by_tag'), `medkit:${medkitId}:filter:tag`)
          .row()
          .text(ctx.t('medkit.filter_clear'), `medkit:${medkitId}`)
          .row()
          .text(ctx.t('common.back'), `medkit:${medkitId}`),
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
        ctx.t('medkit.filter_no_categories'),
        { reply_markup: new InlineKeyboard().text(ctx.t('common.back'), `medkit:${medkitId}:filter`) }
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const cat of categories) {
      keyboard.text(cat, `medkit:${medkitId}:fcat:${cat}`).row();
    }
    keyboard.text(ctx.t('common.back'), `medkit:${medkitId}:filter`);

    await ctx.editMessageText(
      ctx.t('medkit.filter_category_title'),
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
        ctx.t('medkit.filter_no_tags'),
        { reply_markup: new InlineKeyboard().text(ctx.t('common.back'), `medkit:${medkitId}:filter`) }
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const tag of tags) {
      keyboard.text(`#${tag}`, `medkit:${medkitId}:ftag:${tag}`).row();
    }
    keyboard.text(ctx.t('common.back'), `medkit:${medkitId}:filter`);

    await ctx.editMessageText(
      ctx.t('medkit.filter_tag_title'),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
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

  // Share placeholder
  bot.callbackQuery(/^medkit:([0-9a-f-]+):share$/, async (ctx) => {
    await ctx.answerCallbackQuery(ctx.t('common.feature_wip'));
  });
}
