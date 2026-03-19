import { InlineKeyboard, InputFile } from 'grammy';
import { getUserMedkits } from '../db/queries/medkits.js';
import { getMedkitMedicines } from '../db/queries/medicines.js';
import { getUserActiveSchedules } from '../db/queries/schedules.js';
import { formatDate } from '../utils/format.js';
import { supabase } from '../db/supabase.js';
import { DEFAULT_SETTINGS } from '../config.js';

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
 * Show export format selection for a target (medkit id or 'all')
 */
async function showExportFormatMenu(ctx, target) {
  const keyboard = new InlineKeyboard()
    .text('📄 CSV', `export:csv:${target}`)
    .text(ctx.t('pdf.btn_export_pdf'), `export:pdf:${target}`)
    .row()
    .text(ctx.t('common.back'), 'export');

  await ctx.editMessageText(
    ctx.t('export_import.export_title'),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
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
    keyboard.text(`📦 ${mk.name}`, `export:select:${mk.id}`).row();
  }
  if (medkits.length > 1) {
    keyboard.text(ctx.t('export_import.export_all'), 'export:select:all').row();
  }
  // Backup and schedule export
  keyboard.text(ctx.t('backup.btn_export'), 'backup:export').row();
  keyboard.text(ctx.t('schedule_export.btn_export'), 'export:schedules').row();
  keyboard.text(ctx.t('common.back'), 'settings');

  await ctx.editMessageText(ctx.t('export_import.export_title'), {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Gather medicines for export
 */
async function gatherMedicines(ctx, target) {
  const medkits = await getUserMedkits(ctx.dbUser.id);
  let allMedicines = [];
  let exportName = '';
  let medkitName = '';

  if (target === 'all') {
    for (const mk of medkits) {
      const meds = await getMedkitMedicines(mk.id);
      allMedicines.push(...meds);
    }
    exportName = 'all_medkits';
    medkitName = 'Все аптечки';
  } else {
    const mk = medkits.find((m) => m.id === target);
    if (!mk) return null;
    allMedicines = await getMedkitMedicines(target);
    exportName = mk.name.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_]/g, '_');
    medkitName = mk.name;
  }

  return { allMedicines, exportName, medkitName };
}

/**
 * Handle CSV export
 */
async function handleCsvExport(ctx, target) {
  const result = await gatherMedicines(ctx, target);
  if (!result) {
    await ctx.answerCallbackQuery(ctx.t('addmed.medkit_not_found'));
    return;
  }

  const { allMedicines, exportName } = result;

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
 * #97 Handle PDF export — generates a formatted text file with table layout
 * (pdfkit cannot render Cyrillic without a TTF font; we send a .txt document)
 */
async function handlePdfExport(ctx, target) {
  const result = await gatherMedicines(ctx, target);
  if (!result) {
    await ctx.answerCallbackQuery(ctx.t('addmed.medkit_not_found'));
    return;
  }

  const { allMedicines, exportName, medkitName } = result;

  if (allMedicines.length === 0) {
    await ctx.answerCallbackQuery(ctx.t('export_import.export_no_medicines'));
    await ctx.editMessageText(ctx.t('export_import.export_empty'), {
      reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'export'),
    });
    return;
  }

  // Build formatted text document (Cyrillic-friendly fallback)
  const dateFormat = ctx.dbUser.settings?.display?.date_format || 'DD.MM.YYYY';
  const now = new Date();
  const generatedDate = formatDate(now, dateFormat);

  let content = `╔══════════════════════════════════════════════════╗\n`;
  content += `║  ${ctx.t('pdf.header', { name: medkitName }).padEnd(48)}║\n`;
  content += `╚══════════════════════════════════════════════════╝\n\n`;

  // Table header
  const colName = ctx.t('pdf.col_name').padEnd(20);
  const colDosage = ctx.t('pdf.col_dosage').padEnd(12);
  const colCategory = ctx.t('pdf.col_category').padEnd(16);
  const colExpiry = ctx.t('pdf.col_expiry').padEnd(12);
  const colQty = ctx.t('pdf.col_quantity').padEnd(8);
  content += `${colName}${colDosage}${colCategory}${colExpiry}${colQty}\n`;
  content += `${'─'.repeat(68)}\n`;

  for (const m of allMedicines) {
    const name = (m.name || '').substring(0, 19).padEnd(20);
    const dosage = (m.dosage || '—').substring(0, 11).padEnd(12);
    const category = (m.category || '—').substring(0, 15).padEnd(16);
    const expiry = m.expiry_date ? formatExpiryForCsv(m.expiry_date).padEnd(12) : '—'.padEnd(12);
    const qty = String(m.quantity || 0).padEnd(8);
    content += `${name}${dosage}${category}${expiry}${qty}\n`;
  }

  content += `${'─'.repeat(68)}\n`;
  content += `\n${ctx.t('pdf.footer', { date: generatedDate })}\n`;

  const buffer = Buffer.from('\ufeff' + content, 'utf-8');
  const inputFile = new InputFile(buffer, `${exportName}_${Date.now()}.txt`);

  await ctx.answerCallbackQuery();
  await ctx.replyWithDocument(inputFile, {
    caption: ctx.t('export_import.export_done', { count: allMedicines.length }),
  });
}

/**
 * #99 Export schedules as formatted text
 */
async function handleScheduleExport(ctx) {
  const schedules = await getUserActiveSchedules(ctx.dbUser.id);

  if (!schedules || schedules.length === 0) {
    await ctx.answerCallbackQuery(ctx.t('schedule_export.empty'));
    return;
  }

  // Group by time
  const byTime = {};
  for (const sched of schedules) {
    const time = sched.time_value || '00:00';
    if (!byTime[time]) byTime[time] = [];
    byTime[time].push(sched);
  }

  let text = ctx.t('schedule_export.title');
  const times = Object.keys(byTime).sort();

  for (const time of times) {
    // Determine period label
    let period = time;
    const hour = parseInt(time.split(':')[0], 10);
    if (hour >= 5 && hour < 12) period = '🌅 Утро';
    else if (hour >= 12 && hour < 17) period = '☀️ День';
    else if (hour >= 17 && hour < 22) period = '🌆 Вечер';
    else period = '🌙 Ночь';

    text += ctx.t('schedule_export.time_group', { period, time });
    for (const sched of byTime[time]) {
      const name = sched.medicines?.name || '?';
      const dosage = sched.medicines?.dosage || '';
      const dose = sched.dose_per_intake || 1;
      const unit = sched.medicines?.quantity_unit || ctx.t('intake.default_unit');
      text += ctx.t('schedule_export.item', { name, dosage, dose, unit });
    }
    text += '\n';
  }

  text += ctx.t('schedule_export.footer');

  await ctx.answerCallbackQuery();
  await ctx.reply(text);
}

/**
 * #100 Full JSON backup export
 */
async function handleBackupExport(ctx) {
  const medkits = await getUserMedkits(ctx.dbUser.id);
  const backup = {
    version: 1,
    exported_at: new Date().toISOString(),
    user: {
      timezone: ctx.dbUser.timezone,
      settings: ctx.dbUser.settings || DEFAULT_SETTINGS,
    },
    medkits: [],
  };

  for (const mk of medkits) {
    const medicines = await getMedkitMedicines(mk.id);
    const medkitData = {
      name: mk.name,
      medicines: [],
    };

    for (const med of medicines) {
      // Get schedules for this medicine
      const { data: schedules } = await supabase
        .from('schedules')
        .select('*')
        .eq('medicine_id', med.id);

      medkitData.medicines.push({
        name: med.name,
        dosage: med.dosage,
        category: med.category,
        tags: med.tags,
        expiry_date: med.expiry_date,
        quantity: med.quantity,
        quantity_unit: med.quantity_unit,
        initial_quantity: med.initial_quantity,
        notes: med.notes,
        is_favorite: med.is_favorite,
        photo_file_ids: med.photo_file_ids,
        schedules: (schedules || []).map(s => ({
          time_mode: s.time_mode,
          time_value: s.time_value,
          dose_per_intake: s.dose_per_intake,
          frequency: s.frequency,
          frequency_days: s.frequency_days,
          duration_type: s.duration_type,
          duration_value: s.duration_value,
          status: s.status,
        })),
      });
    }

    backup.medkits.push(medkitData);
  }

  const json = JSON.stringify(backup, null, 2);
  const buffer = Buffer.from(json, 'utf-8');
  const inputFile = new InputFile(buffer, `medkit_backup_${Date.now()}.json`);

  await ctx.answerCallbackQuery();
  await ctx.replyWithDocument(inputFile, {
    caption: ctx.t('backup.export_done'),
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

  // Medkit selected — show format choice
  bot.callbackQuery(/^export:select:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const target = ctx.match[1];
    await showExportFormatMenu(ctx, target);
  });

  // CSV export
  bot.callbackQuery(/^export:csv:(.+)$/, async (ctx) => {
    const target = ctx.match[1];
    await handleCsvExport(ctx, target);
  });

  // #97 PDF/TXT export
  bot.callbackQuery(/^export:pdf:(.+)$/, async (ctx) => {
    const target = ctx.match[1];
    await handlePdfExport(ctx, target);
  });

  // #99 Schedule export
  bot.callbackQuery('export:schedules', async (ctx) => {
    await handleScheduleExport(ctx);
  });

  // #100 Backup export
  bot.callbackQuery('backup:export', async (ctx) => {
    await handleBackupExport(ctx);
  });

  // Legacy: direct export:ID still works (defaults to CSV)
  bot.callbackQuery(/^export:([0-9a-f-]+)$/, async (ctx) => {
    const target = ctx.match[1];
    await handleCsvExport(ctx, target);
  });
}
