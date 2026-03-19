import { InlineKeyboard } from 'grammy';
import { supabase } from '../db/supabase.js';
import { createMedkit, renameMedkit } from '../db/queries/medkits.js';
import { getMedicine, updateMedicine } from '../db/queries/medicines.js';
import { addToShoppingList } from '../db/queries/shoppingList.js';
import { parseDate, formatQuantity } from '../utils/format.js';
import { logAction, logMedicineChange } from '../middleware/logging.js';
import { handleShareText } from './sharing.js';
import { handleScheduleText } from './schedules.js';
import { markIntakeTaken } from '../db/queries/intakeLogs.js';
import { handleSettingsTextState } from './settings.js';

async function getState(userId) {
  const { data } = await supabase
    .from('sessions')
    .select('value')
    .eq('key', `state:${userId}`)
    .single();
  return data?.value ?? null;
}

async function clearState(userId) {
  await supabase.from('sessions').delete().eq('key', `state:${userId}`);
}

async function deleteUserMsg(ctx) {
  try { await ctx.deleteMessage(); } catch { /* ignore */ }
}

async function editBotMsg(ctx, msgId, text, keyboard) {
  if (msgId) {
    await ctx.api.editMessageText(ctx.chat.id, msgId, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

/**
 * Handle text input for pending states (create medkit, rename, restock, edit field)
 */
export async function handleTextState(ctx) {
  const state = await getState(ctx.dbUser.id);
  if (!state) return false;

  const text = ctx.message.text.trim();
  if (!text || text.startsWith('/')) return false;

  await deleteUserMsg(ctx);
  const msgId = state.msgId;

  if (state.action === 'create_medkit') {
    await clearState(ctx.dbUser.id);
    const medkit = await createMedkit(text, ctx.dbUser.id);
    await logAction(ctx.dbUser.id, 'create', 'medkit', medkit.id, { name: text });
    await editBotMsg(ctx, msgId,
      ctx.t('medkit.created', { name: text }),
      new InlineKeyboard()
        .text(ctx.t('common.open'), `medkit:${medkit.id}`)
        .text(ctx.t('medkit.btn_to_medkits'), 'medkits')
    );
    return true;
  }

  if (state.action === 'rename_medkit') {
    await clearState(ctx.dbUser.id);
    await renameMedkit(state.medkitId, text);
    await logAction(ctx.dbUser.id, 'rename', 'medkit', state.medkitId, { name: text });
    await editBotMsg(ctx, msgId,
      ctx.t('medkit.renamed', { name: text }),
      new InlineKeyboard().text(ctx.t('medkit.btn_to_medkit'), `medkit:${state.medkitId}`)
    );
    return true;
  }

  if (state.action === 'restock') {
    await clearState(ctx.dbUser.id);
    const num = parseFloat(text);
    const med = await getMedicine(state.medId);
    if (!med) return true;

    if (isNaN(num) || num <= 0) {
      await editBotMsg(ctx, msgId,
        ctx.t('medicine.restock_invalid'),
        new InlineKeyboard().text(ctx.t('common.back'), `med:${state.medId}`)
      );
      return true;
    }

    const oldQty = med.quantity;
    const newQty = oldQty + num;
    await updateMedicine(state.medId, { quantity: newQty });
    await logMedicineChange(state.medId, ctx.dbUser.id, 'quantity', oldQty, newQty);

    const keyboard = new InlineKeyboard();
    let responseText = ctx.t('medicine.restock_done', { quantity: formatQuantity(newQty, med.quantity_unit) });

    // #41 Suggest resuming paused schedules when restocking from zero
    if (oldQty <= 0) {
      const { data: pausedScheds } = await supabase
        .from('schedules')
        .select('id, time_value, dose_per_intake')
        .eq('medicine_id', state.medId)
        .eq('status', 'paused');

      if (pausedScheds && pausedScheds.length > 0) {
        responseText += '\n\n' + ctx.t('schedule.resume_suggest', { name: med.name, count: pausedScheds.length });
        if (pausedScheds.length === 1) {
          keyboard.text(ctx.t('schedule.btn_resume_yes'), `sched:resume:${pausedScheds[0].id}`);
        } else {
          for (const s of pausedScheds) {
            keyboard.text(`▶️ ${s.time_value} (${s.dose_per_intake})`, `sched:resume:${s.id}`);
          }
          keyboard.row();
          keyboard.text(ctx.t('schedule.btn_resume_all'), `sched:resume_all:${state.medId}`);
        }
        keyboard.text(ctx.t('schedule.btn_resume_no'), `noop`);
        keyboard.row();
      }
    }

    keyboard.text(ctx.t('medicine.btn_to_medicine'), `med:${state.medId}`);

    await editBotMsg(ctx, msgId, responseText, keyboard);
    return true;
  }

  if (state.action === 'shop_add') {
    await clearState(ctx.dbUser.id);
    await addToShoppingList(ctx.dbUser.id, text);
    await editBotMsg(ctx, msgId,
      ctx.t('medicine.added_to_shop', { name: text }),
      new InlineKeyboard()
        .text(ctx.t('common.add_more'), 'shop:add')
        .text(ctx.t('medicine.btn_to_shop'), 'shopping')
    );
    return true;
  }

  if (state.action === 'share_username') {
    await clearState(ctx.dbUser.id);
    await handleShareText(ctx, state);
    return true;
  }

  if (state.action === 'edit_medicine') {
    await clearState(ctx.dbUser.id);
    const med = await getMedicine(state.medId);
    if (!med) return true;

    const field = state.field;
    let updateData = {};
    let newValue = text;

    if (field === 'name') updateData.name = text;
    else if (field === 'dosage') updateData.dosage = text;
    else if (field === 'category') updateData.category = text;
    else if (field === 'notes') updateData.notes = text;
    else if (field === 'tags') {
      updateData.tags = text.split(',').map(t => t.trim()).filter(t => t.length > 0);
      newValue = updateData.tags;
    }
    else if (field === 'expiry') {
      const parsed = parseDate(text);
      if (!parsed) {
        await editBotMsg(ctx, msgId,
          ctx.t('addmed.invalid_date'),
          new InlineKeyboard().text(ctx.t('common.back'), `med:${state.medId}:edit`)
        );
        return true;
      }
      updateData.expiry_date = parsed.toISOString().split('T')[0];
      newValue = updateData.expiry_date;
    }
    else if (field === 'quantity') {
      const num = parseFloat(text);
      if (isNaN(num) || num < 0) {
        await editBotMsg(ctx, msgId,
          ctx.t('medicine.restock_invalid'),
          new InlineKeyboard().text(ctx.t('common.back'), `med:${state.medId}:edit`)
        );
        return true;
      }
      updateData.quantity = num;
      newValue = num;
    }

    await updateMedicine(state.medId, updateData);
    await logMedicineChange(state.medId, ctx.dbUser.id, field, med[field], newValue);

    // #28 Auto-add to shopping list when quantity is edited to low stock
    if (field === 'quantity') {
      const settings = ctx.dbUser?.settings || {};
      if (settings.autoShoppingList) {
        const thresholds = settings.thresholds || {};
        const lowCount = thresholds.low_stock_count || 5;
        const lowPercent = thresholds.low_stock_percent || 20;
        const isLow = updateData.quantity <= lowCount || (med.initial_quantity > 0 && (updateData.quantity / med.initial_quantity) * 100 <= lowPercent);
        if (isLow) {
          const { data: existing } = await supabase
            .from('shopping_list')
            .select('id')
            .eq('medicine_id', state.medId)
            .eq('is_bought', false)
            .limit(1);
          if (!existing || existing.length === 0) {
            await addToShoppingList(ctx.dbUser.id, med.name, med.id, med.medkit_id);
          }
        }
      }
    }

    // #40 Auto-pause active schedules when quantity is edited to zero
    if (field === 'quantity' && updateData.quantity <= 0) {
      const { data: activeScheds } = await supabase
        .from('schedules')
        .select('id')
        .eq('medicine_id', state.medId)
        .eq('status', 'active');
      if (activeScheds && activeScheds.length > 0) {
        await supabase
          .from('schedules')
          .update({ status: 'paused' })
          .in('id', activeScheds.map(s => s.id));
        await editBotMsg(ctx, msgId,
          ctx.t('medicine.edit_done') + '\n\n' + ctx.t('schedule.auto_pause', { name: med.name, count: activeScheds.length }),
          new InlineKeyboard().text(ctx.t('medicine.btn_to_medicine'), `med:${state.medId}`)
        );
        return true;
      }
    }

    // #41 Suggest resuming paused schedules when quantity is edited from zero to positive
    if (field === 'quantity' && med.quantity <= 0 && updateData.quantity > 0) {
      const { data: pausedScheds } = await supabase
        .from('schedules')
        .select('id, time_value, dose_per_intake')
        .eq('medicine_id', state.medId)
        .eq('status', 'paused');
      if (pausedScheds && pausedScheds.length > 0) {
        const responseText = ctx.t('medicine.edit_done') + '\n\n' + ctx.t('schedule.resume_suggest', { name: med.name, count: pausedScheds.length });
        const keyboard = new InlineKeyboard();
        if (pausedScheds.length === 1) {
          keyboard.text(ctx.t('schedule.btn_resume_yes'), `sched:resume:${pausedScheds[0].id}`);
        } else {
          for (const s of pausedScheds) {
            keyboard.text(`▶️ ${s.time_value} (${s.dose_per_intake})`, `sched:resume:${s.id}`);
          }
          keyboard.row();
          keyboard.text(ctx.t('schedule.btn_resume_all'), `sched:resume_all:${state.medId}`);
        }
        keyboard.text(ctx.t('schedule.btn_resume_no'), `noop`);
        keyboard.row();
        keyboard.text(ctx.t('medicine.btn_to_medicine'), `med:${state.medId}`);
        await editBotMsg(ctx, msgId, responseText, keyboard);
        return true;
      }
    }

    await editBotMsg(ctx, msgId,
      ctx.t('medicine.edit_done'),
      new InlineKeyboard().text(ctx.t('medicine.btn_to_medicine'), `med:${state.medId}`)
    );
    return true;
  }

  // Schedule creation wizard (time, dose, days, date input)
  if (state.action === 'create_schedule') {
    // Re-add deleted message context for the handler
    const handled = await handleScheduleText(ctx);
    return handled;
  }

  // Intake note
  if (state.action === 'intake_note') {
    await clearState(ctx.dbUser.id);
    try {
      await markIntakeTaken(state.logId, text);
      await editBotMsg(ctx, msgId,
        ctx.t('intake.note_saved', { text: text }),
        new InlineKeyboard().text(ctx.t('intake.btn_today'), 'intake_today').text(ctx.t('common.main_menu'), 'main_menu')
      );
    } catch (e) {
      console.error('Error adding intake note:', e);
      await editBotMsg(ctx, msgId,
        ctx.t('common.error'),
        new InlineKeyboard().text(ctx.t('intake.btn_today'), 'intake_today')
      );
    }
    return true;
  }

  // Settings text states (day periods, digest time, quiet hours)
  if (state.action === 'set_period' || state.action === 'set_digest_time' || state.action === 'set_quiet_from' || state.action === 'set_quiet_to') {
    const result = await handleSettingsTextState(state, text, ctx);
    if (result === 'keep_state') {
      // Don't clear state — user needs to retry
      return true;
    }
    if (result === 'handled') {
      await clearState(ctx.dbUser.id);
      return true;
    }
  }

  return false;
}
