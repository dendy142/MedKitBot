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

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

async function getState(userId) {
  const { data } = await supabase
    .from('sessions')
    .select('value, updated_at')
    .eq('key', `state:${userId}`)
    .single();
  if (!data?.value) return null;
  // P2.7: Auto-clear stale sessions
  if (data.updated_at && (Date.now() - new Date(data.updated_at).getTime()) > SESSION_TTL_MS) {
    await clearState(userId);
    return null;
  }
  return data.value;
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

  // P0.4: Clear any conflicting addmed session when processing state-based input
  await supabase.from('sessions').delete().eq('key', `addmed:${ctx.dbUser.id}`);

  await deleteUserMsg(ctx);
  const msgId = state.msgId;

  if (state.action === 'create_medkit') {
    // P0.3: Validate medkit name length
    if (text.length > 50) {
      await editBotMsg(ctx, msgId,
        '⚠️ Слишком длинное название (макс. 50 символов). Попробуйте ещё раз:',
        new InlineKeyboard().text('❌ Отмена', 'medkits')
      );
      return true;
    }
    await clearState(ctx.dbUser.id);
    const medkit = await createMedkit(text, ctx.dbUser.id);
    await logAction(ctx.dbUser.id, 'create', 'medkit', medkit.id, { name: text });
    await editBotMsg(ctx, msgId,
      `✅ Аптечка *«${text}»* создана!`,
      new InlineKeyboard()
        .text('📦 Открыть', `medkit:${medkit.id}`)
        .text('◀️ К аптечкам', 'medkits')
    );
    return true;
  }

  if (state.action === 'rename_medkit') {
    // P0.3: Validate medkit name length
    if (text.length > 50) {
      await editBotMsg(ctx, msgId,
        '⚠️ Слишком длинное название (макс. 50 символов). Попробуйте ещё раз:',
        new InlineKeyboard().text('❌ Отмена', `medkit:${state.medkitId}`)
      );
      return true;
    }
    await clearState(ctx.dbUser.id);
    await renameMedkit(state.medkitId, text);
    await logAction(ctx.dbUser.id, 'rename', 'medkit', state.medkitId, { name: text });
    await editBotMsg(ctx, msgId,
      `✅ Аптечка переименована в *«${text}»*`,
      new InlineKeyboard().text('◀️ К аптечке', `medkit:${state.medkitId}`)
    );
    return true;
  }

  if (state.action === 'restock') {
    const num = parseFloat(text);
    const med = await getMedicine(state.medId);
    if (!med) { await clearState(ctx.dbUser.id); return true; }

    // P0.1: Validate BEFORE clearing state so user can retry
    if (isNaN(num) || num <= 0) {
      await editBotMsg(ctx, msgId,
        '⚠️ Введите положительное число. Попробуйте ещё раз:',
        new InlineKeyboard()
          .text('+1', `med:${state.medId}:restock:1`)
          .text('+5', `med:${state.medId}:restock:5`)
          .text('+10', `med:${state.medId}:restock:10`)
          .row()
          .text('❌ Отмена', `med:${state.medId}`)
      );
      return true;
    }

    await clearState(ctx.dbUser.id);
    const newQty = med.quantity + num;
    await updateMedicine(state.medId, { quantity: newQty });
    await logMedicineChange(state.medId, ctx.dbUser.id, 'quantity', med.quantity, newQty);
    await editBotMsg(ctx, msgId,
      `✅ Остаток пополнен: ${formatQuantity(newQty, med.quantity_unit)}`,
      new InlineKeyboard().text('◀️ К лекарству', `med:${state.medId}`)
    );
    return true;
  }

  if (state.action === 'shop_add') {
    // P2.1: Validate shopping item name length
    if (text.length > 100) {
      await editBotMsg(ctx, msgId,
        '⚠️ Слишком длинное название (макс. 100 символов). Попробуйте ещё раз:',
        new InlineKeyboard().text('❌ Отмена', 'shopping')
      );
      return true;
    }
    await clearState(ctx.dbUser.id);
    await addToShoppingList(ctx.dbUser.id, text);
    await editBotMsg(ctx, msgId,
      `✅ *${text}* — добавлено в список покупок!`,
      new InlineKeyboard()
        .text('➕ Ещё', 'shop:add')
        .text('🛒 К списку', 'shopping')
    );
    return true;
  }

  if (state.action === 'share_username') {
    await clearState(ctx.dbUser.id);
    await handleShareText(ctx, state);
    return true;
  }

  if (state.action === 'edit_medicine') {
    const med = await getMedicine(state.medId);
    if (!med) { await clearState(ctx.dbUser.id); return true; }

    const field = state.field;
    let updateData = {};
    let newValue = text;

    // P2.1: Validate field lengths
    if (field === 'name') {
      if (text.length > 100) {
        await editBotMsg(ctx, msgId, '⚠️ Слишком длинное название (макс. 100 символов). Попробуйте ещё раз:',
          new InlineKeyboard().text('❌ Отмена', `med:${state.medId}:edit`));
        return true;
      }
      updateData.name = text;
    }
    else if (field === 'dosage') {
      if (text.length > 50) {
        await editBotMsg(ctx, msgId, '⚠️ Слишком длинная дозировка (макс. 50 символов). Попробуйте ещё раз:',
          new InlineKeyboard().text('❌ Отмена', `med:${state.medId}:edit`));
        return true;
      }
      updateData.dosage = text;
    }
    else if (field === 'category') {
      if (text.length > 50) {
        await editBotMsg(ctx, msgId, '⚠️ Слишком длинная категория (макс. 50 символов). Попробуйте ещё раз:',
          new InlineKeyboard().text('❌ Отмена', `med:${state.medId}:edit`));
        return true;
      }
      updateData.category = text;
    }
    else if (field === 'notes') {
      if (text.length > 500) {
        await editBotMsg(ctx, msgId, '⚠️ Слишком длинная заметка (макс. 500 символов). Попробуйте ещё раз:',
          new InlineKeyboard().text('❌ Отмена', `med:${state.medId}:edit`));
        return true;
      }
      updateData.notes = text;
    }
    else if (field === 'tags') {
      // P2.4: Deduplicate tags
      updateData.tags = text.split(',').map(t => t.trim()).filter((t, i, arr) => t.length > 0 && arr.indexOf(t) === i);
      if (updateData.tags.length > 10) {
        await editBotMsg(ctx, msgId, '⚠️ Слишком много тегов (макс. 10). Попробуйте ещё раз:',
          new InlineKeyboard().text('❌ Отмена', `med:${state.medId}:edit`));
        return true;
      }
      newValue = updateData.tags;
    }
    else if (field === 'expiry') {
      const parsed = parseDate(text);
      // P0.1: Don't clear state on validation failure — user can retry
      if (!parsed) {
        await editBotMsg(ctx, msgId,
          '⚠️ Не удалось распознать дату. Введите в формате ДД.ММ.ГГГГ или ММ.ГГГГ:',
          new InlineKeyboard().text('❌ Отмена', `med:${state.medId}:edit`)
        );
        return true;
      }
      updateData.expiry_date = parsed.toISOString().split('T')[0];
      newValue = updateData.expiry_date;
    }
    else if (field === 'quantity') {
      const num = parseFloat(text);
      // P0.1: Don't clear state on validation failure — user can retry
      if (isNaN(num) || num < 0) {
        await editBotMsg(ctx, msgId,
          '⚠️ Введите число ≥ 0. Попробуйте ещё раз:',
          new InlineKeyboard().text('❌ Отмена', `med:${state.medId}:edit`)
        );
        return true;
      }
      updateData.quantity = num;
      newValue = num;
    }

    // Clear state only after successful validation
    await clearState(ctx.dbUser.id);
    await updateMedicine(state.medId, updateData);
    await logMedicineChange(state.medId, ctx.dbUser.id, field, med[field], newValue);
    await editBotMsg(ctx, msgId,
      `✅ Поле обновлено.`,
      new InlineKeyboard().text('◀️ К лекарству', `med:${state.medId}`)
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
      // markIntakeTaken handles both pending→taken and updating note on already-taken
      await markIntakeTaken(state.logId, text);
      await editBotMsg(ctx, msgId,
        `✅ Приём отмечен с заметкой: _${text}_`,
        new InlineKeyboard().text('💊 К приёмам', 'intake_today').text('🏠 Меню', 'main_menu')
      );
    } catch (e) {
      console.error('Error adding intake note:', e);
      await editBotMsg(ctx, msgId,
        '❌ Ошибка при сохранении заметки.',
        new InlineKeyboard().text('💊 К приёмам', 'intake_today')
      );
    }
    return true;
  }

  // Settings text states (day periods, digest time)
  if (state.action === 'set_period' || state.action === 'set_digest_time') {
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
