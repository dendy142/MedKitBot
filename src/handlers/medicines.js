import { InlineKeyboard } from 'grammy';
import { getMedicine, updateMedicine, archiveMedicine, restoreMedicine, toggleFavorite, getArchivedMedicines, createMedicine } from '../db/queries/medicines.js';
import { getMedkit, getUserMedkits } from '../db/queries/medkits.js';
import { formatQuantity, formatExpiry, formatDate, medicineStatusEmoji, daysUntil, progressBar, breadcrumb } from '../utils/format.js';
import { logAction, logMedicineChange } from '../middleware/logging.js';
import { getMedicineHistory } from '../db/queries/actionLogs.js';
import { supabase } from '../db/supabase.js';
import { ensureExists } from '../utils/ensure.js';
import { checkMedkitRole } from '../middleware/checkRole.js';

/**
 * Show medicine card (full view)
 */
async function showMedicineCard(ctx, medicineId) {
  const med = await getMedicine(medicineId);
  // #65 Stale callback guard
  if (!med) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: ctx.t('common.stale_data'), show_alert: true });
    }
    return;
  }

  const settings = ctx.dbUser.settings || {};
  const dateFormat = settings.display?.date_format || 'DD.MM.YYYY';
  const thresholds = settings.thresholds || {};
  const emoji = medicineStatusEmoji(med, thresholds);

  // #17 Status badges
  let badges = '';
  const days = daysUntil(med.expiry_date);
  if (days !== null && days <= 0) {
    badges += '🔴';
  } else if (days !== null && days <= (thresholds.expiry_days || 30)) {
    badges += '🟡';
  }
  const lowCount = thresholds.low_stock_count || 5;
  const lowPercent = thresholds.low_stock_percent || 20;
  if (med.quantity <= lowCount || (med.initial_quantity > 0 && (med.quantity / med.initial_quantity) * 100 <= lowPercent)) {
    badges += '🟠';
  }
  if (med.is_favorite) badges += '⭐';

  // Fetch medkit and schedules in parallel for performance
  const [medkit, { data: schedules }] = await Promise.all([
    getMedkit(med.medkit_id, ctx.dbUser.id),
    supabase
      .from('schedules')
      .select('*')
      .eq('medicine_id', medicineId)
      .eq('status', 'active'),
  ]);

  // #1 Breadcrumb: 🏠 › Medkit Name › Medicine Name
  const crumb = breadcrumb(ctx.t('common.breadcrumb_home'), medkit?.name, med.name);
  let text = `${crumb}\n\n💊 *${med.name}*${med.dosage ? ' ' + med.dosage : ''}${badges ? ' ' + badges : ''}\n`;

  if (med.category) text += `🏷 ${med.category}`;
  if (med.tags && med.tags.length > 0) {
    text += (med.category ? ' | ' : '🏷 ') + med.tags.map(t => `#${t}`).join(' ');
  }
  if (med.category || (med.tags && med.tags.length > 0)) text += '\n';

  text += `${ctx.t('medicine.label_expiry', { value: formatExpiry(med.expiry_date, dateFormat) })}\n`;

  // Quantity with progress bar (#16)
  if (med.initial_quantity > 0) {
    const percent = Math.round((med.quantity / med.initial_quantity) * 100);
    const colorEmoji = percent > 50 ? '🟢' : percent >= 20 ? '🟡' : '🔴';
    text += `${ctx.t('medicine.label_quantity', { value: `${med.quantity}/${med.initial_quantity} ${med.quantity_unit || 'шт'} (${percent}%)` })}\n`;
    text += `${progressBar(med.quantity, med.initial_quantity)} ${colorEmoji}\n`;
  } else {
    text += `${ctx.t('medicine.label_quantity', { value: formatQuantity(med.quantity, med.quantity_unit) })}\n`;
  }

  if (med.notes) text += `${ctx.t('medicine.label_notes', { value: med.notes })}\n`;

  // #19 Linked schedules (already fetched above)
  if (schedules && schedules.length > 0) {
    text += `\n${ctx.t('medicine.label_schedules')}\n`;
    for (const s of schedules) {
      const info = `${s.frequency === 'daily' ? 'Ежедневно' : s.frequency} в ${s.time_value} (${s.dose_per_intake} ${med.quantity_unit || 'шт'})`;
      text += ctx.t('medicine.label_schedule_item', { info }) + '\n';
    }
  }

  // #38 Per-medicine stats (if medicine has active schedules)
  if (schedules && schedules.length > 0) {
    const { data: medLogs } = await supabase
      .from('intake_logs')
      .select('status, planned_at')
      .eq('medicine_id', medicineId)
      .order('planned_at', { ascending: false });

    if (medLogs && medLogs.length > 0) {
      const taken = medLogs.filter(l => l.status === 'taken').length;
      const pct = Math.round(taken / medLogs.length * 100);
      const timezone = ctx.dbUser.timezone || 'Etc/GMT-3';

      // Calculate current streak for this medicine
      const byDate = {};
      for (const log of medLogs) {
        const d = new Date(log.planned_at);
        const dateStr = d.toLocaleDateString('en-CA', { timeZone: timezone });
        if (!byDate[dateStr]) byDate[dateStr] = [];
        byDate[dateStr].push(log);
      }
      const dates = Object.keys(byDate).sort().reverse();

      // Current streak: consecutive all-taken days from most recent backwards
      let currentStreak = 0;
      let currentStreakDone = false;
      // Best streak: longest run of all-taken days
      let bestStreak = 0;
      let runStreak = 0;

      for (const dateStr of dates) {
        const dayLogs = byDate[dateStr];
        const allTaken = dayLogs.every(l => l.status === 'taken');
        const hasPending = dayLogs.some(l => l.status === 'pending');

        if (allTaken && !hasPending) {
          runStreak++;
          if (!currentStreakDone) currentStreak++;
          if (runStreak > bestStreak) bestStreak = runStreak;
        } else if (hasPending && !currentStreakDone) {
          // Skip today if still pending — don't break current streak
          continue;
        } else {
          if (!currentStreakDone) currentStreakDone = true;
          runStreak = 0;
        }
      }

      text += `\n${ctx.t('stats.med_stats', { taken, planned: medLogs.length, pct, streak: currentStreak, best: bestStreak })}\n`;
    }
  }

  // #25 Date added
  text += `\n${ctx.t('medicine.label_added', { date: formatDate(med.created_at, dateFormat) })}`;

  text += `\n${med.is_favorite ? ctx.t('medicine.label_favorite') : ''}`;

  // Keyboard
  const keyboard = new InlineKeyboard();
  keyboard.text(ctx.t('medicine.btn_edit'), `med:${med.id}:edit`);
  // #18 Quick restock buttons
  keyboard.text('+1', `med:${med.id}:restock:1`);
  keyboard.text('+5', `med:${med.id}:restock:5`);
  keyboard.text('+10', `med:${med.id}:restock:10`);
  keyboard.row();
  keyboard.text(ctx.t('medicine.btn_restock_custom'), `med:${med.id}:restock`);
  keyboard.row();
  keyboard.text(ctx.t('medicine.btn_schedule'), `med:${med.id}:schedule`);
  keyboard.text(ctx.t('medicine.btn_copy'), `med:${med.id}:copymove`);
  keyboard.text(med.is_favorite ? '⭐' : '☆', `med:${med.id}:fav`);
  keyboard.row();
  if (med.photo_file_ids && med.photo_file_ids.length > 0) {
    keyboard.text(ctx.t('medicine.btn_photos', { count: med.photo_file_ids.length }), `med:${med.id}:photos`);
  }
  keyboard.text(ctx.t('medicine.btn_history'), `med:${med.id}:history`);
  keyboard.text(ctx.t('profile.btn_notes'), `mednotes:${med.id}`);
  keyboard.row();
  keyboard.text(ctx.t('medicine.btn_shop'), `med:${med.id}:shop`);
  keyboard.text(ctx.t('medicine.btn_archive'), `med:${med.id}:archive`);
  keyboard.row();
  keyboard.text(ctx.t('common.back'), `medkit:${med.medkit_id}`);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

/**
 * Format a datetime as DD.MM.YYYY HH:MM
 */
function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

/**
 * Register all medicine-related callback handlers
 */
export function registerMedicineHandlers(bot) {
  // View medicine card
  bot.callbackQuery(/^med:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMedicineCard(ctx, ctx.match[1]);
  });

  // Toggle favorite
  bot.callbackQuery(/^med:([0-9a-f-]+):fav$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await toggleFavorite(ctx.match[1]);
    await showMedicineCard(ctx, ctx.match[1]);
  });

  // Archive medicine — confirm
  bot.callbackQuery(/^med:([0-9a-f-]+):archive$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const med = await getMedicine(ctx.match[1]);
    if (!med) return;

    await ctx.editMessageText(
      ctx.t('medicine.archive_confirm', { name: med.name }),
      {
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.yes'), `med:${ctx.match[1]}:archive:confirm`)
          .text(ctx.t('common.no'), `med:${ctx.match[1]}`),
      }
    );
  });

  // Archive medicine — confirmed
  bot.callbackQuery(/^med:([0-9a-f-]+):archive:confirm$/, async (ctx) => {
    const med = await getMedicine(ctx.match[1]);
    // #65 Stale callback guard
    if (!await ensureExists(med, ctx)) return;
    // #73 Permission check — need editor role
    if (!await checkMedkitRole(med.medkit_id, ctx.dbUser.id, 'editor')) {
      return ctx.answerCallbackQuery({ text: ctx.t('common.insufficient_rights'), show_alert: true });
    }
    await archiveMedicine(ctx.match[1]);
    await logAction(ctx.dbUser.id, 'archive', 'medicine', ctx.match[1]);
    await ctx.answerCallbackQuery(ctx.t('medicine.archive_toast'));
    // Go back to medkit
    if (med) {
      await ctx.editMessageText(ctx.t('medicine.archive_done'), {
        reply_markup: new InlineKeyboard().text(ctx.t('medkit.btn_to_medkit'), `medkit:${med.medkit_id}`),
      });
    }
  });

  // Quick restock (#18) — must be registered BEFORE custom restock
  bot.callbackQuery(/^med:([0-9a-f-]+):restock:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medId = ctx.match[1];
    const amount = parseInt(ctx.match[2]);
    const med = await getMedicine(medId);
    if (!med) return;
    const oldQty = med.quantity;
    const newQty = oldQty + amount;
    const newInitial = Math.max(med.initial_quantity || 0, newQty);
    await updateMedicine(medId, { quantity: newQty, initial_quantity: newInitial });
    await logMedicineChange(medId, ctx.dbUser.id, 'quantity', oldQty, newQty);

    // #41 Suggest resuming paused schedules when restocking from zero
    if (oldQty <= 0) {
      const { data: pausedScheds } = await supabase
        .from('schedules')
        .select('id, time_value, dose_per_intake')
        .eq('medicine_id', medId)
        .eq('status', 'paused');

      if (pausedScheds && pausedScheds.length > 0) {
        const text = ctx.t('medicine.restock_done', { quantity: formatQuantity(newQty, med.quantity_unit) })
          + '\n\n' + ctx.t('schedule.resume_suggest', { name: med.name, count: pausedScheds.length });
        const keyboard = new InlineKeyboard();
        if (pausedScheds.length === 1) {
          keyboard.text(ctx.t('schedule.btn_resume_yes'), `sched:resume:${pausedScheds[0].id}`);
        } else {
          for (const s of pausedScheds) {
            keyboard.text(`▶️ ${s.time_value} (${s.dose_per_intake})`, `sched:resume:${s.id}`);
          }
          keyboard.row();
          keyboard.text(ctx.t('schedule.btn_resume_all'), `sched:resume_all:${medId}`);
        }
        keyboard.text(ctx.t('schedule.btn_resume_no'), `noop`);
        keyboard.row();
        keyboard.text(ctx.t('medicine.btn_to_medicine'), `med:${medId}`);
        await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
        return;
      }
    }

    await showMedicineCard(ctx, medId);
  });

  // Restock — ask quantity (custom)
  bot.callbackQuery(/^med:([0-9a-f-]+):restock$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await supabase.from('sessions').upsert(
      { key: `state:${ctx.dbUser.id}`, value: { action: 'restock', medId: ctx.match[1], msgId: ctx.callbackQuery.message.message_id }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    const med = await getMedicine(ctx.match[1]);
    if (!med) return;
    await ctx.editMessageText(
      ctx.t('medicine.restock_prompt', { name: med.name, quantity: formatQuantity(med.quantity, med.quantity_unit) }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), `med:${ctx.match[1]}`),
      }
    );
  });

  // Edit medicine — field selection
  bot.callbackQuery(/^med:([0-9a-f-]+):edit$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const med = await getMedicine(ctx.match[1]);
    // #65 Stale callback guard
    if (!await ensureExists(med, ctx)) return;
    // #73 Permission check — need editor role
    if (!await checkMedkitRole(med.medkit_id, ctx.dbUser.id, 'editor')) {
      return ctx.answerCallbackQuery({ text: ctx.t('common.insufficient_rights'), show_alert: true });
    }

    await ctx.editMessageText(
      ctx.t('medicine.edit_title', { name: med.name }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('medicine.field_name'), `med:${med.id}:edit:name`)
          .text(ctx.t('medicine.field_dosage'), `med:${med.id}:edit:dosage`)
          .row()
          .text(ctx.t('medicine.field_category'), `med:${med.id}:edit:category`)
          .text(ctx.t('medicine.field_expiry'), `med:${med.id}:edit:expiry`)
          .row()
          .text(ctx.t('medicine.field_quantity'), `med:${med.id}:edit:quantity`)
          .text(ctx.t('medicine.field_notes'), `med:${med.id}:edit:notes`)
          .row()
          .text(ctx.t('medicine.field_tags'), `med:${med.id}:edit:tags`)
          .row()
          .text(ctx.t('common.back'), `med:${med.id}`),
      }
    );
  });

  // Edit field — prompt for value
  bot.callbackQuery(/^med:([0-9a-f-]+):edit:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medId = ctx.match[1];
    const field = ctx.match[2];
    await supabase.from('sessions').upsert(
      { key: `state:${ctx.dbUser.id}`, value: { action: 'edit_medicine', medId, field, msgId: ctx.callbackQuery.message.message_id }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );

    const fieldLabel = ctx.t(`medicine.field_acc_${field}`) || field;

    await ctx.editMessageText(
      ctx.t('medicine.edit_prompt', { field: fieldLabel }),
      {
        reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), `med:${medId}:edit`),
      }
    );
  });

  // Show photos
  bot.callbackQuery(/^med:([0-9a-f-]+):photos$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const med = await getMedicine(ctx.match[1]);
    if (!med || !med.photo_file_ids || med.photo_file_ids.length === 0) return;

    for (const fileId of med.photo_file_ids) {
      await ctx.replyWithPhoto(fileId);
    }
    await ctx.reply(ctx.t('medicine.photos_title'), {
      reply_markup: new InlineKeyboard().text(ctx.t('common.back'), `med:${med.id}`),
    });
  });

  // Medicine history
  bot.callbackQuery(/^med:([0-9a-f-]+):history$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medId = ctx.match[1];
    const med = await getMedicine(medId);
    if (!med) return;

    const history = await getMedicineHistory(medId);

    let text = ctx.t('medicine.history_title', { name: med.name });

    if (history.length === 0) {
      text += ctx.t('medicine.history_empty');
    } else {
      for (const entry of history) {
        const dateStr = formatDateTime(entry.changed_at);
        const username = entry.users?.username ? `@${entry.users.username}` : (entry.users?.first_name || ctx.t('medicine.history_user'));
        text += `${dateStr} — ${username}\n`;

        const fieldLabel = ctx.t(`medicine.field_${entry.field_name}`) || entry.field_name;
        const oldVal = entry.old_value === null || entry.old_value === '' ? ctx.t('medicine.history_empty_value') : `«${entry.old_value}»`;
        const newVal = entry.new_value === null || entry.new_value === '' ? ctx.t('medicine.history_empty_value') : `«${entry.new_value}»`;
        text += `  ${fieldLabel}: ${oldVal} → ${newVal}\n\n`;
      }
    }

    const keyboard = new InlineKeyboard()
      .text(ctx.t('common.back'), `med:${medId}`);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  // Copy/Move menu
  bot.callbackQuery(/^med:([0-9a-f-]+):copymove$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medId = ctx.match[1];

    const keyboard = new InlineKeyboard()
      .text(ctx.t('medicine.btn_copy_action'), `med:${medId}:copy`)
      .text(ctx.t('medicine.btn_move_action'), `med:${medId}:move`)
      .row()
      .text(ctx.t('common.back'), `med:${medId}`);

    await ctx.editMessageText(
      ctx.t('medicine.copymove_title'),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  });

  // Copy — show target medkits
  bot.callbackQuery(/^med:([0-9a-f-]+):copy$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medId = ctx.match[1];
    const med = await getMedicine(medId);
    if (!med) return;

    const medkits = await getUserMedkits(ctx.dbUser.id);
    const otherMedkits = medkits.filter(mk => mk.id !== med.medkit_id);

    if (otherMedkits.length === 0) {
      await ctx.editMessageText(
        ctx.t('medicine.copy_no_medkits'),
        { reply_markup: new InlineKeyboard().text(ctx.t('common.back'), `med:${medId}:copymove`) }
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const mk of otherMedkits) {
      keyboard.text(mk.name, `med:${medId}:copy:${mk.id}`).row();
    }
    keyboard.text(ctx.t('common.back'), `med:${medId}:copymove`);

    await ctx.editMessageText(
      ctx.t('medicine.copy_title', { name: med.name }),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  });

  // Copy — execute
  bot.callbackQuery(/^med:([0-9a-f-]+):copy:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medId = ctx.match[1];
    const targetMedkitId = ctx.match[2];
    const med = await getMedicine(medId);
    if (!med) return;

    const targetMedkit = await getMedkit(targetMedkitId, ctx.dbUser.id);
    if (!targetMedkit) return;

    await createMedicine({
      medkitId: targetMedkitId,
      name: med.name,
      dosage: med.dosage,
      category: med.category,
      tags: med.tags,
      expiryDate: med.expiry_date,
      quantity: med.quantity,
      quantityUnit: med.quantity_unit,
      photoFileIds: med.photo_file_ids,
      notes: med.notes,
    });

    await ctx.editMessageText(
      ctx.t('medicine.copy_done', { name: med.name, target: targetMedkit.name }),
      {
        reply_markup: new InlineKeyboard()
          .text(ctx.t('medicine.btn_to_medicine'), `med:${medId}`)
          .text(ctx.t('medkit.btn_to_medkit'), `medkit:${targetMedkitId}`),
      }
    );
  });

  // Move — show target medkits
  bot.callbackQuery(/^med:([0-9a-f-]+):move$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medId = ctx.match[1];
    const med = await getMedicine(medId);
    if (!med) return;

    const medkits = await getUserMedkits(ctx.dbUser.id);
    const otherMedkits = medkits.filter(mk => mk.id !== med.medkit_id);

    if (otherMedkits.length === 0) {
      await ctx.editMessageText(
        ctx.t('medicine.move_no_medkits'),
        { reply_markup: new InlineKeyboard().text(ctx.t('common.back'), `med:${medId}:copymove`) }
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const mk of otherMedkits) {
      keyboard.text(mk.name, `med:${medId}:move:${mk.id}`).row();
    }
    keyboard.text(ctx.t('common.back'), `med:${medId}:copymove`);

    await ctx.editMessageText(
      ctx.t('medicine.move_title', { name: med.name }),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  });

  // Move — execute
  bot.callbackQuery(/^med:([0-9a-f-]+):move:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medId = ctx.match[1];
    const targetMedkitId = ctx.match[2];
    const med = await getMedicine(medId);
    if (!med) return;

    const sourceMedkitId = med.medkit_id;
    const targetMedkit = await getMedkit(targetMedkitId, ctx.dbUser.id);
    if (!targetMedkit) return;

    await updateMedicine(medId, { medkit_id: targetMedkitId });

    await ctx.editMessageText(
      ctx.t('medicine.move_done', { name: med.name, target: targetMedkit.name }),
      {
        reply_markup: new InlineKeyboard()
          .text(ctx.t('medicine.btn_to_medicine'), `med:${medId}`)
          .text(ctx.t('medkit.btn_to_medkit'), `medkit:${targetMedkitId}`),
      }
    );
  });

  // View archived medicines
  bot.callbackQuery(/^medkit:([0-9a-f-]+):archive$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const archived = await getArchivedMedicines(ctx.match[1]);

    if (archived.length === 0) {
      await ctx.editMessageText(ctx.t('medicine.archive_empty'), {
        reply_markup: new InlineKeyboard().text(ctx.t('common.back'), `medkit:${ctx.match[1]}`),
      });
      return;
    }

    let text = ctx.t('medicine.archive_title');
    const keyboard = new InlineKeyboard();

    for (const med of archived) {
      text += `🗑 ${med.name}${med.dosage ? ' ' + med.dosage : ''}\n`;
      keyboard
        .text(`♻️ ${med.name}`, `med:${med.id}:restore`)
        .text('🗑', `med:${med.id}:permdelete`)
        .row();
    }

    keyboard.text(ctx.t('common.back'), `medkit:${ctx.match[1]}`);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  // Permanent delete — confirm
  bot.callbackQuery(/^med:([0-9a-f-]+):permdelete$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medId = ctx.match[1];
    const med = await getMedicine(medId);
    if (!med) return;

    await ctx.editMessageText(
      ctx.t('medicine.delete_confirm', { name: med.name }),
      {
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.yes_delete'), `med:${medId}:permdelete:confirm`)
          .text(ctx.t('common.no'), `medkit:${med.medkit_id}:archive`),
      }
    );
  });

  // Permanent delete — confirmed
  bot.callbackQuery(/^med:([0-9a-f-]+):permdelete:confirm$/, async (ctx) => {
    const medId = ctx.match[1];
    const med = await getMedicine(medId);

    await supabase.from('medicines').delete().eq('id', medId);
    await logAction(ctx.dbUser.id, 'permanent_delete', 'medicine', medId);
    await ctx.answerCallbackQuery(ctx.t('medicine.delete_toast'));

    if (med) {
      await ctx.editMessageText(ctx.t('medicine.delete_done'), {
        reply_markup: new InlineKeyboard().text(ctx.t('medicine.btn_to_archive'), `medkit:${med.medkit_id}:archive`),
      });
    }
  });

  // Restore from archive
  bot.callbackQuery(/^med:([0-9a-f-]+):restore$/, async (ctx) => {
    const med = await getMedicine(ctx.match[1]);
    await restoreMedicine(ctx.match[1]);
    await logAction(ctx.dbUser.id, 'restore', 'medicine', ctx.match[1]);
    await ctx.answerCallbackQuery(ctx.t('medicine.restore_toast'));
    if (med) {
      await ctx.editMessageText(ctx.t('medicine.restore_done'), {
        reply_markup: new InlineKeyboard().text(ctx.t('medkit.btn_to_medkit'), `medkit:${med.medkit_id}`),
      });
    }
  });

  // Schedule handler is registered in schedules.js (registerScheduleHandlers)
}
