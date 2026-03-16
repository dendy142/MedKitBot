import { InlineKeyboard } from 'grammy';
import { getMedicine, updateMedicine, archiveMedicine, restoreMedicine, toggleFavorite, getArchivedMedicines, createMedicine } from '../db/queries/medicines.js';
import { getMedkit, getUserMedkits } from '../db/queries/medkits.js';
import { formatQuantity, formatExpiry, formatDate, medicineStatusEmoji, daysUntil } from '../utils/format.js';
import { logAction, logMedicineChange } from '../middleware/logging.js';
import { getMedicineHistory } from '../db/queries/actionLogs.js';
import { supabase } from '../db/supabase.js';

/**
 * Show medicine card (full view)
 */
async function showMedicineCard(ctx, medicineId) {
  const med = await getMedicine(medicineId);
  if (!med) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery('Лекарство не найдено');
    return;
  }

  const settings = ctx.dbUser.settings || {};
  const dateFormat = settings.display?.date_format || 'DD.MM.YYYY';
  const emoji = medicineStatusEmoji(med, settings.thresholds);

  let text = `💊 *${med.name}*${med.dosage ? ' ' + med.dosage : ''}\n`;

  if (med.category) text += `🏷 ${med.category}`;
  if (med.tags && med.tags.length > 0) {
    text += (med.category ? ' | ' : '🏷 ') + med.tags.map(t => `#${t}`).join(' ');
  }
  if (med.category || (med.tags && med.tags.length > 0)) text += '\n';

  text += `📅 Срок: ${formatExpiry(med.expiry_date, dateFormat)}\n`;

  // Quantity with progress
  const qty = formatQuantity(med.quantity, med.quantity_unit);
  if (med.initial_quantity > 0) {
    const percent = Math.round((med.quantity / med.initial_quantity) * 100);
    text += `📏 Остаток: ${med.quantity}/${med.initial_quantity} ${med.quantity_unit} (${percent}%)\n`;
  } else {
    text += `📏 Остаток: ${qty}\n`;
  }

  if (med.notes) text += `📝 ${med.notes}\n`;

  if (med.is_favorite) text += `\n⭐ В избранном`;

  // Keyboard
  const keyboard = new InlineKeyboard();
  keyboard.text('✏️ Изменить', `med:${med.id}:edit`);
  keyboard.text('➕ Пополнить', `med:${med.id}:restock`);
  keyboard.row();
  keyboard.text('📆 Приём', `med:${med.id}:schedule`);
  keyboard.text('📋 Копировать', `med:${med.id}:copymove`);
  keyboard.text(med.is_favorite ? '⭐' : '☆', `med:${med.id}:fav`);
  keyboard.row();
  if (med.photo_file_ids && med.photo_file_ids.length > 0) {
    keyboard.text(`📷 Фото (${med.photo_file_ids.length})`, `med:${med.id}:photos`);
  }
  keyboard.text('📋 История', `med:${med.id}:history`);
  keyboard.row();
  keyboard.text('🛒 В покупки', `med:${med.id}:shop`);
  keyboard.text('🗑 В архив', `med:${med.id}:archive`);
  keyboard.row();
  keyboard.text('◀️ Назад', `medkit:${med.medkit_id}`);

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
 * Field name mapping for history display
 */
const FIELD_LABELS = {
  name: 'Название',
  dosage: 'Дозировка',
  category: 'Категория',
  quantity: 'Количество',
  notes: 'Заметки',
  tags: 'Теги',
  expiry_date: 'Срок годности',
};

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
      `🗑 Переместить «${med.name}» в архив?`,
      {
        reply_markup: new InlineKeyboard()
          .text('✅ Да', `med:${ctx.match[1]}:archive:confirm`)
          .text('❌ Нет', `med:${ctx.match[1]}`),
      }
    );
  });

  // Archive medicine — confirmed
  bot.callbackQuery(/^med:([0-9a-f-]+):archive:confirm$/, async (ctx) => {
    const med = await getMedicine(ctx.match[1]);
    await archiveMedicine(ctx.match[1]);
    await logAction(ctx.dbUser.id, 'archive', 'medicine', ctx.match[1]);
    await ctx.answerCallbackQuery('Перемещено в архив');
    // Go back to medkit
    if (med) {
      await ctx.editMessageText('✅ Лекарство перемещено в архив.', {
        reply_markup: new InlineKeyboard().text('◀️ К аптечке', `medkit:${med.medkit_id}`),
      });
    }
  });

  // Restock — ask quantity
  bot.callbackQuery(/^med:([0-9a-f-]+):restock$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await supabase.from('sessions').upsert(
      { key: `state:${ctx.dbUser.id}`, value: { action: 'restock', medId: ctx.match[1], msgId: ctx.callbackQuery.message.message_id }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    const med = await getMedicine(ctx.match[1]);
    if (!med) return;
    await ctx.editMessageText(
      `➕ *Пополнение: ${med.name}*\n\nТекущий остаток: ${formatQuantity(med.quantity, med.quantity_unit)}\n\nВведите количество для добавления:`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('❌ Отмена', `med:${ctx.match[1]}`),
      }
    );
  });

  // Edit medicine — field selection
  bot.callbackQuery(/^med:([0-9a-f-]+):edit$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const med = await getMedicine(ctx.match[1]);
    if (!med) return;

    await ctx.editMessageText(
      `✏️ *Редактирование: ${med.name}*\n\nЧто изменить?`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('Название', `med:${med.id}:edit:name`)
          .text('Дозировка', `med:${med.id}:edit:dosage`)
          .row()
          .text('Категория', `med:${med.id}:edit:category`)
          .text('Срок годн.', `med:${med.id}:edit:expiry`)
          .row()
          .text('Количество', `med:${med.id}:edit:quantity`)
          .text('Заметки', `med:${med.id}:edit:notes`)
          .row()
          .text('Теги', `med:${med.id}:edit:tags`)
          .row()
          .text('◀️ Назад', `med:${med.id}`),
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

    const fieldLabels = {
      name: 'название',
      dosage: 'дозировку',
      category: 'категорию',
      expiry: 'срок годности (ДД.ММ.ГГГГ или ММ.ГГГГ)',
      quantity: 'количество',
      notes: 'заметки',
      tags: 'теги (через запятую)',
    };

    await ctx.editMessageText(
      `✏️ Введите новое значение для поля «${fieldLabels[field] || field}»:`,
      {
        reply_markup: new InlineKeyboard().text('❌ Отмена', `med:${medId}:edit`),
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
    await ctx.reply('📷 Все фото:', {
      reply_markup: new InlineKeyboard().text('◀️ Назад', `med:${med.id}`),
    });
  });

  // Medicine history
  bot.callbackQuery(/^med:([0-9a-f-]+):history$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medId = ctx.match[1];
    const med = await getMedicine(medId);
    if (!med) return;

    const history = await getMedicineHistory(medId);

    let text = `📋 *История: ${med.name}*\n\n`;

    if (history.length === 0) {
      text += '_Нет записей об изменениях._\n';
    } else {
      for (const entry of history) {
        const dateStr = formatDateTime(entry.changed_at);
        const username = entry.users?.username ? `@${entry.users.username}` : (entry.users?.first_name || 'Пользователь');
        text += `${dateStr} — ${username}\n`;

        const fieldLabel = FIELD_LABELS[entry.field_name] || entry.field_name;
        const oldVal = entry.old_value === null || entry.old_value === '' ? '(пусто)' : `«${entry.old_value}»`;
        const newVal = entry.new_value === null || entry.new_value === '' ? '(пусто)' : `«${entry.new_value}»`;
        text += `  ${fieldLabel}: ${oldVal} → ${newVal}\n\n`;
      }
    }

    const keyboard = new InlineKeyboard()
      .text('◀️ Назад', `med:${medId}`);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  // Copy/Move menu
  bot.callbackQuery(/^med:([0-9a-f-]+):copymove$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medId = ctx.match[1];

    const keyboard = new InlineKeyboard()
      .text('📋 Копировать', `med:${medId}:copy`)
      .text('📦 Переместить', `med:${medId}:move`)
      .row()
      .text('◀️ Назад', `med:${medId}`);

    await ctx.editMessageText(
      '📂 *Копирование / Перемещение*\n\nВыберите действие:',
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
        '📋 Нет других аптечек для копирования.\n\nСоздайте ещё одну аптечку.',
        { reply_markup: new InlineKeyboard().text('◀️ Назад', `med:${medId}:copymove`) }
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const mk of otherMedkits) {
      keyboard.text(mk.name, `med:${medId}:copy:${mk.id}`).row();
    }
    keyboard.text('◀️ Назад', `med:${medId}:copymove`);

    await ctx.editMessageText(
      `📋 *Копировать «${med.name}»*\n\nВыберите аптечку:`,
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
      `✅ «${med.name}» скопировано в аптечку «${targetMedkit.name}».`,
      {
        reply_markup: new InlineKeyboard()
          .text('◀️ К лекарству', `med:${medId}`)
          .text('📦 К аптечке', `medkit:${targetMedkitId}`),
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
        '📦 Нет других аптечек для перемещения.\n\nСоздайте ещё одну аптечку.',
        { reply_markup: new InlineKeyboard().text('◀️ Назад', `med:${medId}:copymove`) }
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const mk of otherMedkits) {
      keyboard.text(mk.name, `med:${medId}:move:${mk.id}`).row();
    }
    keyboard.text('◀️ Назад', `med:${medId}:copymove`);

    await ctx.editMessageText(
      `📦 *Переместить «${med.name}»*\n\nВыберите аптечку:`,
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
      `✅ «${med.name}» перемещено в аптечку «${targetMedkit.name}».`,
      {
        reply_markup: new InlineKeyboard()
          .text('◀️ К лекарству', `med:${medId}`)
          .text('📦 К аптечке', `medkit:${targetMedkitId}`),
      }
    );
  });

  // View archived medicines
  bot.callbackQuery(/^medkit:([0-9a-f-]+):archive$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const archived = await getArchivedMedicines(ctx.match[1]);

    if (archived.length === 0) {
      await ctx.editMessageText('📂 Архив пуст.', {
        reply_markup: new InlineKeyboard().text('◀️ Назад', `medkit:${ctx.match[1]}`),
      });
      return;
    }

    let text = '📂 *Архив*\n\n';
    const keyboard = new InlineKeyboard();

    for (const med of archived) {
      text += `🗑 ${med.name}${med.dosage ? ' ' + med.dosage : ''}\n`;
      keyboard
        .text(`♻️ ${med.name}`, `med:${med.id}:restore`)
        .text('🗑', `med:${med.id}:permdelete`)
        .row();
    }

    keyboard.text('◀️ Назад', `medkit:${ctx.match[1]}`);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  // Permanent delete — confirm
  bot.callbackQuery(/^med:([0-9a-f-]+):permdelete$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medId = ctx.match[1];
    const med = await getMedicine(medId);
    if (!med) return;

    await ctx.editMessageText(
      `🗑 Удалить навсегда «${med.name}»? Это действие нельзя отменить.`,
      {
        reply_markup: new InlineKeyboard()
          .text('✅ Да, удалить', `med:${medId}:permdelete:confirm`)
          .text('❌ Нет', `medkit:${med.medkit_id}:archive`),
      }
    );
  });

  // Permanent delete — confirmed
  bot.callbackQuery(/^med:([0-9a-f-]+):permdelete:confirm$/, async (ctx) => {
    const medId = ctx.match[1];
    const med = await getMedicine(medId);

    await supabase.from('medicines').delete().eq('id', medId);
    await logAction(ctx.dbUser.id, 'permanent_delete', 'medicine', medId);
    await ctx.answerCallbackQuery('Лекарство удалено навсегда');

    if (med) {
      await ctx.editMessageText('✅ Лекарство удалено навсегда.', {
        reply_markup: new InlineKeyboard().text('◀️ К архиву', `medkit:${med.medkit_id}:archive`),
      });
    }
  });

  // Restore from archive
  bot.callbackQuery(/^med:([0-9a-f-]+):restore$/, async (ctx) => {
    const med = await getMedicine(ctx.match[1]);
    await restoreMedicine(ctx.match[1]);
    await logAction(ctx.dbUser.id, 'restore', 'medicine', ctx.match[1]);
    await ctx.answerCallbackQuery('Лекарство восстановлено');
    if (med) {
      await ctx.editMessageText('✅ Лекарство восстановлено из архива.', {
        reply_markup: new InlineKeyboard().text('◀️ К аптечке', `medkit:${med.medkit_id}`),
      });
    }
  });

  // Schedule handler is registered in schedules.js (registerScheduleHandlers)
}
