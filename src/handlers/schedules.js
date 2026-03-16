import { InlineKeyboard } from 'grammy';
import { createSchedule, getMedicineSchedules, getSchedule, updateScheduleStatus, deleteSchedule } from '../db/queries/schedules.js';
import { getMedicine } from '../db/queries/medicines.js';
import { supabase } from '../db/supabase.js';
import { formatQuantity, getDaysWord, formatProgressBar } from '../utils/format.js';

// P3.4: Schedule wizard step labels and progress
const SCHED_STEPS = ['time', 'dose', 'frequency', 'duration', 'confirm'];
const SCHED_STEP_LABELS = { time: 'Время', dose: 'Доза', frequency: 'Частота', duration: 'Длительность', confirm: 'Подтверждение' };

function schedStageHeader(stepName) {
  const idx = SCHED_STEPS.indexOf(stepName);
  if (idx < 0) return '';
  const bar = formatProgressBar(idx + 1, SCHED_STEPS.length, 10);
  return `📆 *Курс приёма*\n${bar} ${SCHED_STEP_LABELS[stepName] || ''}`;
}

/**
 * Day of week labels (Russian, short)
 */
const DAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DAY_VALUES = [1, 2, 3, 4, 5, 6, 0]; // ISO weekday to JS day

/**
 * Period labels
 */
const PERIOD_LABELS = {
  morning: '🌅 Утро',
  afternoon: '☀️ День',
  evening: '🌆 Вечер',
  night: '🌙 Ночь',
};

/**
 * Frequency labels
 */
const FREQ_LABELS = {
  daily: 'Ежедневно',
  every_other_day: 'Через день',
  weekly: 'По дням недели',
};

/**
 * Format schedule info for display
 */
function formatScheduleInfo(sched) {
  let timeStr;
  if (sched.time_mode === 'exact') {
    timeStr = `🕐 ${sched.time_value}`;
  } else {
    timeStr = PERIOD_LABELS[sched.time_value] || sched.time_value;
  }

  let freqStr = FREQ_LABELS[sched.frequency] || sched.frequency;
  if (sched.frequency === 'weekly' && sched.frequency_days?.length > 0) {
    const dayNames = sched.frequency_days.map(d => DAY_LABELS[DAY_VALUES.indexOf(d)] || d).join(', ');
    freqStr += ` (${dayNames})`;
  }

  let durStr = '';
  if (sched.duration_type === 'indefinite') {
    durStr = '♾ Бессрочно';
  } else if (sched.duration_type === 'days') {
    durStr = `📅 ${sched.duration_value} ${getDaysWord(sched.duration_value)}`;
  } else if (sched.duration_type === 'until_date') {
    const d = new Date(sched.duration_value);
    durStr = `📅 До ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  }

  const statusEmoji = sched.status === 'active' ? '▶️' : '⏸';

  return { timeStr, freqStr, durStr, statusEmoji };
}

/**
 * Show schedule list for a medicine
 */
async function showScheduleList(ctx, medId) {
  const med = await getMedicine(medId);
  if (!med) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery('Лекарство не найдено');
    return;
  }

  const schedules = await getMedicineSchedules(medId);
  const keyboard = new InlineKeyboard();

  let text = `📆 *Курсы приёма: ${med.name}*\n`;
  text += `📏 Остаток: ${formatQuantity(med.quantity, med.quantity_unit)}\n\n`;

  if (schedules.length === 0) {
    text += 'Нет активных курсов.\n';
  } else {
    for (const sched of schedules) {
      const { timeStr, freqStr, durStr, statusEmoji } = formatScheduleInfo(sched);
      text += `${statusEmoji} ${timeStr} | ${sched.dose_per_intake} ${med.quantity_unit}\n`;
      text += `   ${freqStr} | ${durStr}\n\n`;

      // Pause/resume button
      if (sched.status === 'active') {
        keyboard.text('⏸ Пауза', `sched:${sched.id}:pause`);
      } else if (sched.status === 'paused') {
        keyboard.text('▶️ Возобновить', `sched:${sched.id}:resume`);
      }
      keyboard.text('🗑 Удалить', `sched:${sched.id}:del`);
      keyboard.row();
    }
  }

  keyboard.text('➕ Добавить курс', `sched:${medId}:create`);
  keyboard.row();
  keyboard.text('◀️ Назад', `med:${medId}`);

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Save wizard state to sessions
 */
async function saveWizardState(userId, state) {
  await supabase.from('sessions').upsert(
    {
      key: `state:${userId}`,
      value: state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );
}

/**
 * Get wizard state
 */
async function getWizardState(userId) {
  const { data } = await supabase
    .from('sessions')
    .select('value')
    .eq('key', `state:${userId}`)
    .single();
  return data?.value ?? null;
}

/**
 * Clear wizard state
 */
async function clearWizardState(userId) {
  await supabase.from('sessions').delete().eq('key', `state:${userId}`);
}

/**
 * Show confirmation screen
 */
async function showConfirmation(ctx, state, msgId) {
  const med = await getMedicine(state.medId);
  if (!med) return;

  let timeStr;
  if (state.timeMode === 'exact') {
    timeStr = `🕐 ${state.timeValue}`;
  } else {
    timeStr = PERIOD_LABELS[state.timeValue] || state.timeValue;
  }

  let freqStr = FREQ_LABELS[state.frequency] || state.frequency;
  if (state.frequency === 'weekly' && state.frequencyDays?.length > 0) {
    const dayNames = state.frequencyDays.map(d => DAY_LABELS[DAY_VALUES.indexOf(d)] || d).join(', ');
    freqStr += ` (${dayNames})`;
  }

  let durStr = '';
  if (state.durationType === 'indefinite') {
    durStr = '♾ Бессрочно';
  } else if (state.durationType === 'days') {
    durStr = `📅 ${state.durationValue} ${getDaysWord(state.durationValue)}`;
  } else if (state.durationType === 'until_date') {
    durStr = `📅 До ${state.durationValue}`;
  }

  let stockInfo = `📏 Остаток: ${formatQuantity(med.quantity, med.quantity_unit)}`;
  if (state.durationType === 'days' && state.frequency !== 'weekly') {
    const dailyDose = state.frequency === 'every_other_day' ? state.dosePerIntake / 2 : state.dosePerIntake;
    const totalNeeded = dailyDose * state.durationValue;
    if (totalNeeded > med.quantity) {
      stockInfo += ` ⚠️ _может не хватить_`;
    }
  }

  const text =
    `📋 *Подтверждение курса*\n\n` +
    `💊 ${med.name}${med.dosage ? ' ' + med.dosage : ''}\n` +
    `⏰ ${timeStr}\n` +
    `💊 Доза: ${state.dosePerIntake} ${med.quantity_unit}\n` +
    `🔄 ${freqStr}\n` +
    `📅 ${durStr}\n` +
    `${stockInfo}\n\n` +
    `Всё верно?`;

  const keyboard = new InlineKeyboard()
    .text('✅ Создать', 'sched:confirm:yes')
    .text('◀️ Назад', 'sched:back:dur');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else if (msgId) {
    await ctx.api.editMessageText(ctx.chat.id, msgId, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}

/**
 * Handle text input for the schedule creation wizard.
 * Called from textState.js.
 * Returns true if handled.
 */
export async function handleScheduleText(ctx) {
  const state = await getWizardState(ctx.dbUser.id);
  if (!state || state.action !== 'create_schedule') return false;

  const text = ctx.message.text.trim();
  if (!text || text.startsWith('/')) return false;

  try { await ctx.deleteMessage(); } catch { /* ignore */ }

  const msgId = state.msgId;
  const chatId = ctx.chat.id;

  // Step: waiting for exact time input
  if (state.step === 'time_exact') {
    const timeMatch = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      await ctx.api.editMessageText(chatId, msgId,
        '⚠️ Неверный формат. Введите время в формате ЧЧ:ММ (например, 08:30):',
        {
          reply_markup: new InlineKeyboard()
            .text('◀️ Назад', `sched:${state.medId}:create`)
            .text('❌ Отмена', `med:${state.medId}:schedule`),
        }
      );
      return true;
    }

    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      await ctx.api.editMessageText(chatId, msgId,
        '⚠️ Некорректное время. Введите в формате ЧЧ:ММ:',
        {
          reply_markup: new InlineKeyboard()
            .text('◀️ Назад', `sched:${state.medId}:create`)
            .text('❌ Отмена', `med:${state.medId}:schedule`),
        }
      );
      return true;
    }

    const timeValue = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

    // Move to dose step
    const newState = { ...state, step: 'dose', timeMode: 'exact', timeValue };
    await saveWizardState(ctx.dbUser.id, newState);

    const med = await getMedicine(state.medId);
    await ctx.api.editMessageText(chatId, msgId,
      `💊 *Доза за приём*\n\nЛекарство: ${med?.name || '?'}\nВремя: ${timeValue}\n\nВведите количество (${med?.quantity_unit || 'шт'}) за один приём:`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('0.5', 'sched:dose:0.5')
          .text('1', 'sched:dose:1')
          .text('2', 'sched:dose:2')
          .text('3', 'sched:dose:3')
          .row()
          .text('◀️ Назад', 'sched:back:time')
          .text('❌ Отмена', `med:${state.medId}:schedule`),
      }
    );
    return true;
  }

  // Step: waiting for dose input
  if (state.step === 'dose') {
    const num = parseFloat(text);
    if (isNaN(num) || num <= 0) {
      await ctx.api.editMessageText(chatId, msgId,
        '⚠️ Введите положительное число:',
        {
          reply_markup: new InlineKeyboard()
            .text('0.5', 'sched:dose:0.5')
            .text('1', 'sched:dose:1')
            .text('2', 'sched:dose:2')
            .text('3', 'sched:dose:3')
            .row()
            .text('◀️ Назад', 'sched:back:time')
            .text('❌ Отмена', `med:${state.medId}:schedule`),
        }
      );
      return true;
    }

    const newState = { ...state, step: 'frequency', dosePerIntake: num };
    await saveWizardState(ctx.dbUser.id, newState);

    await ctx.api.editMessageText(chatId, msgId,
      '🔄 *Частота приёма:*',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('Ежедневно', 'sched:freq:daily')
          .row()
          .text('Через день', 'sched:freq:every_other_day')
          .row()
          .text('По дням недели', 'sched:freq:weekly')
          .row()
          .text('◀️ Назад', 'sched:back:dose')
          .text('❌ Отмена', `med:${state.medId}:schedule`),
      }
    );
    return true;
  }

  // Step: waiting for duration days count
  if (state.step === 'duration_days') {
    const num = parseInt(text, 10);
    if (isNaN(num) || num <= 0) {
      await ctx.api.editMessageText(chatId, msgId,
        '⚠️ Введите положительное целое число дней:',
        {
          reply_markup: new InlineKeyboard()
            .text('◀️ Назад', 'sched:back:dur')
            .text('❌ Отмена', `med:${state.medId}:schedule`),
        }
      );
      return true;
    }

    const newState = { ...state, step: 'confirm', durationType: 'days', durationValue: num };
    await saveWizardState(ctx.dbUser.id, newState);
    await showConfirmation(ctx, newState, msgId);
    return true;
  }

  // Step: waiting for duration date
  if (state.step === 'duration_date') {
    const dateMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!dateMatch) {
      await ctx.api.editMessageText(chatId, msgId,
        '⚠️ Введите дату в формате ДД.ММ.ГГГГ:',
        {
          reply_markup: new InlineKeyboard()
            .text('◀️ Назад', 'sched:back:dur')
            .text('❌ Отмена', `med:${state.medId}:schedule`),
        }
      );
      return true;
    }

    const [, day, month, year] = dateMatch;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (isNaN(d.getTime()) || d < today) {
      await ctx.api.editMessageText(chatId, msgId,
        '⚠️ Дата должна быть сегодня или позже. Введите в формате ДД.ММ.ГГГГ:',
        {
          reply_markup: new InlineKeyboard()
            .text('◀️ Назад', 'sched:back:dur')
            .text('❌ Отмена', `med:${state.medId}:schedule`),
        }
      );
      return true;
    }

    const dateStr = d.toISOString().split('T')[0];
    const displayDate = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    const newState = { ...state, step: 'confirm', durationType: 'until_date', durationValue: dateStr, durationDisplay: displayDate };
    await saveWizardState(ctx.dbUser.id, newState);
    await showConfirmation(ctx, { ...newState, durationValue: displayDate }, msgId);
    return true;
  }

  return false;
}

/**
 * Register schedule handlers
 */
export function registerScheduleHandlers(bot) {
  // Show schedule list for medicine
  bot.callbackQuery(/^med:([0-9a-f-]+):schedule$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showScheduleList(ctx, ctx.match[1]);
  });

  // Start create schedule wizard — step 1: time mode
  bot.callbackQuery(/^sched:([0-9a-f-]+):create$/, async (ctx) => {
    const medId = ctx.match[1];
    await ctx.answerCallbackQuery();

    await saveWizardState(ctx.dbUser.id, {
      action: 'create_schedule',
      medId,
      step: 'time_mode',
      msgId: ctx.callbackQuery.message.message_id,
    });

    await ctx.editMessageText(
      '⏰ *Когда принимать?*\n\nВыберите режим:',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('🕐 Точное время', 'sched:time:exact')
          .text('🌅 Период дня', 'sched:time:period')
          .row()
          .text('◀️ Назад', `med:${medId}:schedule`),
      }
    );
  });

  // --- Back navigation handlers ---
  bot.callbackQuery('sched:back:time', async (ctx) => {
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;
    const newState = { ...state, step: 'time_mode' };
    await saveWizardState(ctx.dbUser.id, newState);
    await ctx.editMessageText(
      '⏰ *Когда принимать?*\n\nВыберите режим:',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('🕐 Точное время', 'sched:time:exact')
          .text('🌅 Период дня', 'sched:time:period')
          .row()
          .text('◀️ Назад', `med:${state.medId}:schedule`),
      }
    );
  });

  bot.callbackQuery('sched:back:dose', async (ctx) => {
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;
    const newState = { ...state, step: 'dose' };
    await saveWizardState(ctx.dbUser.id, newState);
    const med = await getMedicine(state.medId);
    const timeDisplay = state.timeMode === 'exact' ? state.timeValue : (PERIOD_LABELS[state.timeValue] || state.timeValue);
    await ctx.editMessageText(
      `💊 *Доза за приём*\n\nЛекарство: ${med?.name || '?'}\nВремя: ${timeDisplay}\n\nВведите количество (${med?.quantity_unit || 'шт'}) за один приём:`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('0.5', 'sched:dose:0.5')
          .text('1', 'sched:dose:1')
          .text('2', 'sched:dose:2')
          .text('3', 'sched:dose:3')
          .row()
          .text('◀️ Назад', 'sched:back:time')
          .text('❌ Отмена', `med:${state.medId}:schedule`),
      }
    );
  });

  bot.callbackQuery('sched:back:freq', async (ctx) => {
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;
    const newState = { ...state, step: 'frequency' };
    await saveWizardState(ctx.dbUser.id, newState);
    await ctx.editMessageText(
      '🔄 *Частота приёма:*',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('Ежедневно', 'sched:freq:daily')
          .row()
          .text('Через день', 'sched:freq:every_other_day')
          .row()
          .text('По дням недели', 'sched:freq:weekly')
          .row()
          .text('◀️ Назад', 'sched:back:dose')
          .text('❌ Отмена', `med:${state.medId}:schedule`),
      }
    );
  });

  bot.callbackQuery('sched:back:weekdays', async (ctx) => {
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;
    const newState = { ...state, step: 'weekly_days' };
    await saveWizardState(ctx.dbUser.id, newState);
    await showWeeklyDaySelector(ctx, state.frequencyDays || []);
  });

  bot.callbackQuery('sched:back:dur', async (ctx) => {
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;
    const newState = { ...state, step: 'duration' };
    await saveWizardState(ctx.dbUser.id, newState);
    await ctx.editMessageText(
      '📅 *Длительность курса:*',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('♾ Бессрочно', 'sched:dur:indefinite')
          .row()
          .text('📅 Кол-во дней', 'sched:dur:days')
          .text('📅 До даты', 'sched:dur:until_date')
          .row()
          .text('◀️ Назад', state.frequency === 'weekly' ? 'sched:back:weekdays' : 'sched:back:freq')
          .text('❌ Отмена', `med:${state.medId}:schedule`),
      }
    );
  });

  // Time mode: exact → ask for time text
  bot.callbackQuery('sched:time:exact', async (ctx) => {
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;

    const newState = { ...state, step: 'time_exact' };
    await saveWizardState(ctx.dbUser.id, newState);

    await ctx.editMessageText(
      '🕐 Введите время в формате ЧЧ:ММ (например, 08:30):',
      {
        reply_markup: new InlineKeyboard()
          .text('◀️ Назад', `sched:${state.medId}:create`)
          .text('❌ Отмена', `med:${state.medId}:schedule`),
      }
    );
  });

  // Time mode: period → show period buttons
  bot.callbackQuery('sched:time:period', async (ctx) => {
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;

    const newState = { ...state, step: 'time_period' };
    await saveWizardState(ctx.dbUser.id, newState);

    await ctx.editMessageText(
      '🌅 Выберите период дня:',
      {
        reply_markup: new InlineKeyboard()
          .text('🌅 Утро', 'sched:period:morning')
          .text('☀️ День', 'sched:period:afternoon')
          .row()
          .text('🌆 Вечер', 'sched:period:evening')
          .text('🌙 Ночь', 'sched:period:night')
          .row()
          .text('◀️ Назад', `sched:${state.medId}:create`)
          .text('❌ Отмена', `med:${state.medId}:schedule`),
      }
    );
  });

  // Period selected
  bot.callbackQuery(/^sched:period:(morning|afternoon|evening|night)$/, async (ctx) => {
    const period = ctx.match[1];
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;

    const med = await getMedicine(state.medId);
    const newState = { ...state, step: 'dose', timeMode: 'period', timeValue: period };
    await saveWizardState(ctx.dbUser.id, newState);

    await ctx.editMessageText(
      `💊 *Доза за приём*\n\nЛекарство: ${med?.name || '?'}\nВремя: ${PERIOD_LABELS[period]}\n\nВведите количество (${med?.quantity_unit || 'шт'}) за один приём:`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('0.5', 'sched:dose:0.5')
          .text('1', 'sched:dose:1')
          .text('2', 'sched:dose:2')
          .text('3', 'sched:dose:3')
          .row()
          .text('◀️ Назад', 'sched:back:time')
          .text('❌ Отмена', `med:${state.medId}:schedule`),
      }
    );
  });

  // Quick dose buttons
  bot.callbackQuery(/^sched:dose:([\d.]+)$/, async (ctx) => {
    const dose = parseFloat(ctx.match[1]);
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;

    const newState = { ...state, step: 'frequency', dosePerIntake: dose };
    await saveWizardState(ctx.dbUser.id, newState);

    await ctx.editMessageText(
      '🔄 *Частота приёма:*',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('Ежедневно', 'sched:freq:daily')
          .row()
          .text('Через день', 'sched:freq:every_other_day')
          .row()
          .text('По дням недели', 'sched:freq:weekly')
          .row()
          .text('◀️ Назад', 'sched:back:dose')
          .text('❌ Отмена', `med:${state.medId}:schedule`),
      }
    );
  });

  // Frequency: daily or every_other_day → go to duration
  bot.callbackQuery(/^sched:freq:(daily|every_other_day)$/, async (ctx) => {
    const frequency = ctx.match[1];
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;

    const newState = { ...state, step: 'duration', frequency, frequencyDays: [] };
    await saveWizardState(ctx.dbUser.id, newState);

    await ctx.editMessageText(
      '📅 *Длительность курса:*',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('♾ Бессрочно', 'sched:dur:indefinite')
          .row()
          .text('📅 Кол-во дней', 'sched:dur:days')
          .text('📅 До даты', 'sched:dur:until_date')
          .row()
          .text('◀️ Назад', 'sched:back:freq')
          .text('❌ Отмена', `med:${state.medId}:schedule`),
      }
    );
  });

  // Frequency: weekly → show day selector
  bot.callbackQuery('sched:freq:weekly', async (ctx) => {
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;

    const newState = { ...state, step: 'weekly_days', frequency: 'weekly', frequencyDays: [] };
    await saveWizardState(ctx.dbUser.id, newState);

    await showWeeklyDaySelector(ctx, []);
  });

  // Toggle day in weekly selector
  bot.callbackQuery(/^sched:day:(\d)$/, async (ctx) => {
    const dayValue = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule' || state.step !== 'weekly_days') return;

    let days = state.frequencyDays || [];
    if (days.includes(dayValue)) {
      days = days.filter(d => d !== dayValue);
    } else {
      days.push(dayValue);
      days.sort((a, b) => {
        // Sort Mon-Sun (1,2,3,4,5,6,0)
        const order = [1, 2, 3, 4, 5, 6, 0];
        return order.indexOf(a) - order.indexOf(b);
      });
    }

    const newState = { ...state, frequencyDays: days };
    await saveWizardState(ctx.dbUser.id, newState);
    await showWeeklyDaySelector(ctx, days);
  });

  // Confirm weekly days → go to duration
  bot.callbackQuery('sched:days:done', async (ctx) => {
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;

    if (!state.frequencyDays || state.frequencyDays.length === 0) {
      await ctx.answerCallbackQuery('Выберите хотя бы один день');
      return;
    }

    await ctx.answerCallbackQuery();
    const newState = { ...state, step: 'duration' };
    await saveWizardState(ctx.dbUser.id, newState);

    await ctx.editMessageText(
      '📅 *Длительность курса:*',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('♾ Бессрочно', 'sched:dur:indefinite')
          .row()
          .text('📅 Кол-во дней', 'sched:dur:days')
          .text('📅 До даты', 'sched:dur:until_date')
          .row()
          .text('◀️ Назад', 'sched:back:weekdays')
          .text('❌ Отмена', `med:${state.medId}:schedule`),
      }
    );
  });

  // Duration: indefinite → confirm
  bot.callbackQuery('sched:dur:indefinite', async (ctx) => {
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;

    const newState = { ...state, step: 'confirm', durationType: 'indefinite', durationValue: null };
    await saveWizardState(ctx.dbUser.id, newState);
    await showConfirmation(ctx, newState);
  });

  // Duration: N days → ask for number
  bot.callbackQuery('sched:dur:days', async (ctx) => {
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;

    const newState = { ...state, step: 'duration_days' };
    await saveWizardState(ctx.dbUser.id, newState);

    await ctx.editMessageText(
      '📅 Введите количество дней курса:',
      {
        reply_markup: new InlineKeyboard()
          .text('7', 'sched:durdays:7')
          .text('14', 'sched:durdays:14')
          .text('30', 'sched:durdays:30')
          .row()
          .text('◀️ Назад', 'sched:back:dur')
          .text('❌ Отмена', `med:${state.medId}:schedule`),
      }
    );
  });

  // Quick duration day buttons
  bot.callbackQuery(/^sched:durdays:(\d+)$/, async (ctx) => {
    const days = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;

    const newState = { ...state, step: 'confirm', durationType: 'days', durationValue: days };
    await saveWizardState(ctx.dbUser.id, newState);
    await showConfirmation(ctx, newState);
  });

  // Duration: until date → ask for date
  bot.callbackQuery('sched:dur:until_date', async (ctx) => {
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;

    const newState = { ...state, step: 'duration_date' };
    await saveWizardState(ctx.dbUser.id, newState);

    await ctx.editMessageText(
      '📅 Введите дату окончания курса в формате ДД.ММ.ГГГГ:',
      {
        reply_markup: new InlineKeyboard()
          .text('◀️ Назад', 'sched:back:dur')
          .text('❌ Отмена', `med:${state.medId}:schedule`),
      }
    );
  });

  // Confirm creation
  bot.callbackQuery('sched:confirm:yes', async (ctx) => {
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;

    try {
      await createSchedule({
        medicineId: state.medId,
        userId: ctx.dbUser.id,
        timeMode: state.timeMode,
        timeValue: state.timeValue,
        dosePerIntake: state.dosePerIntake,
        frequency: state.frequency,
        frequencyDays: state.frequencyDays || [],
        durationType: state.durationType,
        durationValue: state.durationType === 'until_date' ? state.durationValue : (state.durationValue || null),
        startDate: new Date().toISOString().split('T')[0],
      });

      await clearWizardState(ctx.dbUser.id);

      // P3.5: Add "Ещё курс" button after creation
      await ctx.editMessageText(
        '✅ Курс приёма создан!',
        {
          reply_markup: new InlineKeyboard()
            .text('➕ Ещё курс', `sched:${state.medId}:create`)
            .row()
            .text('📆 К курсам', `med:${state.medId}:schedule`)
            .text('◀️ К лекарству', `med:${state.medId}`),
        }
      );
    } catch (e) {
      console.error('Error creating schedule:', e);
      await ctx.editMessageText(
        '❌ Ошибка при создании курса.',
        {
          reply_markup: new InlineKeyboard().text('◀️ Назад', `med:${state.medId}:schedule`),
        }
      );
    }
  });

  // Pause schedule
  bot.callbackQuery(/^sched:([0-9a-f-]+):pause$/, async (ctx) => {
    const schedId = ctx.match[1];
    await ctx.answerCallbackQuery();
    try {
      const sched = await updateScheduleStatus(schedId, 'paused');
      await showScheduleList(ctx, sched.medicine_id);
    } catch (e) {
      console.error('Error pausing schedule:', e);
      await ctx.answerCallbackQuery('Ошибка');
    }
  });

  // Resume schedule
  bot.callbackQuery(/^sched:([0-9a-f-]+):resume$/, async (ctx) => {
    const schedId = ctx.match[1];
    await ctx.answerCallbackQuery();
    try {
      const sched = await updateScheduleStatus(schedId, 'active');
      await showScheduleList(ctx, sched.medicine_id);
    } catch (e) {
      console.error('Error resuming schedule:', e);
      await ctx.answerCallbackQuery('Ошибка');
    }
  });

  // Delete schedule — confirm
  bot.callbackQuery(/^sched:([0-9a-f-]+):del$/, async (ctx) => {
    const schedId = ctx.match[1];
    await ctx.answerCallbackQuery();
    const sched = await getSchedule(schedId);
    if (!sched) return;

    await ctx.editMessageText(
      `🗑 Удалить курс приёма?`,
      {
        reply_markup: new InlineKeyboard()
          .text('✅ Да, удалить', `sched:${schedId}:del:confirm`)
          .text('❌ Нет', `med:${sched.medicine_id}:schedule`),
      }
    );
  });

  // Delete schedule — confirmed
  bot.callbackQuery(/^sched:([0-9a-f-]+):del:confirm$/, async (ctx) => {
    const schedId = ctx.match[1];
    const sched = await getSchedule(schedId);
    const medId = sched?.medicine_id;

    try {
      await deleteSchedule(schedId);
      await ctx.answerCallbackQuery('Курс удалён');
    } catch (e) {
      console.error('Error deleting schedule:', e);
      await ctx.answerCallbackQuery('Ошибка');
      return;
    }

    if (medId) {
      await showScheduleList(ctx, medId);
    } else {
      await ctx.editMessageText('✅ Курс удалён.', {
        reply_markup: new InlineKeyboard().text('◀️ Назад', 'main_menu'),
      });
    }
  });
}

/**
 * Show weekly day multi-selector
 */
async function showWeeklyDaySelector(ctx, selectedDays) {
  const keyboard = new InlineKeyboard();

  // Row 1: Mon-Thu
  for (let i = 0; i < 4; i++) {
    const dayVal = DAY_VALUES[i];
    const label = selectedDays.includes(dayVal) ? `✅ ${DAY_LABELS[i]}` : DAY_LABELS[i];
    keyboard.text(label, `sched:day:${dayVal}`);
  }
  keyboard.row();

  // Row 2: Fri-Sun
  for (let i = 4; i < 7; i++) {
    const dayVal = DAY_VALUES[i];
    const label = selectedDays.includes(dayVal) ? `✅ ${DAY_LABELS[i]}` : DAY_LABELS[i];
    keyboard.text(label, `sched:day:${dayVal}`);
  }
  keyboard.row();

  keyboard.text('✅ Готово', 'sched:days:done');
  keyboard.row();

  const state = await getWizardState(ctx.dbUser.id);
  keyboard.text('◀️ Назад', 'sched:back:freq');
  keyboard.text('❌ Отмена', `med:${state?.medId}:schedule`);

  const selectedStr = selectedDays.length > 0
    ? selectedDays.map(d => DAY_LABELS[DAY_VALUES.indexOf(d)]).join(', ')
    : 'ничего не выбрано';

  await ctx.editMessageText(
    `📅 *Выберите дни недели:*\n\nВыбрано: ${selectedStr}`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}
