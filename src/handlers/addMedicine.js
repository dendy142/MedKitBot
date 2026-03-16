import { InlineKeyboard } from 'grammy';
import { CATEGORIES, DOSAGE_UNITS, QUANTITY_UNITS, MAX_PHOTOS } from '../config.js';
import { createMedicine } from '../db/queries/medicines.js';
import { getMedkit } from '../db/queries/medkits.js';
import { formatDate, formatQuantity, formatProgressBar } from '../utils/format.js';
import { logAction } from '../middleware/logging.js';
import { supabase } from '../db/supabase.js';
import { ONBOARDING_COMPLETE_TEXT } from './onboarding.js';

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
 */
async function editBotMsg(ctx, state, text, keyboard) {
  const opts = { parse_mode: 'Markdown', reply_markup: keyboard };
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, opts);
  } else if (state.msgId) {
    await ctx.api.editMessageText(ctx.chat.id, state.msgId, text, opts);
  }
}

async function deleteUserMsg(ctx) {
  try {
    await ctx.deleteMessage();
  } catch { /* ignore */ }
}

const ONBOARDING_NAV_KEYBOARD = new InlineKeyboard()
  .text('📦 Мои аптечки', 'medkits')
  .text('⚙️ Настройки', 'settings')
  .row()
  .text('📖 Помощь', 'help')
  .text('🏠 Главное меню', 'main_menu');

// --- Progress bar helpers ---
const STAGES = ['name', 'dosage', 'category', 'tags', 'expiry', 'quantity', 'photos', 'notes'];
const STAGE_LABELS = {
  name: 'Название',
  dosage: 'Дозировка',
  category: 'Категория',
  tags: 'Теги',
  expiry: 'Срок годности',
  quantity: 'Количество',
  photos: 'Фото',
  notes: 'Заметки',
};

function stepToStage(step) {
  if (step === 'name') return 'name';
  if (step.startsWith('dosage') || step === 'dosage_unit' || step === 'dosage_value' || step === 'dosage_custom') return 'dosage';
  if (step.startsWith('category')) return 'category';
  if (step === 'tags') return 'tags';
  if (step.startsWith('expiry')) return 'expiry';
  if (step === 'quantity' || step === 'quantity_unit') return 'quantity';
  if (step === 'photos') return 'photos';
  if (step === 'notes') return 'notes';
  if (step === 'confirm') return 'confirm';
  return 'name';
}

function buildStageHeader(state) {
  const stage = stepToStage(state.step);
  if (stage === 'confirm') return '📋 *Проверьте данные:*';
  const idx = STAGES.indexOf(stage);
  const total = STAGES.length;
  const bar = formatProgressBar(idx + 1, total, 14);
  const label = STAGE_LABELS[stage] || stage;
  return `💊 *Добавление в «${state.medkitName}»*\n${bar} ${label}`;
}

// --- Skip button labels ---
const SKIP_LABELS = {
  dosage_unit: '⏭ Без дозировки',
  dosage_value: '⏭ Без дозировки',
  dosage_custom: '⏭ Без дозировки',
  category: '⏭ Без категории',
  category_custom: '⏭ Без категории',
  tags: '⏭ Без тегов',
  expiry_year: '⏭ Без срока',
  expiry_month: '⏭ Без срока',
  expiry_day: '⏭ Без срока',
  quantity: '⏭ Без количества',
  quantity_unit: '⏭ Пропустить',
  photos: '⏭ Без фото',
  notes: '⏭ Без заметок',
};

function getSkipLabel(step) {
  return SKIP_LABELS[step] || '⏭ Пропустить';
}

async function showCancelResult(ctx, fromOnboarding, medkitId) {
  if (fromOnboarding) {
    await ctx.editMessageText(
      '⏭ Добавление пропущено. Вы сможете добавить лекарства позже.',
      { parse_mode: 'Markdown', reply_markup: ONBOARDING_NAV_KEYBOARD }
    );
  } else {
    await ctx.editMessageText('❌ Добавление отменено.', {
      reply_markup: new InlineKeyboard().text('◀️ К аптечке', `medkit:${medkitId}`),
    });
  }
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
    msgId: null,
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

  const header = buildStageHeader(state);
  await ctx.editMessageText(
    `${header}\n\nВведите *название* лекарства:`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('❌ Отмена', 'addmed:cancel'),
    }
  );
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

  await deleteUserMsg(ctx);

  if (step === 'name') {
    state.data.name = text;
    if (state.editingFromConfirm) {
      state.editingFromConfirm = false;
      state.step = 'confirm';
      await setState(ctx.dbUser.id, state);
      await sendConfirmation(ctx, state);
    } else {
      state.step = 'dosage_unit';
      await setState(ctx.dbUser.id, state);
      await sendDosageUnitPicker(ctx, state);
    }
    return true;
  }

  if (step === 'dosage_value') {
    state.data.dosage = `${text} ${state.dosageUnit}`;
    if (state.editingFromConfirm) {
      state.editingFromConfirm = false;
      state.step = 'confirm';
    } else {
      state.step = 'category';
    }
    await setState(ctx.dbUser.id, state);
    state.step === 'confirm' ? await sendConfirmation(ctx, state) : await sendCategoryPicker(ctx, state);
    return true;
  }

  if (step === 'dosage_custom') {
    state.data.dosage = text;
    if (state.editingFromConfirm) {
      state.editingFromConfirm = false;
      state.step = 'confirm';
    } else {
      state.step = 'category';
    }
    await setState(ctx.dbUser.id, state);
    state.step === 'confirm' ? await sendConfirmation(ctx, state) : await sendCategoryPicker(ctx, state);
    return true;
  }

  if (step === 'category_custom') {
    state.data.category = text;
    if (state.editingFromConfirm) {
      state.editingFromConfirm = false;
      state.step = 'confirm';
    } else {
      state.step = 'tags';
    }
    await setState(ctx.dbUser.id, state);
    state.step === 'confirm' ? await sendConfirmation(ctx, state) : await sendTagsPrompt(ctx, state);
    return true;
  }

  if (step === 'tags') {
    state.data.tags = text.split(',').map(t => t.trim()).filter(t => t.length > 0);
    if (state.editingFromConfirm) {
      state.editingFromConfirm = false;
      state.step = 'confirm';
    } else {
      state.step = 'expiry_year';
    }
    await setState(ctx.dbUser.id, state);
    state.step === 'confirm' ? await sendConfirmation(ctx, state) : await sendExpiryYearPicker(ctx, state);
    return true;
  }

  if (step === 'quantity') {
    const num = parseFloat(text);
    if (!isNaN(num) && num >= 0) {
      state.data.quantity = num;
      if (state.editingFromConfirm) {
        state.editingFromConfirm = false;
        state.step = 'confirm';
        await setState(ctx.dbUser.id, state);
        await sendConfirmation(ctx, state);
      } else {
        state.step = 'quantity_unit';
        await setState(ctx.dbUser.id, state);
        await sendQuantityUnitPicker(ctx, state);
      }
    } else {
      const header = buildStageHeader(state);
      await editBotMsg(ctx, state,
        `${header}\n\nВведите *количество* (число):\n\n⚠️ Некорректное число, попробуйте ещё раз.`,
        new InlineKeyboard()
          .text(getSkipLabel('quantity'), 'addmed:skip').row()
          .text('❌ Отмена', 'addmed:cancel')
      );
    }
    return true;
  }

  if (step === 'notes') {
    state.data.notes = text;
    state.step = 'confirm';
    // editingFromConfirm doesn't matter here, we always go to confirm
    state.editingFromConfirm = false;
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
    const header = buildStageHeader(state);
    await editBotMsg(ctx, state,
      `${header}\n\n*Фото* лекарства (${state.data.photoFileIds.length}/${MAX_PHOTOS})\n\nОтправьте ещё или нажмите «Готово».`,
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

  if (ctx.callbackQuery.message) {
    state.msgId = ctx.callbackQuery.message.message_id;
  }

  if (action === 'addmed:cancel') {
    const fromOnboarding = state.fromOnboarding;
    const medkitId = state.medkitId;
    await clearState(ctx.dbUser.id);
    await ctx.answerCallbackQuery('Отменено');
    await showCancelResult(ctx, fromOnboarding, medkitId);
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
      const header = buildStageHeader(state);
      await ctx.editMessageText(
        `${header}\n\nВведите *дозировку* целиком (напр. «2 капли», «1 пакетик»):`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(getSkipLabel('dosage_custom'), 'addmed:skip').row()
            .text('❌ Отмена', 'addmed:cancel'),
        }
      );
    } else {
      state.dosageUnit = unit;
      state.step = 'dosage_value';
      await setState(ctx.dbUser.id, state);
      const header = buildStageHeader(state);
      await ctx.editMessageText(
        `${header}\n\nВведите *количество* в *${unit}* (напр. 500):`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(getSkipLabel('dosage_value'), 'addmed:skip').row()
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
    if (state.editingFromConfirm) {
      state.editingFromConfirm = false;
      state.step = 'confirm';
      await setState(ctx.dbUser.id, state);
      await sendConfirmation(ctx, state);
    } else {
      state.step = 'tags';
      await setState(ctx.dbUser.id, state);
      await sendTagsPrompt(ctx, state);
    }
    return true;
  }

  if (action === 'addmed:cat_custom') {
    await ctx.answerCallbackQuery();
    state.step = 'category_custom';
    await setState(ctx.dbUser.id, state);
    const header = buildStageHeader(state);
    await ctx.editMessageText(
      `${header}\n\nВведите *свою категорию*:`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(getSkipLabel('category_custom'), 'addmed:skip').row()
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
    await sendExpiryMonthPicker(ctx, state, year);
    return true;
  }

  // --- Expiry month ---
  if (action.startsWith('addmed:emonth:')) {
    const month = parseInt(action.replace('addmed:emonth:', ''));
    state.expiryMonth = month;
    state.step = 'expiry_day';
    await ctx.answerCallbackQuery();
    await setState(ctx.dbUser.id, state);
    await sendExpiryDayPicker(ctx, state, state.expiryYear, month);
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
    if (state.editingFromConfirm) {
      state.editingFromConfirm = false;
      state.step = 'confirm';
      await setState(ctx.dbUser.id, state);
      await sendConfirmation(ctx, state);
    } else {
      state.step = 'quantity';
      await setState(ctx.dbUser.id, state);
      await sendQuantityPrompt(ctx, state);
    }
    return true;
  }

  if (action === 'addmed:emonth_only') {
    await ctx.answerCallbackQuery();
    const y = state.expiryYear;
    const m = String(state.expiryMonth).padStart(2, '0');
    const lastDay = new Date(y, state.expiryMonth, 0).getDate();
    state.data.expiryDate = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
    if (state.editingFromConfirm) {
      state.editingFromConfirm = false;
      state.step = 'confirm';
      await setState(ctx.dbUser.id, state);
      await sendConfirmation(ctx, state);
    } else {
      state.step = 'quantity';
      await setState(ctx.dbUser.id, state);
      await sendQuantityPrompt(ctx, state);
    }
    return true;
  }

  // --- Quantity unit ---
  if (action.startsWith('addmed:qunit:')) {
    state.data.quantityUnit = action.replace('addmed:qunit:', '');
    await ctx.answerCallbackQuery();
    if (state.editingFromConfirm) {
      state.editingFromConfirm = false;
      state.step = 'confirm';
      await setState(ctx.dbUser.id, state);
      await sendConfirmation(ctx, state);
    } else {
      state.step = 'photos';
      await setState(ctx.dbUser.id, state);
      await sendPhotosPrompt(ctx, state);
    }
    return true;
  }

  // --- Photos ---
  if (action === 'addmed:photos_done') {
    await ctx.answerCallbackQuery();
    if (state.editingFromConfirm) {
      state.editingFromConfirm = false;
      state.step = 'confirm';
      await setState(ctx.dbUser.id, state);
      await sendConfirmation(ctx, state);
    } else {
      state.step = 'notes';
      await setState(ctx.dbUser.id, state);
      await sendNotesPrompt(ctx, state);
    }
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
        `✅ Лекарство *«${state.data.name}»* добавлено!\n\n${ONBOARDING_COMPLETE_TEXT}`,
        { parse_mode: 'Markdown', reply_markup: ONBOARDING_NAV_KEYBOARD }
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
    await showCancelResult(ctx, fromOnboarding, medkitId);
    return true;
  }

  // --- Edit field from confirmation screen ---
  if (action.startsWith('addmed:editfield:')) {
    const field = action.replace('addmed:editfield:', '');
    await ctx.answerCallbackQuery();
    state.editingFromConfirm = true;

    if (field === 'name') {
      state.step = 'name';
      await setState(ctx.dbUser.id, state);
      const header = buildStageHeader(state);
      await ctx.editMessageText(
        `${header}\n\nТекущее: *${state.data.name}*\n\nВведите новое *название*:`,
        { parse_mode: 'Markdown', reply_markup: new InlineKeyboard().text('⏭ Оставить', 'addmed:backtoconfirm').row().text('❌ Отмена', 'addmed:cancel') }
      );
    } else if (field === 'dosage') {
      state.step = 'dosage_unit';
      await setState(ctx.dbUser.id, state);
      await sendDosageUnitPicker(ctx, state);
    } else if (field === 'category') {
      state.step = 'category';
      await setState(ctx.dbUser.id, state);
      await sendCategoryPicker(ctx, state);
    } else if (field === 'expiry') {
      state.step = 'expiry_year';
      await setState(ctx.dbUser.id, state);
      await sendExpiryYearPicker(ctx, state);
    } else if (field === 'quantity') {
      state.step = 'quantity';
      await setState(ctx.dbUser.id, state);
      await sendQuantityPrompt(ctx, state);
    } else if (field === 'photos') {
      state.step = 'photos';
      await setState(ctx.dbUser.id, state);
      await sendPhotosPrompt(ctx, state);
    }
    return true;
  }

  // --- Back to confirmation from field edit ---
  if (action === 'addmed:backtoconfirm') {
    state.step = 'confirm';
    await setState(ctx.dbUser.id, state);
    await sendConfirmation(ctx, state);
    return true;
  }

  return false;
}

// ============================================================
// STEP ADVANCE (skip)
// ============================================================

async function advanceStep(ctx, state) {
  // If editing a single field from confirmation, go back to confirm
  if (state.editingFromConfirm) {
    state.editingFromConfirm = false;
    state.step = 'confirm';
    await setState(ctx.dbUser.id, state);
    await sendConfirmation(ctx, state);
    return true;
  }

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
// PROMPT SENDERS
// ============================================================

async function sendDosageUnitPicker(ctx, state) {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < DOSAGE_UNITS.length; i += 3) {
    keyboard.text(DOSAGE_UNITS[i].label, `addmed:dosunit:${DOSAGE_UNITS[i].value}`);
    if (DOSAGE_UNITS[i + 1]) keyboard.text(DOSAGE_UNITS[i + 1].label, `addmed:dosunit:${DOSAGE_UNITS[i + 1].value}`);
    if (DOSAGE_UNITS[i + 2]) keyboard.text(DOSAGE_UNITS[i + 2].label, `addmed:dosunit:${DOSAGE_UNITS[i + 2].value}`);
    keyboard.row();
  }
  keyboard.text(getSkipLabel('dosage_unit'), 'addmed:skip').row();
  keyboard.text('❌ Отмена', 'addmed:cancel');
  const header = buildStageHeader(state);
  await editBotMsg(ctx, state, `${header}\n\nВыберите *единицу дозировки*:`, keyboard);
}

async function sendCategoryPicker(ctx, state) {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    keyboard.text(CATEGORIES[i], `addmed:cat:${CATEGORIES[i]}`);
    if (CATEGORIES[i + 1]) keyboard.text(CATEGORIES[i + 1], `addmed:cat:${CATEGORIES[i + 1]}`);
    keyboard.row();
  }
  keyboard.text('✏️ Своя категория', 'addmed:cat_custom').row();
  keyboard.text(getSkipLabel('category'), 'addmed:skip').row();
  keyboard.text('❌ Отмена', 'addmed:cancel');
  const header = buildStageHeader(state);
  await editBotMsg(ctx, state, `${header}\n\nВыберите *категорию*:`, keyboard);
}

async function sendTagsPrompt(ctx, state) {
  const kb = new InlineKeyboard()
    .text(getSkipLabel('tags'), 'addmed:skip').row()
    .text('❌ Отмена', 'addmed:cancel');
  const header = buildStageHeader(state);
  await editBotMsg(ctx, state, `${header}\n\nВведите *теги* через запятую (напр. «для детей, рецептурное»):`, kb);
}

async function sendExpiryYearPicker(ctx, state) {
  const currentYear = new Date().getFullYear();
  const keyboard = new InlineKeyboard();
  for (let y = currentYear; y <= currentYear + 7; y += 2) {
    keyboard.text(String(y), `addmed:eyear:${y}`);
    if (y + 1 <= currentYear + 7) keyboard.text(String(y + 1), `addmed:eyear:${y + 1}`);
    keyboard.row();
  }
  keyboard.text(getSkipLabel('expiry_year'), 'addmed:skip').row();
  keyboard.text('❌ Отмена', 'addmed:cancel');
  const header = buildStageHeader(state);
  await editBotMsg(ctx, state, `${header}\n\nВыберите *год* срока годности:`, keyboard);
}

async function sendExpiryMonthPicker(ctx, state, year) {
  const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const keyboard = new InlineKeyboard();
  // 3 months per row for better mobile display
  for (let i = 0; i < 12; i += 3) {
    for (let j = i; j < i + 3 && j < 12; j++) {
      keyboard.text(months[j], `addmed:emonth:${j + 1}`);
    }
    keyboard.row();
  }
  keyboard.text(getSkipLabel('expiry_month'), 'addmed:skip').row();
  keyboard.text('❌ Отмена', 'addmed:cancel');
  const header = buildStageHeader(state);
  await ctx.editMessageText(`${header}\n\nВыберите *месяц* (${year}):`, {
    parse_mode: 'Markdown', reply_markup: keyboard,
  });
}

async function sendExpiryDayPicker(ctx, state, year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const months = ['', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const keyboard = new InlineKeyboard();
  keyboard.text(`Только ${months[month]} ${year}`, 'addmed:emonth_only').row();
  // 5 buttons per row instead of 7 for better mobile display
  for (let d = 1; d <= daysInMonth; d += 5) {
    for (let j = d; j < d + 5 && j <= daysInMonth; j++) {
      keyboard.text(String(j), `addmed:eday:${j}`);
    }
    keyboard.row();
  }
  keyboard.text('❌ Отмена', 'addmed:cancel');
  const header = buildStageHeader(state);
  await ctx.editMessageText(`${header}\n\nВыберите *день* (${months[month]} ${year}) или оставьте только месяц:`, {
    parse_mode: 'Markdown', reply_markup: keyboard,
  });
}

async function sendQuantityPrompt(ctx, state) {
  const kb = new InlineKeyboard()
    .text(getSkipLabel('quantity'), 'addmed:skip').row()
    .text('❌ Отмена', 'addmed:cancel');
  const header = buildStageHeader(state);
  await editBotMsg(ctx, state, `${header}\n\nВведите *количество* (число):`, kb);
}

async function sendQuantityUnitPicker(ctx, state) {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < QUANTITY_UNITS.length; i += 3) {
    keyboard.text(QUANTITY_UNITS[i].label, `addmed:qunit:${QUANTITY_UNITS[i].value}`);
    if (QUANTITY_UNITS[i + 1]) keyboard.text(QUANTITY_UNITS[i + 1].label, `addmed:qunit:${QUANTITY_UNITS[i + 1].value}`);
    if (QUANTITY_UNITS[i + 2]) keyboard.text(QUANTITY_UNITS[i + 2].label, `addmed:qunit:${QUANTITY_UNITS[i + 2].value}`);
    keyboard.row();
  }
  const header = buildStageHeader(state);
  await editBotMsg(ctx, state, `${header}\n\nВыберите *единицу измерения*:`, keyboard);
}

async function sendPhotosPrompt(ctx, state) {
  const kb = new InlineKeyboard()
    .text(getSkipLabel('photos'), 'addmed:skip').row()
    .text('❌ Отмена', 'addmed:cancel');
  const header = buildStageHeader(state);
  await editBotMsg(ctx, state, `${header}\n\nОтправьте *фото* лекарства (до ${MAX_PHOTOS} шт.):`, kb);
}

async function sendNotesPrompt(ctx, state) {
  const kb = new InlineKeyboard()
    .text(getSkipLabel('notes'), 'addmed:skip').row()
    .text('❌ Отмена', 'addmed:cancel');
  const header = buildStageHeader(state);
  await editBotMsg(ctx, state, `${header}\n\nДобавьте *заметки* (напр. «принимать после еды»):`, kb);
}

async function sendConfirmation(ctx, state) {
  const d = state.data;
  let s = `📋 *Проверьте данные:*\n\n`;
  s += `💊 *Название:* ${d.name}\n`;
  s += d.dosage ? `💉 *Дозировка:* ${d.dosage}\n` : `💉 *Дозировка:* —\n`;
  s += d.category ? `🏷 *Категория:* ${d.category}\n` : `🏷 *Категория:* —\n`;
  s += d.tags.length > 0 ? `🔖 *Теги:* ${d.tags.join(', ')}\n` : '';
  s += d.expiryDate ? `📅 *Срок:* ${formatDate(d.expiryDate)}\n` : `📅 *Срок:* —\n`;
  s += `📏 *Кол-во:* ${d.quantity > 0 ? formatQuantity(d.quantity, d.quantityUnit) : '—'}\n`;
  if (d.photoFileIds.length > 0) s += `📷 *Фото:* ${d.photoFileIds.length} шт.\n`;
  if (d.notes) s += `📝 *Заметки:* ${d.notes}\n`;

  s += '\n_Нажмите на поле, чтобы изменить:_';

  const kb = new InlineKeyboard()
    .text('✅ Сохранить', 'addmed:confirm')
    .row()
    .text('💊 Название', 'addmed:editfield:name')
    .text('💉 Дозировка', 'addmed:editfield:dosage')
    .row()
    .text('🏷 Категория', 'addmed:editfield:category')
    .text('📅 Срок', 'addmed:editfield:expiry')
    .row()
    .text('📏 Кол-во', 'addmed:editfield:quantity')
    .text('📷 Фото', 'addmed:editfield:photos')
    .row()
    .text('❌ Отмена', 'addmed:cancel');
  await editBotMsg(ctx, state, s, kb);
}
