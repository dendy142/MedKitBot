import { InlineKeyboard, InputFile } from 'grammy';
import { getUserMedkits } from '../db/queries/medkits.js';
import { getMedkitMedicines } from '../db/queries/medicines.js';
import { formatDate } from '../utils/format.js';

/**
 * Escape a CSV field (semicolon-separated): wrap in quotes if needed
 */
function csvField(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(';') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Format expiry date for CSV export as MM.YYYY or DD.MM.YYYY
 */
function formatExpiryForCsv(expiryDate) {
  if (!expiryDate) return '';
  const d = new Date(expiryDate);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  // If day is last day of month, export as MM.YYYY (was entered as month-only)
  const lastDay = new Date(year, d.getMonth() + 1, 0).getDate();
  if (d.getDate() === lastDay) {
    return `${month}.${year}`;
  }
  return `${day}.${month}.${year}`;
}

/**
 * Generate CSV content from medicines array
 */
function generateCsv(medicines, ctx) {
  const header = ctx.t('export_import.csv_header');
  const rows = medicines.map((m) => {
    return [
      csvField(m.name),
      csvField(m.dosage),
      csvField(m.category),
      csvField(formatExpiryForCsv(m.expiry_date)),
      csvField(m.quantity),
      csvField(m.quantity_unit),
      csvField(Array.isArray(m.tags) ? m.tags.join(', ') : ''),
      csvField(m.notes),
    ].join(';');
  });
  return [header, ...rows].join('\n');
}

/**
 * Show export medkit selection
 */
async function showExportMenu(ctx) {
  const medkits = await getUserMedkits(ctx.dbUser.id);

  if (medkits.length === 0) {
    const keyboard = new InlineKeyboard().text(ctx.t('common.back'), 'settings');
    await ctx.editMessageText(ctx.t('export_import.export_no_medkits'), {
      reply_markup: keyboard,
    });
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const mk of medkits) {
    keyboard.text(`📦 ${mk.name}`, `export:${mk.id}`).row();
  }
  if (medkits.length > 1) {
    keyboard.text(ctx.t('export_import.export_all'), 'export:all').row();
  }
  keyboard.text(ctx.t('common.back'), 'settings');

  await ctx.editMessageText(ctx.t('export_import.export_title'), {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Handle export for a specific medkit or all
 */
async function handleExportSelect(ctx, target) {
  const medkits = await getUserMedkits(ctx.dbUser.id);
  let allMedicines = [];
  let exportName = '';

  if (target === 'all') {
    for (const mk of medkits) {
      const meds = await getMedkitMedicines(mk.id);
      allMedicines.push(...meds);
    }
    exportName = 'all_medkits';
  } else {
    const mk = medkits.find((m) => m.id === target);
    if (!mk) {
      await ctx.answerCallbackQuery(ctx.t('addmed.medkit_not_found'));
      return;
    }
    allMedicines = await getMedkitMedicines(target);
    exportName = mk.name.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_]/g, '_');
  }

  if (allMedicines.length === 0) {
    await ctx.answerCallbackQuery(ctx.t('export_import.export_no_medicines'));
    await ctx.editMessageText(ctx.t('export_import.export_empty'), {
      reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'export'),
    });
    return;
  }

  const csvContent = generateCsv(allMedicines, ctx);
  const buffer = Buffer.from('\ufeff' + csvContent, 'utf-8');
  const inputFile = new InputFile(buffer, `${exportName}_${Date.now()}.csv`);

  await ctx.answerCallbackQuery();
  await ctx.replyWithDocument(inputFile, {
    caption: ctx.t('export_import.export_done', { count: allMedicines.length }),
  });
}

/**
 * Register export handlers
 */
export function registerExportHandlers(bot) {
  bot.callbackQuery('export', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showExportMenu(ctx);
  });

  bot.callbackQuery(/^export:(.+)$/, async (ctx) => {
    const target = ctx.match[1];
    await handleExportSelect(ctx, target);
  });
}
