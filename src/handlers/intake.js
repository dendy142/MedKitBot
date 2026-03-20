import { InlineKeyboard } from 'grammy';
import { getTodayIntakeLogs, markIntakeTaken, markIntakeSkipped, getIntakeLogsForPeriod } from '../db/queries/intakeLogs.js';
import { getMedicine, updateMedicine } from '../db/queries/medicines.js';
import { getSchedule } from '../db/queries/schedules.js';
import { addToShoppingList } from '../db/queries/shoppingList.js';
import { supabase } from '../db/supabase.js';
import { formatQuantity } from '../utils/format.js';
import { checkAchievements, calculateCurrentStreak } from './achievements.js';
import { withRetry } from '../utils/retry.js';
import { log } from '../utils/logger.js';

function formatTime(plannedAt) {
  const d = new Date(plannedAt);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function statusEmoji(status) {
  switch (status) {
    case 'taken': return '✅';
    case 'skipped': return '❌';
    case 'snoozed': return '⏰';
    default: return '⏳';
  }
}

async function checkAutoShoppingList(ctx, med, newQty) {
  try {
    const settings = ctx.dbUser?.settings || {};
    if (!settings.autoShoppingList) return;
    const thresholds = settings.thresholds || {};
    const lowCount = thresholds.low_stock_count || 5;
    const lowPercent = thresholds.low_stock_percent || 20;
    const isLow = newQty <= lowCount || (med.initial_quantity > 0 && (newQty / med.initial_quantity) * 100 <= lowPercent);
    if (!isLow) return;
    const { data: existing } = await supabase.from('shopping_list').select('id').eq('medicine_id', med.id).eq('is_bought', false).limit(1);
    if (existing && existing.length > 0) return;
    await addToShoppingList(ctx.dbUser.id, med.name, med.id, med.medkit_id);
    try {
      await ctx.api.sendMessage(ctx.chat.id, ctx.t('cron.auto_added_shop', { name: med.name }), { parse_mode: 'Markdown' });
    } catch { /* ignore */ }
  } catch (e) {
    log('error', { action: 'auto_shopping_check', error: e.message });
  }
}

async function getIntakeLogsForDate(userId, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  const { data } = await supabase
    .from('intake_logs')
    .select('*, medicines(name, dosage, quantity, quantity_unit, notes), schedules(dose_per_intake, time_value)')
    .eq('user_id', userId)
    .gte('planned_at', startOfDay.toISOString())
    .lte('planned_at', endOfDay.toISOString())
    .order('planned_at', { ascending: true });
  return data || [];
}

async function subtractDoseAndAutoPause(ctx, log) {
  if (!log.medicine_id) return;
  // Parallelize independent DB fetches
  const [med, schedule] = await Promise.all([
    getMedicine(log.medicine_id),
    log.schedule_id ? getSchedule(log.schedule_id) : null,
  ]);
  if (!med) return;
  const dose = schedule?.dose_per_intake || 1;
  const newQty = Math.max(0, med.quantity - dose);
  // Parallelize medicine update and auto-shopping check
  const updatePromises = [
    updateMedicine(log.medicine_id, { quantity: newQty }),
    checkAutoShoppingList(ctx, med, newQty),
  ];
  if (newQty <= 0) {
    updatePromises.push(
      supabase.from('schedules').select('id').eq('medicine_id', log.medicine_id).eq('status', 'active')
        .then(({ data: activeScheds }) => {
          if (activeScheds && activeScheds.length > 0) {
            return Promise.all([
              supabase.from('schedules').update({ status: 'paused' }).in('id', activeScheds.map(s => s.id)),
              ctx.api.sendMessage(ctx.chat.id, ctx.t('schedule.auto_pause', { name: med.name, count: activeScheds.length })).catch(() => {}),
            ]);
          }
        })
    );
  }
  await Promise.all(updatePromises);
}

async function buildTodayView(ctx, userId, timezone) {
  const logs = await getTodayIntakeLogs(userId, timezone);
  if (logs.length === 0) {
    return {
      text: ctx.t('intake.empty'),
      keyboard: new InlineKeyboard()
        .text(ctx.t('intake.btn_yesterday'), 'intake_yesterday')
        .text(ctx.t('intake.btn_tomorrow'), 'intake_tomorrow')
        .row().text(ctx.t('calendar.btn_calendar'), 'intake_calendar')
        .row().text(ctx.t('common.back'), 'main_menu'),
    };
  }
  const byTime = {};
  for (const log of logs) { const time = formatTime(log.planned_at); if (!byTime[time]) byTime[time] = []; byTime[time].push(log); }
  let text = ctx.t('intake.title');
  const keyboard = new InlineKeyboard();
  const times = Object.keys(byTime).sort();
  for (const time of times) {
    text += ctx.t('intake.time_header', { time });
    for (const log of byTime[time]) {
      const name = log.medicines?.name || ctx.t('intake.unknown_medicine');
      const dose = log.schedules?.dose_per_intake || 1;
      const unit = log.medicines?.quantity_unit || ctx.t('intake.default_unit');
      const emoji = statusEmoji(log.status);
      text += `  ${emoji} ${name} — ${dose} ${unit}`;
      if (log.note) text += ` 📝`;
      text += '\n';
      if (log.status === 'pending' || log.status === 'snoozed') {
        keyboard.text(`✅ ${name}`, `intake:${log.id}:take`).text('❌', `intake:${log.id}:skip`).row();
      } else if (log.status === 'taken') {
        // #57 Note button for taken intakes
        keyboard.text(`📝 ${name}`, `intake:${log.id}:note`).row();
      }
    }
    text += '\n';
  }
  const total = logs.length;
  const taken = logs.filter(l => l.status === 'taken').length;
  const skipped = logs.filter(l => l.status === 'skipped').length;
  const pending = logs.filter(l => l.status === 'pending' || l.status === 'snoozed').length;
  text += ctx.t('intake.summary', { taken, total });
  if (skipped > 0) text += ctx.t('intake.summary_skipped', { count: skipped });
  if (pending > 0) text += ctx.t('intake.summary_pending', { count: pending });
  keyboard.text(ctx.t('intake.btn_yesterday'), 'intake_yesterday').text(ctx.t('intake.btn_tomorrow'), 'intake_tomorrow').row();
  keyboard.text(ctx.t('calendar.btn_calendar'), 'intake_calendar').row();
  keyboard.text(ctx.t('common.back'), 'main_menu');
  return { text, keyboard };
}

async function buildTomorrowView(ctx, userId) {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const logs = await getIntakeLogsForDate(userId, tomorrow);
  if (logs.length === 0) {
    return { text: ctx.t('tomorrow.empty'), keyboard: new InlineKeyboard().text(ctx.t('intake.btn_today'), 'intake_today').row().text(ctx.t('common.back'), 'main_menu') };
  }
  const byTime = {};
  for (const log of logs) { const time = formatTime(log.planned_at); if (!byTime[time]) byTime[time] = []; byTime[time].push(log); }
  let text = ctx.t('tomorrow.title');
  const times = Object.keys(byTime).sort();
  for (const time of times) {
    text += ctx.t('intake.time_header', { time });
    for (const log of byTime[time]) {
      const name = log.medicines?.name || ctx.t('intake.unknown_medicine');
      const dose = log.schedules?.dose_per_intake || 1;
      const unit = log.medicines?.quantity_unit || ctx.t('intake.default_unit');
      text += `  ⏳ ${name} — ${dose} ${unit}\n`;
    }
    text += '\n';
  }
  text += ctx.t('tomorrow.read_only');
  return { text, keyboard: new InlineKeyboard().text(ctx.t('intake.btn_today'), 'intake_today').row().text(ctx.t('common.back'), 'main_menu') };
}

async function buildYesterdayView(ctx, userId) {
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const logs = await getIntakeLogsForDate(userId, yesterday);
  if (logs.length === 0) {
    return { text: ctx.t('yesterday.empty'), keyboard: new InlineKeyboard().text(ctx.t('intake.btn_today'), 'intake_today').row().text(ctx.t('common.back'), 'main_menu') };
  }
  const byTime = {};
  for (const log of logs) { const time = formatTime(log.planned_at); if (!byTime[time]) byTime[time] = []; byTime[time].push(log); }
  let text = ctx.t('yesterday.title');
  const keyboard = new InlineKeyboard();
  const times = Object.keys(byTime).sort();
  for (const time of times) {
    text += ctx.t('intake.time_header', { time });
    for (const log of byTime[time]) {
      const name = log.medicines?.name || ctx.t('intake.unknown_medicine');
      const dose = log.schedules?.dose_per_intake || 1;
      const unit = log.medicines?.quantity_unit || ctx.t('intake.default_unit');
      const emoji = statusEmoji(log.status);
      text += `  ${emoji} ${name} — ${dose} ${unit}\n`;
      if (log.status === 'pending' || log.status === 'snoozed') {
        keyboard.text(`${ctx.t('yesterday.mark_taken')} ${name}`, `intake:${log.id}:take_yesterday`).row();
      }
    }
    text += '\n';
  }
  keyboard.text(ctx.t('intake.btn_today'), 'intake_today').row().text(ctx.t('common.back'), 'main_menu');
  return { text, keyboard };
}

async function buildCalendarView(ctx, userId, year, month) {
  const monthNames = ctx.t('format.months');
  const monthName = Array.isArray(monthNames) ? monthNames[month] : '';
  const startOfMonth = new Date(year, month, 1);
  const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const logs = await getIntakeLogsForPeriod(userId, startOfMonth.toISOString(), endOfMonth.toISOString());
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7;
  const dayStatus = {};
  for (const log of logs) {
    const d = new Date(log.planned_at);
    const day = d.getDate();
    if (!dayStatus[day]) dayStatus[day] = { total: 0, taken: 0, skipped: 0, pending: 0 };
    dayStatus[day].total++;
    if (log.status === 'taken') dayStatus[day].taken++;
    else if (log.status === 'skipped') dayStatus[day].skipped++;
    else dayStatus[day].pending++;
  }
  let cal = ctx.t('calendar.header') + '\n';
  for (let i = 0; i < firstDayOfWeek; i++) cal += '     ';
  for (let day = 1; day <= daysInMonth; day++) {
    const dayOfWeek = (firstDayOfWeek + day - 1) % 7;
    const dayStr = String(day).padStart(2, '0');
    const status = dayStatus[day];
    let marker = '  ';
    if (status) {
      if (status.taken === status.total) marker = '✅';
      else if (status.skipped > 0) marker = '❌';
      else if (status.pending > 0) marker = '⏳';
    }
    cal += `${dayStr}${marker} `;
    if (dayOfWeek === 6 && day < daysInMonth) cal += '\n';
  }
  let text = ctx.t('calendar.title', { month: monthName, year });
  text += `<code>${cal}</code>`;
  text += ctx.t('calendar.legend');
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  const prevMonthName = Array.isArray(monthNames) ? monthNames[prevMonth] : '';
  const nextMonthName = Array.isArray(monthNames) ? monthNames[nextMonth] : '';
  const keyboard = new InlineKeyboard()
    .text(ctx.t('calendar.btn_prev', { month: prevMonthName }), `intake_cal:${prevYear}:${prevMonth}`)
    .text(ctx.t('calendar.btn_next', { month: nextMonthName }), `intake_cal:${nextYear}:${nextMonth}`)
    .row().text(ctx.t('intake.btn_today'), 'intake_today')
    .row().text(ctx.t('common.back'), 'main_menu');
  return { text, keyboard };
}

export function registerIntakeHandlers(bot) {
  bot.callbackQuery('intake_today', async (ctx) => {
    await ctx.answerCallbackQuery();
    const timezone = ctx.dbUser.timezone || 'Europe/Moscow';
    const { text, keyboard } = await buildTodayView(ctx, ctx.dbUser.id, timezone);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });
  bot.callbackQuery('intake_tomorrow', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { text, keyboard } = await buildTomorrowView(ctx, ctx.dbUser.id);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });
  bot.callbackQuery('intake_yesterday', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { text, keyboard } = await buildYesterdayView(ctx, ctx.dbUser.id);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });
  bot.callbackQuery(/^intake:([0-9a-f-]+):take_yesterday$/, async (ctx) => {
    const logId = ctx.match[1];
    try {
      const log = await markIntakeTaken(logId);
      await subtractDoseAndAutoPause(ctx, log);
      await ctx.answerCallbackQuery(ctx.t('yesterday.marked_toast'));
    } catch (e) { log('error', { action: 'mark_yesterday_taken', error: e.message }); await ctx.answerCallbackQuery(ctx.t('intake.taken_error')); return; }
    const { text, keyboard } = await buildYesterdayView(ctx, ctx.dbUser.id);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });
  bot.callbackQuery('intake_calendar', async (ctx) => {
    await ctx.answerCallbackQuery();
    const now = new Date();
    const { text, keyboard } = await buildCalendarView(ctx, ctx.dbUser.id, now.getFullYear(), now.getMonth());
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  });
  bot.callbackQuery(/^intake_cal:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const year = parseInt(ctx.match[1], 10);
    const month = parseInt(ctx.match[2], 10);
    const { text, keyboard } = await buildCalendarView(ctx, ctx.dbUser.id, year, month);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  });
  bot.callbackQuery(/^intake:([0-9a-f-]+):take$/, async (ctx) => {
    const logId = ctx.match[1];
    // #72 Double-click protection — check if already taken/skipped
    const { data: existing } = await supabase.from('intake_logs').select('status').eq('id', logId).single();
    if (!existing || existing.status === 'taken') {
      return ctx.answerCallbackQuery({ text: ctx.t('common.already_taken'), show_alert: false });
    }
    if (existing.status === 'skipped') {
      return ctx.answerCallbackQuery({ text: ctx.t('common.already_taken'), show_alert: false });
    }
    try { const log = await withRetry(() => markIntakeTaken(logId)); await subtractDoseAndAutoPause(ctx, log); await ctx.answerCallbackQuery(ctx.t('intake.taken_toast')); }
    catch (e) { log('error', { action: 'mark_intake_taken', error: e.message }); await ctx.answerCallbackQuery(ctx.t('intake.taken_error')); return; }
    // #91 Streak congratulations + #90 achievements
    try {
      const timezone = ctx.dbUser.timezone || 'Europe/Moscow';
      const streak = await calculateCurrentStreak(ctx.dbUser.id, timezone);
      if (streak > 0 && streak % 30 === 0) {
        await ctx.answerCallbackQuery({ text: ctx.t('achievements.streak_congrats_30', { count: streak }), show_alert: true });
      } else if (streak > 0 && streak % 7 === 0) {
        await ctx.answerCallbackQuery({ text: ctx.t('achievements.streak_congrats_7', { count: streak }), show_alert: true });
      }
      await checkAchievements(ctx, 'intake_taken', { streak });
    } catch { /* ignore streak errors */ }
    const timezone = ctx.dbUser.timezone || 'Europe/Moscow';
    const { text, keyboard } = await buildTodayView(ctx, ctx.dbUser.id, timezone);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });
  bot.callbackQuery(/^intake:([0-9a-f-]+):skip$/, async (ctx) => {
    const logId = ctx.match[1];
    // #72 Double-click protection
    const { data: existingSkip } = await supabase.from('intake_logs').select('status').eq('id', logId).single();
    if (!existingSkip || existingSkip.status === 'taken' || existingSkip.status === 'skipped') {
      return ctx.answerCallbackQuery({ text: ctx.t('common.already_taken'), show_alert: false });
    }
    try { await markIntakeSkipped(logId); }
    catch (e) { log('error', { action: 'mark_intake_skipped', error: e.message }); await ctx.answerCallbackQuery(ctx.t('intake.skipped_error')); return; }
    // #58 Show skip reason picker
    await ctx.answerCallbackQuery(ctx.t('intake.skipped_toast'));
    const skipKb = new InlineKeyboard()
      .text(ctx.t('profile.skip_reason_forgot'), `intake:${logId}:reason:forgot`).row()
      .text(ctx.t('profile.skip_reason_sick'), `intake:${logId}:reason:sick`).row()
      .text(ctx.t('profile.skip_reason_empty'), `intake:${logId}:reason:empty`).row()
      .text(ctx.t('profile.skip_reason_doctor'), `intake:${logId}:reason:doctor`).row()
      .text(ctx.t('profile.skip_reason_other'), `intake:${logId}:reason:other`).row()
      .text(ctx.t('common.skip'), 'intake_today');
    await ctx.editMessageText(ctx.t('profile.skip_reason_title'), { parse_mode: 'Markdown', reply_markup: skipKb });
  });
  bot.callbackQuery(/^intake:([0-9a-f-]+):note$/, async (ctx) => {
    const logId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await supabase.from('sessions').upsert({ key: `state:${ctx.dbUser.id}`, value: { action: 'intake_note', logId, msgId: ctx.callbackQuery.message.message_id }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    await ctx.editMessageText(ctx.t('intake.note_prompt'), { reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), 'intake_today') });
  });
  bot.callbackQuery(/^intake:([0-9a-f-]+):snooze$/, async (ctx) => {
    const logId = ctx.match[1];
    try { const { snoozeIntake } = await import('../db/queries/intakeLogs.js'); await snoozeIntake(logId); await ctx.answerCallbackQuery(ctx.t('intake.snoozed_toast')); await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n' + ctx.t('intake.snoozed_label'), { parse_mode: 'Markdown' }); }
    catch (e) { log('error', { action: 'snooze_intake', error: e.message }); await ctx.answerCallbackQuery(ctx.t('intake.skipped_error')); }
  });
  bot.callbackQuery(/^intake:([0-9a-f-]+):take_remind$/, async (ctx) => {
    const logId = ctx.match[1];
    try { const log = await markIntakeTaken(logId); await subtractDoseAndAutoPause(ctx, log); await ctx.answerCallbackQuery(ctx.t('intake.taken_toast')); await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n' + ctx.t('intake.taken_label'), { parse_mode: 'Markdown' }); }
    catch (e) { log('error', { action: 'mark_intake_taken_reminder', error: e.message }); await ctx.answerCallbackQuery(ctx.t('intake.skipped_error')); }
  });
  bot.callbackQuery(/^intake:batch_take:(.+)$/, async (ctx) => {
    const logIds = ctx.match[1].split(',');
    await Promise.all(logIds.map(async (logId) => { try { const log = await markIntakeTaken(logId); await subtractDoseAndAutoPause(ctx, log); } catch (e) { log('error', { action: 'batch_take', logId, error: e.message }); } }));
    await ctx.answerCallbackQuery(ctx.t('intake.taken_toast'));
    try { await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n' + ctx.t('intake.taken_label'), { parse_mode: 'Markdown' }); } catch { /* ignore */ }
  });
  bot.callbackQuery(/^intake:([0-9a-f-]+):skip_remind$/, async (ctx) => {
    const logId = ctx.match[1];
    try { await markIntakeSkipped(logId); await ctx.answerCallbackQuery(ctx.t('intake.skipped_toast')); await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n' + ctx.t('intake.skipped_label'), { parse_mode: 'Markdown' }); }
    catch (e) { log('error', { action: 'skip_intake_reminder', error: e.message }); await ctx.answerCallbackQuery(ctx.t('intake.skipped_error')); }
  });
}
