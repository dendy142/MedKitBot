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
  // #63 Export by profile
  keyboard.text(ctx.t('profile.btn_export_by_profile'), 'export:by_profile').row();
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
    return;
  }

  const { allMedicines, exportName } = result;

  if (allMedicines.length === 0) {
    await ctx.editMessageText(ctx.t('export_import.export_empty'), {
      reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'export'),
    });
    return;
  }

  const csvContent = generateCsv(allMedicines, ctx);
  const buffer = Buffer.from('\ufeff' + csvContent, 'utf-8');
  const inputFile = new InputFile(buffer, `${exportName}_${Date.now()}.csv`);

  await ctx.replyWithDocument(inputFile, {
    caption: ctx.t('export_import.export_done', { count: allMedicines.length }),
  });
}

/**
 * #97 Handle PDF export — generates actual PDF using pdfkit.
 * Uses built-in Courier font (Cyrillic may not render — noted in caption).
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

  const PDFDocument = (await import('pdfkit')).default;
  const dateFormat = ctx.dbUser.settings?.display?.date_format || 'DD.MM.YYYY';
  const now = new Date();
  const generatedDate = formatDate(now, dateFormat);

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  // Title
  doc.font('Courier-Bold').fontSize(16);
  doc.text(`Medkit: ${medkitName}`, { align: 'center' });
  doc.moveDown(0.5);

  // Table header
  doc.font('Courier-Bold').fontSize(9);
  const colX = [40, 190, 270, 350, 430];
  const headers = ['Name', 'Dosage', 'Category', 'Expiry', 'Qty'];
  headers.forEach((h, i) => {
    doc.text(h, colX[i], doc.y, { continued: i < headers.length - 1, width: colX[i + 1] ? colX[i + 1] - colX[i] : 100 });
  });
  doc.moveDown(0.3);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
  doc.moveDown(0.3);

  // Table rows
  doc.font('Courier').fontSize(8);
  for (const m of allMedicines) {
    const y = doc.y;
    if (y > 750) {
      doc.addPage();
    }
    const row = [
      (m.name || '').substring(0, 22),
      (m.dosage || '-').substring(0, 12),
      (m.category || '-').substring(0, 12),
      m.expiry_date ? formatExpiryForCsv(m.expiry_date) : '-',
      String(m.quantity || 0),
    ];
    const rowY = doc.y;
    row.forEach((cell, i) => {
      doc.text(cell, colX[i], rowY, { width: (colX[i + 1] || 555) - colX[i], lineBreak: false });
    });
    doc.y = rowY + 14;
  }

  // Footer
  doc.moveDown(1);
  doc.font('Courier').fontSize(8);
  doc.text(`Generated ${generatedDate} - @my_med_kit_bot`, 40, doc.y, { align: 'center' });

  doc.end();

  // Wait for stream to finish
  const pdfBuffer = await new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const inputFile = new InputFile(pdfBuffer, `${exportName}_${Date.now()}.pdf`);

  await ctx.answerCallbackQuery();
  await ctx.replyWithDocument(inputFile, {
    caption: ctx.t('export_import.export_done', { count: allMedicines.length }) + '\n\n' +
      ctx.t('export_import.pdf_font_note'),
  });
}

/**
 * #99 Export schedules as formatted text
 */
async function handleScheduleExport(ctx) {
  const schedules = await getUserActiveSchedules(ctx.dbUser.id);

  if (!schedules || schedules.length === 0) {
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
    profiles: [],
    medkits: [],
  };

  // #100 Include profiles
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', ctx.dbUser.id);

  backup.profiles = (profiles || []).map(p => ({
    name: p.name,
    icon: p.icon,
    birth_year: p.birth_year,
    tags: p.tags,
    is_default: p.is_default,
  }));

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
    await ctx.answerCallbackQuery({ text: ctx.t('common.loading') });
    const target = ctx.match[1];
    await handleCsvExport(ctx, target);
  });

  // #97 PDF/TXT export
  bot.callbackQuery(/^export:pdf:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: ctx.t('common.loading') });
    const target = ctx.match[1];
    await handlePdfExport(ctx, target);
  });

  // #99 Schedule export
  bot.callbackQuery('export:schedules', async (ctx) => {
    await ctx.answerCallbackQuery({ text: ctx.t('common.loading') });
    await handleScheduleExport(ctx);
  });

  // #100 Backup export
  bot.callbackQuery('backup:export', async (ctx) => {
    await ctx.answerCallbackQuery({ text: ctx.t('common.loading') });
    await handleBackupExport(ctx);
  });

  // #63 Export filtered by profile
  bot.callbackQuery(/^export:profile:(all|general|[0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: ctx.t('common.loading') });
    const profileVal = ctx.match[1];

    // Gather all medicines from all medkits, then filter by profile
    const medkits = await getUserMedkits(ctx.dbUser.id);
    let allMedicines = [];
    for (const mk of medkits) {
      const meds = await getMedkitMedicines(mk.id);
      allMedicines.push(...meds);
    }

    if (profileVal === 'general') {
      allMedicines = allMedicines.filter(m => !m.profile_id);
    } else if (profileVal !== 'all') {
      allMedicines = allMedicines.filter(m => m.profile_id === profileVal);
    }

    if (allMedicines.length === 0) {
      await ctx.editMessageText(ctx.t('export_import.export_empty'), {
        reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'export'),
      });
      return;
    }

    const csvContent = generateCsv(allMedicines, ctx);
    const buffer = Buffer.from('\ufeff' + csvContent, 'utf-8');
    const inputFile = new InputFile(buffer, `profile_export_${Date.now()}.csv`);
    await ctx.replyWithDocument(inputFile, {
      caption: ctx.t('export_import.export_done', { count: allMedicines.length }),
    });
  });

  // Legacy: direct export:ID still works (defaults to CSV)
  bot.callbackQuery(/^export:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: ctx.t('common.loading') });
    const target = ctx.match[1];
    await handleCsvExport(ctx, target);
  });
}
