import { InlineKeyboard } from 'grammy';
import { createSchedule, getMedicineSchedules, getSchedule, updateScheduleStatus, deleteSchedule } from '../db/queries/schedules.js';
import { getMedicine } from '../db/queries/medicines.js';
import { supabase } from '../db/supabase.js';
import { formatQuantity } from '../utils/format.js';
import { ensureExists } from '../utils/ensure.js';
import { withRetry } from '../utils/retry.js';
import { log } from '../utils/logger.js';

const DAY_VALUES = [1, 2, 3, 4, 5, 6, 0]; // ISO weekday to JS day

/**
 * Get day labels from i18n
 */
function getDayLabels(ctx) {
  return ctx.t('schedule.days_short');
}

/**
 * Get period label from i18n
 */
function getPeriodLabel(ctx, period) {
  return ctx.t(`schedule.period_${period}`);
}

/**
 * Get frequency label from i18n
 */
function getFreqLabel(ctx, freq) {
  const map = { daily: 'freq_daily', every_other_day: 'freq_every_other_day', weekly: 'freq_weekly' };
  return ctx.t(`schedule.${map[freq] || freq}`);
}

/**
 * Format schedule info for display
 */
function formatScheduleInfo(ctx, sched) {
  const dayLabels = getDayLabels(ctx);

  let timeStr;
  if (sched.time_mode === 'exact') {
    timeStr = `🕐 ${sched.time_value}`;
  } else {
    timeStr = getPeriodLabel(ctx, sched.time_value);
  }

  let freqStr = getFreqLabel(ctx, sched.frequency);
  if (sched.frequency === 'weekly' && sched.frequency_days?.length > 0) {
    const dayNames = sched.frequency_days.map(d => dayLabels[DAY_VALUES.indexOf(d)] || d).join(', ');
    freqStr += ` (${dayNames})`;
  }

  let durStr = '';
  if (sched.duration_type === 'indefinite') {
    durStr = ctx.t('schedule.duration_indefinite');
  } else if (sched.duration_type === 'days') {
    durStr = ctx.t('schedule.duration_days', { count: sched.duration_value });
  } else if (sched.duration_type === 'until_date') {
    const d = new Date(sched.duration_value);
    durStr = ctx.t('schedule.duration_until', { date: `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}` });
  }

  const statusEmoji = sched.status === 'active' ? ctx.t('schedule.status_active') : ctx.t('schedule.status_paused');

  return { timeStr, freqStr, durStr, statusEmoji };
}

/**
 * Show schedule list for a medicine
 */
async function showScheduleList(ctx, medId) {
  const med = await getMedicine(medId);
  if (!med) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery(ctx.t('medicine.not_found'));
    return;
  }

  const schedules = await getMedicineSchedules(medId);
  const keyboard = new InlineKeyboard();

  let text = ctx.t('schedule.list_title', { name: med.name }) + '\n';
  text += ctx.t('schedule.list_remainder', { quantity: formatQuantity(med.quantity, med.quantity_unit) }) + '\n\n';

  if (schedules.length === 0) {
    text += ctx.t('schedule.list_empty');
  } else {
    for (const sched of schedules) {
      const { timeStr, freqStr, durStr, statusEmoji } = formatScheduleInfo(ctx, sched);
      text += `${statusEmoji} ${timeStr} | ${sched.dose_per_intake} ${med.quantity_unit}\n`;
      text += `   ${freqStr} | ${durStr}\n\n`;

      // Pause/resume button
      if (sched.status === 'active') {
        keyboard.text(ctx.t('schedule.btn_pause'), `sched:${sched.id}:pause`);
      } else if (sched.status === 'paused') {
        keyboard.text(ctx.t('schedule.btn_resume'), `sched:${sched.id}:resume`);
      }
      keyboard.text('🗑', `sched:${sched.id}:del`);
      keyboard.row();
    }
  }

  keyboard.text(ctx.t('schedule.btn_add'), `sched:${medId}:create`);
  keyboard.row();
  keyboard.text(ctx.t('common.back'), `med:${medId}`);

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

  const dayLabels = getDayLabels(ctx);

  let timeStr;
  if (state.timeMode === 'exact') {
    timeStr = `🕐 ${state.timeValue}`;
  } else {
    timeStr = getPeriodLabel(ctx, state.timeValue);
  }

  let freqStr = getFreqLabel(ctx, state.frequency);
  if (state.frequency === 'weekly' && state.frequencyDays?.length > 0) {
    const dayNames = state.frequencyDays.map(d => dayLabels[DAY_VALUES.indexOf(d)] || d).join(', ');
    freqStr += ` (${dayNames})`;
  }

  let durStr = '';
  if (state.durationType === 'indefinite') {
    durStr = ctx.t('schedule.duration_indefinite');
  } else if (state.durationType === 'days') {
    durStr = ctx.t('schedule.duration_days', { count: state.durationValue });
  } else if (state.durationType === 'until_date') {
    durStr = ctx.t('schedule.duration_until', { date: state.durationValue });
  }

  const text =
    ctx.t('schedule.confirm_title') +
    `💊 ${med.name}${med.dosage ? ' ' + med.dosage : ''}\n` +
    `⏰ ${timeStr}\n` +
    ctx.t('schedule.confirm_dose', { dose: state.dosePerIntake, unit: med.quantity_unit }) + '\n' +
    `🔄 ${freqStr}\n` +
    `📅 ${durStr}\n\n` +
    ctx.t('schedule.confirm_ok');

  const keyboard = new InlineKeyboard()
    .text(ctx.t('schedule.btn_create'), 'sched:confirm:yes')
    .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`);

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
        ctx.t('schedule.time_invalid'),
        {
          reply_markup: new InlineKeyboard()
            .text(ctx.t('common.back'), `sched:${state.medId}:create`)
            .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
        }
      );
      return true;
    }

    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      await ctx.api.editMessageText(chatId, msgId,
        ctx.t('schedule.time_invalid_range'),
        {
          reply_markup: new InlineKeyboard()
            .text(ctx.t('common.back'), `sched:${state.medId}:create`)
            .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
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
      ctx.t('schedule.dose_prompt', { name: med?.name || '?', time: timeValue, unit: med?.quantity_unit || ctx.t('intake.default_unit') }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('1', 'sched:dose:1')
          .text('2', 'sched:dose:2')
          .text('3', 'sched:dose:3')
          .row()
          .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
      }
    );
    return true;
  }

  // Step: waiting for dose input
  if (state.step === 'dose') {
    const num = parseFloat(text);
    if (isNaN(num) || num <= 0) {
      await ctx.api.editMessageText(chatId, msgId,
        ctx.t('schedule.dose_invalid_positive'),
        {
          reply_markup: new InlineKeyboard()
            .text('1', 'sched:dose:1')
            .text('2', 'sched:dose:2')
            .text('3', 'sched:dose:3')
            .row()
            .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
        }
      );
      return true;
    }

    const newState = { ...state, step: 'frequency', dosePerIntake: num };
    await saveWizardState(ctx.dbUser.id, newState);

    await ctx.api.editMessageText(chatId, msgId,
      ctx.t('schedule.freq_prompt'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('schedule.btn_freq_daily'), 'sched:freq:daily')
          .row()
          .text(ctx.t('schedule.btn_freq_every_other'), 'sched:freq:every_other_day')
          .row()
          .text(ctx.t('schedule.btn_freq_weekly'), 'sched:freq:weekly')
          .row()
          .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
      }
    );
    return true;
  }

  // Step: waiting for duration days count
  if (state.step === 'duration_days') {
    const num = parseInt(text, 10);
    if (isNaN(num) || num <= 0) {
      await ctx.api.editMessageText(chatId, msgId,
        ctx.t('schedule.dur_days_invalid_int'),
        {
          reply_markup: new InlineKeyboard()
            .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
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
        ctx.t('schedule.dur_date_invalid_format'),
        {
          reply_markup: new InlineKeyboard()
            .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
        }
      );
      return true;
    }

    const [, day, month, year] = dateMatch;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    if (isNaN(d.getTime()) || d <= new Date()) {
      await ctx.api.editMessageText(chatId, msgId,
        ctx.t('schedule.dur_date_future'),
        {
          reply_markup: new InlineKeyboard()
            .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
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
      ctx.t('schedule.time_mode_prompt'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('schedule.btn_time_exact'), 'sched:time:exact')
          .text(ctx.t('schedule.btn_time_period'), 'sched:time:period')
          .row()
          .text(ctx.t('common.back'), `med:${medId}:schedule`)
          .text(ctx.t('common.cancel'), `med:${medId}`),
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
      ctx.t('schedule.time_prompt'),
      {
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.back'), `sched:${state.medId}:create`)
          .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
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
      ctx.t('schedule.period_select_prompt'),
      {
        reply_markup: new InlineKeyboard()
          .text(ctx.t('schedule.period_morning'), 'sched:period:morning')
          .text(ctx.t('schedule.period_afternoon'), 'sched:period:afternoon')
          .row()
          .text(ctx.t('schedule.period_evening'), 'sched:period:evening')
          .text(ctx.t('schedule.period_night'), 'sched:period:night')
          .row()
          .text(ctx.t('common.back'), `sched:${state.medId}:create`)
          .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
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
      ctx.t('schedule.dose_prompt', { name: med?.name || '?', time: getPeriodLabel(ctx, period), unit: med?.quantity_unit || ctx.t('intake.default_unit') }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('1', 'sched:dose:1')
          .text('2', 'sched:dose:2')
          .text('3', 'sched:dose:3')
          .row()
          .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
      }
    );
  });

  // Quick dose buttons
  bot.callbackQuery(/^sched:dose:(\d+)$/, async (ctx) => {
    const dose = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;

    const newState = { ...state, step: 'frequency', dosePerIntake: dose };
    await saveWizardState(ctx.dbUser.id, newState);

    await ctx.editMessageText(
      ctx.t('schedule.freq_prompt'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('schedule.btn_freq_daily'), 'sched:freq:daily')
          .row()
          .text(ctx.t('schedule.btn_freq_every_other'), 'sched:freq:every_other_day')
          .row()
          .text(ctx.t('schedule.btn_freq_weekly'), 'sched:freq:weekly')
          .row()
          .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
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
      ctx.t('schedule.duration_prompt_bold'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('schedule.btn_dur_indefinite'), 'sched:dur:indefinite')
          .row()
          .text(ctx.t('schedule.btn_dur_n_days'), 'sched:dur:days')
          .text(ctx.t('schedule.btn_dur_until_date'), 'sched:dur:until_date')
          .row()
          .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
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
      await ctx.answerCallbackQuery(ctx.t('schedule.days_select_one'));
      return;
    }

    await ctx.answerCallbackQuery();
    const newState = { ...state, step: 'duration' };
    await saveWizardState(ctx.dbUser.id, newState);

    await ctx.editMessageText(
      ctx.t('schedule.duration_prompt_bold'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('schedule.btn_dur_indefinite'), 'sched:dur:indefinite')
          .row()
          .text(ctx.t('schedule.btn_dur_n_days'), 'sched:dur:days')
          .text(ctx.t('schedule.btn_dur_until_date'), 'sched:dur:until_date')
          .row()
          .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
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
      ctx.t('schedule.dur_days_prompt'),
      {
        reply_markup: new InlineKeyboard()
          .text('7', 'sched:durdays:7')
          .text('14', 'sched:durdays:14')
          .text('30', 'sched:durdays:30')
          .row()
          .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
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
      ctx.t('schedule.dur_date_prompt'),
      {
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
      }
    );
  });

  // #29 Schedule conflict — user confirmed creation despite conflict
  bot.callbackQuery('sched:conflict:yes', async (ctx) => {
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;

    // Force-create (skip conflict check)
    try {
      // #48 Copy profile_id from medicine
      const med = await getMedicine(state.medId);
      const profileId = med?.profile_id || null;

      await withRetry(() => createSchedule({
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
        profileId,
      }));

      await clearWizardState(ctx.dbUser.id);

      await ctx.editMessageText(
        ctx.t('schedule.created_toast'),
        {
          reply_markup: new InlineKeyboard()
            .text(ctx.t('schedule.btn_to_schedules'), `med:${state.medId}:schedule`)
            .text(ctx.t('schedule.btn_to_medicine'), `med:${state.medId}`),
        }
      );
    } catch (e) {
      log('error', { action: 'create_schedule_conflict_override', error: e.message });
      await ctx.editMessageText(
        ctx.t('schedule.create_error'),
        {
          reply_markup: new InlineKeyboard().text(ctx.t('common.back'), `med:${state.medId}:schedule`),
        }
      );
    }
  });

  // Confirm creation
  bot.callbackQuery('sched:confirm:yes', async (ctx) => {
    await ctx.answerCallbackQuery();
    const state = await getWizardState(ctx.dbUser.id);
    if (!state || state.action !== 'create_schedule') return;

    // #29 Check for schedule conflicts before creating
    try {
      const { data: conflicts } = await supabase
        .from('schedules')
        .select('id')
        .eq('medicine_id', state.medId)
        .eq('time_value', state.timeValue)
        .eq('status', 'active');

      if (conflicts && conflicts.length > 0) {
        const med = await getMedicine(state.medId);
        const name = med?.name || '?';
        const time = state.timeMode === 'exact' ? state.timeValue : getPeriodLabel(ctx, state.timeValue);

        await ctx.editMessageText(
          ctx.t('schedule.conflict', { name, time }),
          {
            reply_markup: new InlineKeyboard()
              .text(ctx.t('schedule.btn_conflict_yes'), 'sched:conflict:yes')
              .text(ctx.t('common.cancel'), `med:${state.medId}:schedule`),
          }
        );
        return;
      }
    } catch (e) {
      log('error', { action: 'check_schedule_conflicts', error: e.message });
      // Proceed with creation if conflict check fails
    }

    try {
      // #48 Copy profile_id from medicine if it has one
      const med = await getMedicine(state.medId);
      const profileId = med?.profile_id || null;

      await withRetry(() => createSchedule({
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
        profileId,
      }));

      await clearWizardState(ctx.dbUser.id);

      await ctx.editMessageText(
        ctx.t('schedule.created_toast'),
        {
          reply_markup: new InlineKeyboard()
            .text(ctx.t('schedule.btn_to_schedules'), `med:${state.medId}:schedule`)
            .text(ctx.t('schedule.btn_to_medicine'), `med:${state.medId}`),
        }
      );
    } catch (e) {
      log('error', { action: 'create_schedule', error: e.message });
      await ctx.editMessageText(
        ctx.t('schedule.create_error'),
        {
          reply_markup: new InlineKeyboard().text(ctx.t('common.back'), `med:${state.medId}:schedule`),
        }
      );
    }
  });

  // #41 Resume single paused schedule (from restock suggestion)
  bot.callbackQuery(/^sched:resume:([0-9a-f-]+)$/, async (ctx) => {
    const schedId = ctx.match[1];
    await ctx.answerCallbackQuery();
    try {
      const sched = await updateScheduleStatus(schedId, 'active');
      const med = sched ? await getMedicine(sched.medicine_id) : null;
      if (med) {
        await showScheduleList(ctx, med.id);
      }
    } catch (e) {
      log('error', { action: 'resume_schedule_restock', error: e.message });
      await ctx.answerCallbackQuery(ctx.t('schedule.error_generic'));
    }
  });

  // #41 Resume all paused schedules for a medicine (from restock suggestion)
  bot.callbackQuery(/^sched:resume_all:([0-9a-f-]+)$/, async (ctx) => {
    const medId = ctx.match[1];
    await ctx.answerCallbackQuery();
    const { data: pausedScheds } = await supabase
      .from('schedules')
      .select('id')
      .eq('medicine_id', medId)
      .eq('status', 'paused');
    if (pausedScheds && pausedScheds.length > 0) {
      await supabase
        .from('schedules')
        .update({ status: 'active' })
        .in('id', pausedScheds.map(s => s.id));
    }
    await showScheduleList(ctx, medId);
  });

  // Pause schedule
  bot.callbackQuery(/^sched:([0-9a-f-]+):pause$/, async (ctx) => {
    const schedId = ctx.match[1];
    await ctx.answerCallbackQuery();
    try {
      const sched = await updateScheduleStatus(schedId, 'paused');
      await showScheduleList(ctx, sched.medicine_id);
    } catch (e) {
      log('error', { action: 'pause_schedule', error: e.message });
      await ctx.answerCallbackQuery(ctx.t('schedule.error_generic'));
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
      log('error', { action: 'resume_schedule', error: e.message });
      await ctx.answerCallbackQuery(ctx.t('schedule.error_generic'));
    }
  });

  // Delete schedule — confirm
  bot.callbackQuery(/^sched:([0-9a-f-]+):del$/, async (ctx) => {
    const schedId = ctx.match[1];
    const sched = await getSchedule(schedId);
    // #65 Stale callback guard
    if (!await ensureExists(sched, ctx)) return;
    await ctx.answerCallbackQuery();

    await ctx.editMessageText(
      ctx.t('schedule.delete_confirm'),
      {
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.yes_delete'), `sched:${schedId}:del:confirm`)
          .text(ctx.t('common.no'), `med:${sched.medicine_id}:schedule`),
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
      await ctx.answerCallbackQuery(ctx.t('schedule.delete_toast'));
    } catch (e) {
      log('error', { action: 'delete_schedule', error: e.message });
      await ctx.answerCallbackQuery(ctx.t('schedule.error_generic'));
      return;
    }

    if (medId) {
      await showScheduleList(ctx, medId);
    } else {
      await ctx.editMessageText(ctx.t('schedule.delete_done'), {
        reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'main_menu'),
      });
    }
  });

  // #43 Adaptive reminder — shift schedule time earlier
  bot.callbackQuery(/^sched:shift:([0-9a-f-]+)$/, async (ctx) => {
    const schedId = ctx.match[1];
    await ctx.answerCallbackQuery();
    try {
      const sched = await getSchedule(schedId);
      if (!sched || sched.time_mode !== 'exact') {
        await ctx.editMessageText(ctx.t('common.error'), {
          reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'main_menu'),
        });
        return;
      }

      // Compute average early minutes from action_logs
      const { data: suggestLog } = await supabase
        .from('action_logs')
        .select('details')
        .eq('action', 'adaptive_suggest')
        .eq('entity_id', schedId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      const avgEarlyMin = suggestLog?.details?.avg_early_minutes || 10;

      // Parse time_value and shift earlier
      const [hours, minutes] = sched.time_value.split(':').map(Number);
      let totalMin = hours * 60 + minutes - avgEarlyMin;
      if (totalMin < 0) totalMin += 1440;
      const newH = Math.floor(totalMin / 60) % 24;
      const newM = totalMin % 60;
      const newTime = `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;

      await supabase
        .from('schedules')
        .update({ time_value: newTime })
        .eq('id', schedId);

      const med = await getMedicine(sched.medicine_id);
      await ctx.editMessageText(
        ctx.t('common.updated') + `\n\n${med?.name || '?'}: ${sched.time_value} -> ${newTime}`,
        {
          reply_markup: new InlineKeyboard().text(ctx.t('common.main_menu'), 'main_menu'),
        }
      );
    } catch (e) {
      log('error', { action: 'shift_schedule', schedId, error: e.message });
      await ctx.editMessageText(ctx.t('common.error'), {
        reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'main_menu'),
      });
    }
  });
}

/**
 * Show weekly day multi-selector
 */
async function showWeeklyDaySelector(ctx, selectedDays) {
  const dayLabels = getDayLabels(ctx);
  const keyboard = new InlineKeyboard();

  // Row 1: Mon-Thu
  for (let i = 0; i < 4; i++) {
    const dayVal = DAY_VALUES[i];
    const label = selectedDays.includes(dayVal) ? `✅ ${dayLabels[i]}` : dayLabels[i];
    keyboard.text(label, `sched:day:${dayVal}`);
  }
  keyboard.row();

  // Row 2: Fri-Sun
  for (let i = 4; i < 7; i++) {
    const dayVal = DAY_VALUES[i];
    const label = selectedDays.includes(dayVal) ? `✅ ${dayLabels[i]}` : dayLabels[i];
    keyboard.text(label, `sched:day:${dayVal}`);
  }
  keyboard.row();

  keyboard.text(ctx.t('common.done'), 'sched:days:done');
  keyboard.row();

  const state = await getWizardState(ctx.dbUser.id);
  keyboard.text(ctx.t('common.cancel'), `med:${state?.medId}:schedule`);

  const selectedStr = selectedDays.length > 0
    ? selectedDays.map(d => dayLabels[DAY_VALUES.indexOf(d)]).join(', ')
    : ctx.t('schedule.days_none');

  await ctx.editMessageText(
    ctx.t('schedule.days_prompt', { selected: selectedStr }),
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}
