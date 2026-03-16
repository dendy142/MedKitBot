import { InlineKeyboard } from 'grammy';
import { getMedicine, updateMedicine, archiveMedicine, restoreMedicine, toggleFavorite, getArchivedMedicines, createMedicine } from '../db/queries/medicines.js';
import { getMedkit, getUserMedkits } from '../db/queries/medkits.js';
import { formatQuantity, formatExpiry, formatDate, medicineStatusEmoji, daysUntil, formatProgressBar } from '../utils/format.js';
import { paginateItems, addPagination } from '../keyboards/pagination.js';
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
  const thresholdDays = settings.thresholds?.expiry_days || 30;

  const statusEmoji = medicineStatusEmoji(med, settings.thresholds);
  let statusLabel = '';
  if (statusEmoji === '❌') {
    statusLabel = ' — _просрочено_';
  } else if (statusEmoji === '⚠️') {
    const days = daysUntil(med.expiry_date);
    statusLabel = ` — _истекает через ${days} дн._`;
  } else if (statusEmoji === '📉') {
    statusLabel = ' — _мало остатка_';
  }
  let text = `${statusEmoji} *${med.name}*${med.dosage ? ' ' + med.dosage : ''}${statusLabel}\n`;

  if (med.category) text += `🏷 ${med.category}`;
  if (med.tags && med.tags.length > 0) {
    text += (med.category ? ' · ' : '🔖 ') + med.tags.map(t => `#${t}`).join(' ');
  }
  if (med.category || (med.tags && med.tags.length > 0)) text += '\n';

  text += `📅 Срок: ${med.expiry_date ? formatExpiry(med.expiry_date, dateFormat, thresholdDays) : 'не указан'}\n`;

  // Quantity with visual progress bar
  if (med.initial_quantity > 0) {
    const percent = Math.round((med.quantity / med.initial_quantity) * 100);
    const bar = formatProgressBar(med.quantity, med.initial_quantity);
    text += `📏 ${bar} ${med.quantity}/${med.initial_quantity} ${med.quantity_unit} (${percent}%)\n`;
  } else if (med.quantity > 0) {
    const qty = formatQuantity(med.quantity, med.quantity_unit);
    text += `📏 Остаток: ${qty}\n`;
  } else {
    text += `📏 Остаток: 0 ${med.quantity_unit || 'шт'}\n`;
  }

  if (med.notes) text += `📝 ${med.notes}\n`;

  if (med.is_favorite) text += `\n⭐ В избранном`;

  // Keyboard — grouped by frequency of use
  const keyboard = new InlineKeyboard();
  // Row 1: Primary actions
  keyboard.text('✏️ Изменить', `med:${med.id}:edit`);
  keyboard.text('➕ Пополнить', `med:${med.id}:restock`);
  keyboard.text(med.is_favorite ? '⭐ Избр.' : '☆ Избр.', `med:${med.id}:fav`);
  keyboard.row();
  // Row 2: Secondary actions
  keyboard.text('📆 Курс приёма', `med:${med.id}:schedule`);
  keyboard.text('🛒 В покупки', `med:${med.id}:shop`);
  keyboard.row();
  // Row 3: More actions submenu
  keyboard.text('📋 Ещё', `med:${med.id}:more`);
  keyboard.row();
  // Row 4: Navigation
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
function formatDateTime(dateStr, timezone = 'Europe/Moscow') {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const fmt = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: timezone,
  });
  return fmt.format(d);
}

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

  // "More" submenu
  bot.callbackQuery(/^med:([0-9a-f-]+):more$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medId = ctx.match[1];
    const med = await getMedicine(medId);
    if (!med) return;

    const keyboard = new InlineKeyboard();
    if (med.photo_file_ids && med.photo_file_ids.length > 0) {
      keyboard.text(`📷 Фото (${med.photo_file_ids.length})`, `med:${medId}:photos`).row();
    }
    keyboard
      .text('📑 Дублировать', `med:${medId}:copymove`)
      .text('🕓 История', `med:${medId}:history`)
      .row()
      .text('📥 В архив', `med:${medId}:archive`)
      .row()
      .text('◀️ Назад', `med:${medId}`);

    await ctx.editMessageText(
      `📋 *${med.name}* — дополнительно:`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  });

  // Toggle favorite
  bot.callbackQuery(/^med:([0-9a-f-]+):fav$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await toggleFavorite(ctx.match[1]);
    await showMedicineCard(ctx, ctx.match[1]);
  });

  // Archive medicine — confirm (P2.2: contextual warning)
  bot.callbackQuery(/^med:([0-9a-f-]+):archive$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const med = await getMedicine(ctx.match[1]);
    if (!med) return;

    // Check for active schedules
    const { data: schedules } = await supabase
      .from('schedules')
      .select('id')
      .eq('medicine_id', ctx.match[1])
      .eq('is_active', true);
    const schedCount = schedules?.length || 0;

    let text = `📥 Переместить «${med.name}» в архив?`;
    if (schedCount > 0) {
      text += `\n\n⚠️ У этого лекарства ${schedCount} активных расписаний. Они продолжат работать, но без привязки к лекарству.`;
    }

    await ctx.editMessageText(text, {
      reply_markup: new InlineKeyboard()
        .text('✅ Да', `med:${ctx.match[1]}:archive:confirm`)
        .text('❌ Нет', `med:${ctx.match[1]}`),
    });
  });

  // Archive medicine — confirmed
  bot.callbackQuery(/^med:([0-9a-f-]+):archive:confirm$/, async (ctx) => {
    const med = await getMedicine(ctx.match[1]);
    await archiveMedicine(ctx.match[1]);
    await logAction(ctx.dbUser.id, 'archive', 'medicine', ctx.match[1]);
    await ctx.answerCallbackQuery('Перемещено в архив');
    if (med) {
      await ctx.editMessageText('✅ Лекарство перемещено в архив.', {
        reply_markup: new InlineKeyboard().text('◀️ К аптечке', `medkit:${med.medkit_id}`),
      });
    }
  });

  // Restock — ask quantity (P2.6: context-aware buttons, P3.6: expiry warning)
  bot.callbackQuery(/^med:([0-9a-f-]+):restock$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await supabase.from('sessions').upsert(
      { key: `state:${ctx.dbUser.id}`, value: { action: 'restock', medId: ctx.match[1], msgId: ctx.callbackQuery.message.message_id }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    const med = await getMedicine(ctx.match[1]);
    if (!med) return;

    // P2.6: Adapt restock buttons to quantity_unit
    const unit = med.quantity_unit || 'шт';
    let amounts;
    if (unit === 'мл' || unit === 'капель') {
      amounts = [10, 50, 100, 250];
    } else if (unit === 'таблеток' || unit === 'капсул') {
      amounts = [10, 20, 30, 60];
    } else if (unit === 'ампул') {
      amounts = [1, 3, 5, 10];
    } else {
      amounts = [1, 5, 10, 30];
    }

    // P3.6: Warn if expired
    let text = `➕ *Пополнение: ${med.name}*\n\nТекущий остаток: ${formatQuantity(med.quantity, med.quantity_unit)}`;
    if (med.expiry_date) {
      const days = daysUntil(med.expiry_date);
      if (days !== null && days <= 0) {
        text += `\n\n⚠️ *Срок годности истёк (${formatExpiry(med.expiry_date)})!* Проверьте лекарство.`;
      }
    }
    text += '\n\nВведите количество или выберите:';

    const keyboard = new InlineKeyboard();
    for (const a of amounts) {
      keyboard.text(`+${a}`, `med:${ctx.match[1]}:restock:${a}`);
    }
    keyboard.row().text('❌ Отмена', `med:${ctx.match[1]}`);

    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  // Quick restock buttons
  bot.callbackQuery(/^med:([0-9a-f-]+):restock:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medId = ctx.match[1];
    const amount = parseInt(ctx.match[2]);
    const med = await getMedicine(medId);
    if (!med) return;

    const newQty = med.quantity + amount;
    await updateMedicine(medId, { quantity: newQty });
    await logMedicineChange(medId, ctx.dbUser.id, 'quantity', med.quantity, newQty);
    await ctx.editMessageText(
      `✅ Остаток пополнен: ${formatQuantity(newQty, med.quantity_unit)}`,
      {
        reply_markup: new InlineKeyboard().text('◀️ К лекарству', `med:${medId}`),
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

  // Show photos (P2.8: group photos to avoid chat spam)
  bot.callbackQuery(/^med:([0-9a-f-]+):photos$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const med = await getMedicine(ctx.match[1]);
    if (!med || !med.photo_file_ids || med.photo_file_ids.length === 0) return;

    if (med.photo_file_ids.length === 1) {
      await ctx.replyWithPhoto(med.photo_file_ids[0]);
    } else {
      // Send as media group (single message with multiple photos)
      const mediaGroup = med.photo_file_ids.map((fileId, i) => ({
        type: 'photo',
        media: fileId,
        ...(i === 0 ? { caption: `📷 ${med.name} (${med.photo_file_ids.length} фото)` } : {}),
      }));
      await ctx.replyWithMediaGroup(mediaGroup);
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

    const timezone = ctx.dbUser.timezone || 'Europe/Moscow';
    let text = `🕓 *История: ${med.name}*\n\n`;

    if (history.length === 0) {
      text += '_Нет записей об изменениях._\n';
    } else {
      for (const entry of history) {
        const dateStr = formatDateTime(entry.changed_at, timezone);
        const username = entry.users?.username ? `@${entry.users.username}` : (entry.users?.first_name || 'Пользователь');
        text += `${dateStr} — ${username}\n`;

        const fieldLabel = FIELD_LABELS[entry.field_name] || entry.field_name;
        const oldVal = entry.old_value === null || entry.old_value === '' ? '(пусто)' : `«${entry.old_value}»`;
        const newVal = entry.new_value === null || entry.new_value === '' ? '(пусто)' : `«${entry.new_value}»`;
        text += `  ${fieldLabel}: ${oldVal} → ${newVal}\n\n`;
      }
    }

    const keyboard = new InlineKeyboard()
      .text('◀️ Назад', `med:${medId}:more`);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  // Copy/Move menu
  bot.callbackQuery(/^med:([0-9a-f-]+):copymove$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medId = ctx.match[1];

    const keyboard = new InlineKeyboard()
      .text('📑 Дублировать', `med:${medId}:copy`)
      .text('📦 Переместить', `med:${medId}:move`)
      .row()
      .text('◀️ Назад', `med:${medId}:more`);

    await ctx.editMessageText(
      '📂 *Дублирование / Перемещение*\n\nВыберите действие:',
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
        '📑 Нет других аптечек для дублирования.\n\nСоздайте ещё одну аптечку.',
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
      `📑 *Дублировать «${med.name}»*\n\nВыберите аптечку:`,
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
      `✅ «${med.name}» дублировано в аптечку «${targetMedkit.name}».`,
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
  bot.callbackQuery(/^medkit:([0-9a-f-]+):archive(?::page:(\d+))?$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];
    const page = ctx.match[2] ? parseInt(ctx.match[2]) : 0;
    const archived = await getArchivedMedicines(medkitId);

    if (archived.length === 0) {
      await ctx.editMessageText('📂 Архив пуст.\n\n_Архивированные лекарства появятся здесь._', {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('◀️ Назад', `medkit:${medkitId}`),
      });
      return;
    }

    const pageItems = paginateItems(archived, page);
    let text = `📂 *Архив* (${archived.length})\n\n`;
    const keyboard = new InlineKeyboard();

    for (const med of pageItems) {
      text += `📥 ${med.name}${med.dosage ? ' ' + med.dosage : ''}\n`;
      keyboard
        .text(`♻️ ${med.name}`, `med:${med.id}:restore`)
        .text('🗑', `med:${med.id}:permdelete`)
        .row();
    }

    addPagination(keyboard, page, archived.length, `medkit:${medkitId}:archive`);
    keyboard.row();
    keyboard.text('◀️ Назад', `medkit:${medkitId}`);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  // Permanent delete — confirm (P2.2: contextual warning)
  bot.callbackQuery(/^med:([0-9a-f-]+):permdelete$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medId = ctx.match[1];
    const med = await getMedicine(medId);
    if (!med) return;

    let text = `🗑 Удалить навсегда «${med.name}»? Это действие нельзя отменить.`;
    text += `\n\n⚠️ Будут также удалены все связанные расписания и логи приёма.`;

    await ctx.editMessageText(text, {
      reply_markup: new InlineKeyboard()
        .text('✅ Да, удалить', `med:${medId}:permdelete:confirm`)
        .text('❌ Нет', `medkit:${med.medkit_id}:archive`),
    });
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
}
