import { InlineKeyboard } from 'grammy';
import { CATEGORIES, DOSAGE_UNITS, QUANTITY_UNITS, MAX_PHOTOS } from '../config.js';
import { createMedicine } from '../db/queries/medicines.js';
import { getMedkit } from '../db/queries/medkits.js';
import { formatDate, formatQuantity } from '../utils/format.js';
import { logAction } from '../middleware/logging.js';
import { supabase } from '../db/supabase.js';

async function getState(userId) {
  const { data } = await supabase
    .from('sessions')
    .select('value')
    .eq('key', `addmed:${userId}`)
    .single();
  return data?.value ?? null;
}

async function setState(userId, state) {
  await supabase
    .from('sessions')
    .upsert(
      { key: `addmed:${userId}`, value: state, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
}

async function clearState(userId) {
  await supabase
    .from('sessions')
    .delete()
    .eq('key', `addmed:${userId}`);
}

/**
 * Helper: edit the single bot message tracked in state.
 * If called from a callback query — use ctx.editMessageText.
 * If called after text input — use ctx.api.editMessageText with stored msgId.
 */
async function editBotMsg(ctx, state, text, keyboard) {
  const opts = { parse_mode: 'Markdown', reply_markup: keyboard };
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, opts);
  } else if (state.msgId) {
    await ctx.api.editMessageText(ctx.chat.id, state.msgId, text, opts);
  }
}

/**
 * Silently delete a user message (ignore errors if can't delete)
 */
async function deleteUserMsg(ctx) {
  try {
    await ctx.deleteMessage();
  } catch { /* ignore — might not have permission */ }
}

// ============================================================
// START
// ============================================================

export async function startAddMedicine(ctx, medkitId, options = {}) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit) {
    await ctx.answerCallbackQuery('Аптечка не найдена');
    return;
  }

  const state = {
    step: 'name',
    medkitId,
    medkitName: medkit.name,
    fromOnboarding: options.fromOnboarding || false,
    msgId: null, // will be set to the bot message we keep editing
    data: {
      medkitId,
      name: null,
      dosage: null,
      category: null,
      tags: [],
      expiryDate: null,
      quantity: 0,
      quantityUnit: 'шт',
      photoFileIds: [],
      notes: null,
    },
  };

  // Edit the current message (from callback) — this becomes our single bot message
  await ctx.editMessageText(
    `💊 *Добавление в «${medkit.name}»*\n\nШаг 1/8: Введите *название* лекарства:`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('❌ Отмена', 'addmed:cancel'),
    }
  );
  // Store the message ID so we can edit it later from text handlers
  state.msgId = ctx.callbackQuery.message.message_id;
  await setState(ctx.dbUser.id, state);
}

// ============================================================
// TEXT INPUT HANDLER
// ============================================================

export async function handleAddMedicineText(ctx) {
  const state = await getState(ctx.dbUser.id);
  if (!state) return false;

  const text = ctx.message.text.trim();
  const { step } = state;

  // Delete the user's message immediately
  await deleteUserMsg(ctx);

  if (step === 'name') {
    state.data.name = text;
    state.step = 'dosage_unit';
    await setState(ctx.dbUser.id, state);
    await sendDosageUnitPicker(ctx, state);
    return true;
  }

  if (step === 'dosage_value') {
    state.data.dosage = `${text} ${state.dosageUnit}`;
    state.step = 'category';
    await setState(ctx.dbUser.id, state);
    await sendCategoryPicker(ctx, state);
    return true;
  }

  if (step === 'dosage_custom') {
    state.data.dosage = text;
    state.step = 'category';
    await setState(ctx.dbUser.id, state);
    await sendCategoryPicker(ctx, state);
    return true;
  }

  if (step === 'category_custom') {
    state.data.category = text;
    state.step = 'tags';
    await setState(ctx.dbUser.id, state);
    await sendTagsPrompt(ctx, state);
    return true;
  }

  if (step === 'tags') {
    state.data.tags = text.split(',').map(t => t.trim()).filter(t => t.length > 0);
    state.step = 'expiry_year';
    await setState(ctx.dbUser.id, state);
    await sendExpiryYearPicker(ctx, state);
    return true;
  }

  if (step === 'quantity') {
    const num = parseFloat(text);
    if (!isNaN(num) && num >= 0) {
      state.data.quantity = num;
      state.step = 'quantity_unit';
      await setState(ctx.dbUser.id, state);
      await sendQuantityUnitPicker(ctx, state);
    } else {
      // Show error in the bot message
      await editBotMsg(ctx, state,
        'Шаг 6/8: Введите *количество* (число):\n\n⚠️ Некорректное число, попробуйте ещё раз.',
        new InlineKeyboard()
          .text('⏭ Пропустить', 'addmed:skip').row()
          .text('❌ Отмена', 'addmed:cancel')
      );
    }
    return true;
  }

  if (step === 'notes') {
    state.data.notes = text;
    state.step = 'confirm';
    await setState(ctx.dbUser.id, state);
    await sendConfirmation(ctx, state);
    return true;
  }

  return false;
}

// ============================================================
// PHOTO INPUT HANDLER
// ============================================================

export async function handleAddMedicinePhoto(ctx) {
  const state = await getState(ctx.dbUser.id);
  if (!state || state.step !== 'photos') return false;

  const photo = ctx.message.photo;
  const fileId = photo[photo.length - 1].file_id;
  state.data.photoFileIds.push(fileId);
  await deleteUserMsg(ctx);

  if (state.data.photoFileIds.length < MAX_PHOTOS) {
    await setState(ctx.dbUser.id, state);
    await editBotMsg(ctx, state,
      `Шаг 7/8: *Фото* лекарства (${state.data.photoFileIds.length}/${MAX_PHOTOS})\n\nОтправьте ещё или нажмите «Готово».`,
      new InlineKeyboard()
        .text('✅ Готово', 'addmed:photos_done')
        .row()
        .text('❌ Отмена', 'addmed:cancel')
    );
  } else {
    state.step = 'notes';
    await setState(ctx.dbUser.id, state);
    await sendNotesPrompt(ctx, state);
  }
  return true;
}

// ============================================================
// CALLBACK QUERY HANDLER
// ============================================================

export async function handleAddMedicineCallback(ctx, action) {
  const state = await getState(ctx.dbUser.id);
  if (!state) return false;

  // Update msgId from callback message (in case it wasn't set)
  if (ctx.callbackQuery.message) {
    state.msgId = ctx.callbackQuery.message.message_id;
  }

  if (action === 'addmed:cancel') {
    const fromOnboarding = state.fromOnboarding;
    const medkitId = state.medkitId;
    await clearState(ctx.dbUser.id);
    await ctx.answerCallbackQuery('Отменено');
    if (fromOnboarding) {
      await ctx.editMessageText(
        '⏭ Добавление пропущено. Вы сможете добавить лекарства позже.\n\nВот что умеет бот:',
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text('📦 Мои аптечки', 'medkits')
            .text('⚙️ Настройки', 'settings')
            .row()
            .text('📖 Помощь', 'help')
            .text('🏠 Главное меню', 'main_menu'),
        }
      );
    } else {
      await ctx.editMessageText('❌ Добавление отменено.', {
        reply_markup: new InlineKeyboard().text('◀️ К аптечке', `medkit:${medkitId}`),
      });
    }
    return true;
  }

  if (action === 'addmed:skip') {
    await ctx.answerCallbackQuery();
    return await advanceStep(ctx, state);
  }

  // --- Dosage unit ---
  if (action.startsWith('addmed:dosunit:')) {
    const unit = action.replace('addmed:dosunit:', '');
    await ctx.answerCallbackQuery();
    if (unit === 'другое') {
      state.step = 'dosage_custom';
      await setState(ctx.dbUser.id, state);
      await ctx.editMessageText(
        'Шаг 2/8: Введите *дозировку* целиком (напр. «2 капли», «1 пакетик»):',
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text('⏭ Пропустить', 'addmed:skip').row()
            .text('❌ Отмена', 'addmed:cancel'),
        }
      );
    } else {
      state.dosageUnit = unit;
      state.step = 'dosage_value';
      await setState(ctx.dbUser.id, state);
      await ctx.editMessageText(
        `Шаг 2/8: Введите *количество* в *${unit}* (напр. 500):`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text('⏭ Пропустить', 'addmed:skip').row()
            .text('❌ Отмена', 'addmed:cancel'),
        }
      );
    }
    return true;
  }

  // --- Category ---
  if (action.startsWith('addmed:cat:')) {
    state.data.category = action.replace('addmed:cat:', '');
    await ctx.answerCallbackQuery();
    state.step = 'tags';
    await setState(ctx.dbUser.id, state);
    await ctx.editMessageText(
      'Шаг 4/8: Введите *теги* через запятую (напр. «для детей, рецептурное»):',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('⏭ Пропустить', 'addmed:skip').row()
          .text('❌ Отмена', 'addmed:cancel'),
      }
    );
    return true;
  }

  if (action === 'addmed:cat_custom') {
    await ctx.answerCallbackQuery();
    state.step = 'category_custom';
    await setState(ctx.dbUser.id, state);
    await ctx.editMessageText(
      'Шаг 3/8: Введите *свою категорию*:',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('⏭ Пропустить', 'addmed:skip').row()
          .text('❌ Отмена', 'addmed:cancel'),
      }
    );
    return true;
  }

  // --- Expiry year ---
  if (action.startsWith('addmed:eyear:')) {
    const year = parseInt(action.replace('addmed:eyear:', ''));
    state.expiryYear = year;
    state.step = 'expiry_month';
    await ctx.answerCallbackQuery();
    await setState(ctx.dbUser.id, state);
    await sendExpiryMonthPicker(ctx, year);
    return true;
  }

  // --- Expiry month ---
  if (action.startsWith('addmed:emonth:')) {
    const month = parseInt(action.replace('addmed:emonth:', ''));
    state.expiryMonth = month;
    state.step = 'expiry_day';
    await ctx.answerCallbackQuery();
    await setState(ctx.dbUser.id, state);
    await sendExpiryDayPicker(ctx, state.expiryYear, month);
    return true;
  }

  // --- Expiry day ---
  if (action.startsWith('addmed:eday:')) {
    const day = parseInt(action.replace('addmed:eday:', ''));
    await ctx.answerCallbackQuery();
    const y = state.expiryYear;
    const m = String(state.expiryMonth).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    state.data.expiryDate = `${y}-${m}-${d}`;
    state.step = 'quantity';
    await setState(ctx.dbUser.id, state);
    await ctx.editMessageText(
      'Шаг 6/8: Введите *количество* (число):',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('⏭ Пропустить', 'addmed:skip').row()
          .text('❌ Отмена', 'addmed:cancel'),
      }
    );
    return true;
  }

  if (action === 'addmed:emonth_only') {
    await ctx.answerCallbackQuery();
    const y = state.expiryYear;
    const m = String(state.expiryMonth).padStart(2, '0');
    const lastDay = new Date(y, state.expiryMonth, 0).getDate();
    state.data.expiryDate = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
    state.step = 'quantity';
    await setState(ctx.dbUser.id, state);
    await ctx.editMessageText(
      'Шаг 6/8: Введите *количество* (число):',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('⏭ Пропустить', 'addmed:skip').row()
          .text('❌ Отмена', 'addmed:cancel'),
      }
    );
    return true;
  }

  // --- Quantity unit ---
  if (action.startsWith('addmed:qunit:')) {
    state.data.quantityUnit = action.replace('addmed:qunit:', '');
    await ctx.answerCallbackQuery();
    state.step = 'photos';
    await setState(ctx.dbUser.id, state);
    await ctx.editMessageText(
      `Шаг 7/8: Отправьте *фото* лекарства (до ${MAX_PHOTOS} шт.):`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('⏭ Пропустить', 'addmed:skip').row()
          .text('❌ Отмена', 'addmed:cancel'),
      }
    );
    return true;
  }

  // --- Photos ---
  if (action === 'addmed:photos_done') {
    await ctx.answerCallbackQuery();
    state.step = 'notes';
    await setState(ctx.dbUser.id, state);
    await ctx.editMessageText(
      'Шаг 8/8: Добавьте *заметки* (напр. «принимать после еды»):',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('⏭ Пропустить', 'addmed:skip').row()
          .text('❌ Отмена', 'addmed:cancel'),
      }
    );
    return true;
  }

  if (action === 'addmed:photos_more') {
    await ctx.answerCallbackQuery('Отправьте фото');
    return true;
  }

  // --- Confirm / Reject ---
  if (action === 'addmed:confirm') {
    await ctx.answerCallbackQuery();
    const medicine = await createMedicine(state.data);
    await logAction(ctx.dbUser.id, 'create', 'medicine', medicine.id, { name: state.data.name });
    const fromOnboarding = state.fromOnboarding;
    const medkitId = state.medkitId;
    await clearState(ctx.dbUser.id);

    if (fromOnboarding) {
      await ctx.editMessageText(
        `✅ Лекарство *«${state.data.name}»* добавлено!\n\n🎉 *Всё готово! Вот что вы можете делать:*\n\n` +
        `📦 *Аптечки* — создавайте несколько аптечек и переключайтесь между ними\n\n` +
        `💊 *Лекарства* — добавляйте с дозировкой, сроком годности, категорией, фото и заметками\n\n` +
        `📆 *Приём* — настройте расписание, и бот будет напоминать вовремя\n\n` +
        `👥 *Общий доступ* — поделитесь аптечкой с семьёй по ссылке\n\n` +
        `🔍 *Поиск* — просто напишите название лекарства в чат\n\n` +
        `⚙️ *Настройки* — часовой пояс, уведомления, дайджест`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text('📦 Мои аптечки', 'medkits')
            .text('⚙️ Настройки', 'settings')
            .row()
            .text('📖 Помощь', 'help')
            .text('🏠 Главное меню', 'main_menu'),
        }
      );
    } else {
      await ctx.editMessageText(
        `✅ Лекарство *«${state.data.name}»* добавлено!`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text('💊 Открыть', `med:${medicine.id}`)
            .text('➕ Ещё', `medkit:${medkitId}:add`)
            .row()
            .text('◀️ К аптечке', `medkit:${medkitId}`),
        }
      );
    }
    return true;
  }

  if (action === 'addmed:reject') {
    const fromOnboarding = state.fromOnboarding;
    const medkitId = state.medkitId;
    await clearState(ctx.dbUser.id);
    await ctx.answerCallbackQuery('Отменено');
    if (fromOnboarding) {
      await ctx.editMessageText(
        '⏭ Добавление пропущено. Вы сможете добавить лекарства позже.',
        {
          reply_markup: new InlineKeyboard()
            .text('📦 Мои аптечки', 'medkits')
            .text('⚙️ Настройки', 'settings')
            .row()
            .text('📖 Помощь', 'help')
            .text('🏠 Главное меню', 'main_menu'),
        }
      );
    } else {
      await ctx.editMessageText('❌ Добавление отменено.', {
        reply_markup: new InlineKeyboard().text('◀️ К аптечке', `medkit:${medkitId}`),
      });
    }
    return true;
  }

  return false;
}

// ============================================================
// STEP ADVANCE (skip)
// ============================================================

async function advanceStep(ctx, state) {
  const { step } = state;

  if (step === 'dosage_unit' || step === 'dosage_value' || step === 'dosage_custom') {
    state.step = 'category';
    await setState(ctx.dbUser.id, state);
    await sendCategoryPicker(ctx, state);
  } else if (step === 'category' || step === 'category_custom') {
    state.step = 'tags';
    await setState(ctx.dbUser.id, state);
    await sendTagsPrompt(ctx, state);
  } else if (step === 'tags') {
    state.step = 'expiry_year';
    await setState(ctx.dbUser.id, state);
    await sendExpiryYearPicker(ctx, state);
  } else if (step.startsWith('expiry')) {
    state.step = 'quantity';
    await setState(ctx.dbUser.id, state);
    await sendQuantityPrompt(ctx, state);
  } else if (step === 'quantity' || step === 'quantity_unit') {
    state.step = 'photos';
    await setState(ctx.dbUser.id, state);
    await sendPhotosPrompt(ctx, state);
  } else if (step === 'photos') {
    state.step = 'notes';
    await setState(ctx.dbUser.id, state);
    await sendNotesPrompt(ctx, state);
  } else if (step === 'notes') {
    state.step = 'confirm';
    await setState(ctx.dbUser.id, state);
    await sendConfirmation(ctx, state);
  }
  return true;
}

// ============================================================
// PROMPT SENDERS — all edit the single bot message
// ============================================================

async function sendDosageUnitPicker(ctx, state) {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < DOSAGE_UNITS.length; i += 3) {
    keyboard.text(DOSAGE_UNITS[i].label, `addmed:dosunit:${DOSAGE_UNITS[i].value}`);
    if (DOSAGE_UNITS[i + 1]) keyboard.text(DOSAGE_UNITS[i + 1].label, `addmed:dosunit:${DOSAGE_UNITS[i + 1].value}`);
    if (DOSAGE_UNITS[i + 2]) keyboard.text(DOSAGE_UNITS[i + 2].label, `addmed:dosunit:${DOSAGE_UNITS[i + 2].value}`);
    keyboard.row();
  }
  keyboard.text('⏭ Пропустить', 'addmed:skip').row();
  keyboard.text('❌ Отмена', 'addmed:cancel');
  await editBotMsg(ctx, state, 'Шаг 2/8: Выберите *единицу дозировки*:', keyboard);
}

async function sendCategoryPicker(ctx, state) {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    keyboard.text(CATEGORIES[i], `addmed:cat:${CATEGORIES[i]}`);
    if (CATEGORIES[i + 1]) keyboard.text(CATEGORIES[i + 1], `addmed:cat:${CATEGORIES[i + 1]}`);
    keyboard.row();
  }
  keyboard.text('✏️ Своя категория', 'addmed:cat_custom').row();
  keyboard.text('⏭ Пропустить', 'addmed:skip').row();
  keyboard.text('❌ Отмена', 'addmed:cancel');
  await editBotMsg(ctx, state, 'Шаг 3/8: Выберите *категорию*:', keyboard);
}

async function sendTagsPrompt(ctx, state) {
  const kb = new InlineKeyboard()
    .text('⏭ Пропустить', 'addmed:skip').row()
    .text('❌ Отмена', 'addmed:cancel');
  await editBotMsg(ctx, state, 'Шаг 4/8: Введите *теги* через запятую (напр. «для детей, рецептурное»):', kb);
}

async function sendExpiryYearPicker(ctx, state) {
  const currentYear = new Date().getFullYear();
  const keyboard = new InlineKeyboard();
  for (let y = currentYear; y <= currentYear + 7; y += 2) {
    keyboard.text(String(y), `addmed:eyear:${y}`);
    if (y + 1 <= currentYear + 7) keyboard.text(String(y + 1), `addmed:eyear:${y + 1}`);
    keyboard.row();
  }
  keyboard.text('⏭ Пропустить', 'addmed:skip').row();
  keyboard.text('❌ Отмена', 'addmed:cancel');
  await editBotMsg(ctx, state, 'Шаг 5/8: Выберите *год* срока годности:', keyboard);
}

async function sendExpiryMonthPicker(ctx, year) {
  const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < 12; i += 4) {
    for (let j = i; j < i + 4 && j < 12; j++) {
      keyboard.text(months[j], `addmed:emonth:${j + 1}`);
    }
    keyboard.row();
  }
  keyboard.text('⏭ Пропустить', 'addmed:skip').row();
  keyboard.text('❌ Отмена', 'addmed:cancel');
  await ctx.editMessageText(`Шаг 5/8: Выберите *месяц* (${year}):`, {
    parse_mode: 'Markdown', reply_markup: keyboard,
  });
}

async function sendExpiryDayPicker(ctx, year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const months = ['', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const keyboard = new InlineKeyboard();
  keyboard.text(`Только ${months[month]} ${year}`, 'addmed:emonth_only').row();
  for (let d = 1; d <= daysInMonth; d += 7) {
    for (let j = d; j < d + 7 && j <= daysInMonth; j++) {
      keyboard.text(String(j), `addmed:eday:${j}`);
    }
    keyboard.row();
  }
  keyboard.text('❌ Отмена', 'addmed:cancel');
  await ctx.editMessageText(`Шаг 5/8: Выберите *день* (${months[month]} ${year}) или оставьте только месяц:`, {
    parse_mode: 'Markdown', reply_markup: keyboard,
  });
}

async function sendQuantityPrompt(ctx, state) {
  const kb = new InlineKeyboard()
    .text('⏭ Пропустить', 'addmed:skip').row()
    .text('❌ Отмена', 'addmed:cancel');
  await editBotMsg(ctx, state, 'Шаг 6/8: Введите *количество* (число):', kb);
}

async function sendQuantityUnitPicker(ctx, state) {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < QUANTITY_UNITS.length; i += 3) {
    keyboard.text(QUANTITY_UNITS[i].label, `addmed:qunit:${QUANTITY_UNITS[i].value}`);
    if (QUANTITY_UNITS[i + 1]) keyboard.text(QUANTITY_UNITS[i + 1].label, `addmed:qunit:${QUANTITY_UNITS[i + 1].value}`);
    if (QUANTITY_UNITS[i + 2]) keyboard.text(QUANTITY_UNITS[i + 2].label, `addmed:qunit:${QUANTITY_UNITS[i + 2].value}`);
    keyboard.row();
  }
  await editBotMsg(ctx, state, 'Выберите *единицу измерения*:', keyboard);
}

async function sendPhotosPrompt(ctx, state) {
  const kb = new InlineKeyboard()
    .text('⏭ Пропустить', 'addmed:skip').row()
    .text('❌ Отмена', 'addmed:cancel');
  await editBotMsg(ctx, state, `Шаг 7/8: Отправьте *фото* лекарства (до ${MAX_PHOTOS} шт.):`, kb);
}

async function sendNotesPrompt(ctx, state) {
  const kb = new InlineKeyboard()
    .text('⏭ Пропустить', 'addmed:skip').row()
    .text('❌ Отмена', 'addmed:cancel');
  await editBotMsg(ctx, state, 'Шаг 8/8: Добавьте *заметки* (напр. «принимать после еды»):', kb);
}

async function sendConfirmation(ctx, state) {
  const d = state.data;
  let s = `📋 *Проверьте данные:*\n\n`;
  s += `💊 *Название:* ${d.name}\n`;
  if (d.dosage) s += `💉 *Дозировка:* ${d.dosage}\n`;
  if (d.category) s += `🏷 *Категория:* ${d.category}\n`;
  if (d.tags.length > 0) s += `🏷 *Теги:* ${d.tags.join(', ')}\n`;
  if (d.expiryDate) s += `📅 *Срок годности:* ${formatDate(d.expiryDate)}\n`;
  s += `📏 *Количество:* ${formatQuantity(d.quantity, d.quantityUnit)}\n`;
  if (d.photoFileIds.length > 0) s += `📷 *Фото:* ${d.photoFileIds.length} шт.\n`;
  if (d.notes) s += `📝 *Заметки:* ${d.notes}\n`;

  const kb = new InlineKeyboard()
    .text('✅ Сохранить', 'addmed:confirm')
    .text('❌ Отмена', 'addmed:reject');
  await editBotMsg(ctx, state, s, kb);
}
