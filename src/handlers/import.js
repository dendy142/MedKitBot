import { InlineKeyboard } from 'grammy';
import { supabase } from '../db/supabase.js';
import { getUserMedkits } from '../db/queries/medkits.js';
import { createMedicine } from '../db/queries/medicines.js';
import { parseDate } from '../utils/format.js';
import { BOT_TOKEN } from '../config.js';

async function getState(userId) {
  const { data } = await supabase
    .from('sessions')
    .select('value')
    .eq('key', `state:${userId}`)
    .single();
  return data?.value ?? null;
}

async function setState(userId, value) {
  await supabase
    .from('sessions')
    .upsert({ key: `state:${userId}`, value }, { onConflict: 'key' });
}

async function clearState(userId) {
  await supabase.from('sessions').delete().eq('key', `state:${userId}`);
}

async function deleteUserMsg(ctx) {
  try { await ctx.deleteMessage(); } catch { /* ignore */ }
}

/**
 * Parse CSV text (semicolon-separated) into medicine objects
 */
function parseCsv(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);
  if (lines.length === 0) return [];

  // Skip header if present
  const startIdx = lines[0].toLowerCase().includes('название') ? 1 : 0;
  const medicines = [];

  for (let i = startIdx; i < lines.length; i++) {
    const parts = lines[i].split(';').map((p) => p.replace(/^"|"$/g, '').replace(/""/g, '"'));
    if (parts.length >= 1 && parts[0]?.trim()) {
      const rawExpiry = parts[3]?.trim();
      const parsedDate = parseDate(rawExpiry);

      medicines.push({
        name: parts[0]?.trim(),
        dosage: parts[1]?.trim() || null,
        category: parts[2]?.trim() || null,
        expiryDate: parsedDate ? parsedDate.toISOString().split('T')[0] : null,
        quantity: parseFloat(parts[4]) || 0,
        quantityUnit: parts[5]?.trim() || 'шт',
        tags: parts[6]?.trim() ? parts[6].trim().split(',').map((t) => t.trim()).filter(Boolean) : [],
        notes: parts[7]?.trim() || null,
      });
    }
  }
  return medicines;
}

/**
 * Show import instructions
 */
async function showImportMenu(ctx) {
  const text = ctx.t('export_import.import_title');

  const keyboard = new InlineKeyboard().text(ctx.t('common.back'), 'settings');

  let msgId;
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    msgId = ctx.callbackQuery.message?.message_id;
  } else {
    const sent = await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    msgId = sent.message_id;
  }

  // Set state to expect CSV document
  await setState(ctx.dbUser.id, { action: 'import_csv', msgId });
}

/**
 * Handle document upload for import
 */
export async function handleImportDocument(ctx) {
  const state = await getState(ctx.dbUser.id);
  if (!state || state.action !== 'import_csv') return false;

  const doc = ctx.message?.document;
  if (!doc) return false;

  // Verify it's a CSV or text file
  const fileName = doc.file_name || '';
  const isCsv = fileName.endsWith('.csv') || fileName.endsWith('.txt') || (doc.mime_type && doc.mime_type.includes('text'));
  if (!isCsv) {
    await deleteUserMsg(ctx);
    try {
      await ctx.api.editMessageText(
        ctx.chat.id,
        state.msgId,
        ctx.t('export_import.import_bad_format'),
        { reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'settings') },
      );
    } catch { /* ignore */ }
    return true;
  }

  // Download file content
  const file = await ctx.getFile();
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
  const response = await fetch(url);
  const text = await response.text();

  // Parse CSV
  const medicines = parseCsv(text);

  await deleteUserMsg(ctx);

  if (medicines.length === 0) {
    await clearState(ctx.dbUser.id);
    try {
      await ctx.api.editMessageText(
        ctx.chat.id,
        state.msgId,
        ctx.t('export_import.import_no_medicines'),
        { reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'import') },
      );
    } catch { /* ignore */ }
    return true;
  }

  // Build preview text
  let preview = ctx.t('export_import.import_preview', { count: medicines.length });
  const showCount = Math.min(medicines.length, 10);
  for (let i = 0; i < showCount; i++) {
    const m = medicines[i];
    const parts = [`${i + 1}. *${m.name}*`];
    if (m.dosage) parts.push(m.dosage);
    if (m.category) parts.push(`— ${m.category}`);
    if (m.quantity) parts.push(`— ${m.quantity} ${m.quantityUnit || 'шт'}`);
    preview += parts.join(' ') + '\n';
  }
  if (medicines.length > showCount) {
    preview += ctx.t('export_import.import_more', { count: medicines.length - showCount });
  }
  preview += ctx.t('export_import.import_choose_medkit');

  // Show medkit selection
  const medkits = await getUserMedkits(ctx.dbUser.id);
  const keyboard = new InlineKeyboard();
  for (const mk of medkits) {
    keyboard.text(`📦 ${mk.name}`, `import:confirm:${mk.id}`).row();
  }
  keyboard.text(ctx.t('common.cancel'), 'import:cancel');

  // Store parsed medicines in state
  await setState(ctx.dbUser.id, {
    action: 'import_select_medkit',
    msgId: state.msgId,
    medicines,
  });

  try {
    await ctx.api.editMessageText(ctx.chat.id, state.msgId, preview, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch {
    // If edit fails (e.g. message too old), send new message
    const sent = await ctx.reply(preview, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    await setState(ctx.dbUser.id, {
      action: 'import_select_medkit',
      msgId: sent.message_id,
      medicines,
    });
  }

  return true;
}

/**
 * Register import handlers
 */
export function registerImportHandlers(bot) {
  // Show import menu
  bot.callbackQuery('import', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showImportMenu(ctx);
  });

  // Cancel import
  bot.callbackQuery('import:cancel', async (ctx) => {
    await clearState(ctx.dbUser.id);
    await ctx.answerCallbackQuery(ctx.t('export_import.import_cancelled_toast'));
    await ctx.editMessageText(ctx.t('export_import.import_cancelled'), {
      reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'settings'),
    });
  });

  // Confirm import into selected medkit
  bot.callbackQuery(/^import:confirm:(.+)$/, async (ctx) => {
    const medkitId = ctx.match[1];
    const state = await getState(ctx.dbUser.id);

    if (!state || state.action !== 'import_select_medkit' || !state.medicines) {
      await ctx.answerCallbackQuery(ctx.t('export_import.import_session_expired'));
      await clearState(ctx.dbUser.id);
      return;
    }

    await ctx.answerCallbackQuery();

    const medkits = await getUserMedkits(ctx.dbUser.id);
    const medkit = medkits.find((m) => m.id === medkitId);
    if (!medkit) {
      await ctx.editMessageText(ctx.t('export_import.import_medkit_not_found'), {
        reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'settings'),
      });
      await clearState(ctx.dbUser.id);
      return;
    }

    // Create all medicines
    let created = 0;
    let errors = 0;
    for (const m of state.medicines) {
      try {
        await createMedicine({
          medkitId,
          name: m.name,
          dosage: m.dosage,
          category: m.category,
          expiryDate: m.expiryDate,
          quantity: m.quantity,
          quantityUnit: m.quantityUnit,
          tags: m.tags,
          notes: m.notes,
        });
        created++;
      } catch (err) {
        console.error('Import medicine error:', err);
        errors++;
      }
    }

    await clearState(ctx.dbUser.id);

    let resultText = ctx.t('export_import.import_done', { created, medkit: medkit.name });
    if (errors > 0) {
      resultText += ctx.t('export_import.import_errors', { count: errors });
    }

    await ctx.editMessageText(resultText, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text(ctx.t('export_import.btn_open_medkit'), `medkit:${medkitId}`)
        .row()
        .text(ctx.t('export_import.btn_to_menu'), 'main_menu'),
    });
  });
}
