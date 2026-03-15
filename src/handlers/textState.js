import { InlineKeyboard } from 'grammy';
import { supabase } from '../db/supabase.js';
import { createMedkit, renameMedkit } from '../db/queries/medkits.js';
import { getMedicine, updateMedicine } from '../db/queries/medicines.js';
import { addToShoppingList } from '../db/queries/shoppingList.js';
import { parseDate, formatQuantity } from '../utils/format.js';
import { logAction, logMedicineChange } from '../middleware/logging.js';

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
      `✅ Аптечка *«${text}»* создана!`,
      new InlineKeyboard()
        .text('📦 Открыть', `medkit:${medkit.id}`)
        .text('◀️ К аптечкам', 'medkits')
    );
    return true;
  }

  if (state.action === 'rename_medkit') {
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
    await clearState(ctx.dbUser.id);
    const num = parseFloat(text);
    const med = await getMedicine(state.medId);
    if (!med) return true;

    if (isNaN(num) || num <= 0) {
      await editBotMsg(ctx, msgId,
        '⚠️ Некорректное число.',
        new InlineKeyboard().text('◀️ Назад', `med:${state.medId}`)
      );
      return true;
    }

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
    await clearState(ctx.dbUser.id);
    await addToShoppingList(ctx.dbUser.id, text);
    await editBotMsg(ctx, msgId,
      `✅ *${text}* добавлен в список покупок!`,
      new InlineKeyboard()
        .text('➕ Ещё', 'shop:add')
        .text('🛒 К списку', 'shopping')
    );
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
          '⚠️ Не удалось распознать дату.',
          new InlineKeyboard().text('◀️ Назад', `med:${state.medId}:edit`)
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
          '⚠️ Некорректное число.',
          new InlineKeyboard().text('◀️ Назад', `med:${state.medId}:edit`)
        );
        return true;
      }
      updateData.quantity = num;
      newValue = num;
    }

    await updateMedicine(state.medId, updateData);
    await logMedicineChange(state.medId, ctx.dbUser.id, field, med[field], newValue);
    await editBotMsg(ctx, msgId,
      `✅ Поле обновлено.`,
      new InlineKeyboard().text('◀️ К лекарству', `med:${state.medId}`)
    );
    return true;
  }

  return false;
}
