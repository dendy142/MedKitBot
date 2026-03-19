import { InlineKeyboard } from 'grammy';
import { getIntakeLogsForPeriod } from '../db/queries/intakeLogs.js';
import { getUserActiveSchedules } from '../db/queries/schedules.js';
import ru from '../locales/ru.js';

/**
 * Get start of day in user timezone
 */
function getUserNow(timezone) {
  const now = new Date();
  const str = now.toLocaleString('en-US', { timeZone: timezone });
  return new Date(str);
}

/**
 * Format date as DD.MM
 */
function fmtDDMM(d) {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Compute date range for a period
 */
function getDateRange(period, timezone) {
  const userNow = getUserNow(timezone);
  const endOfDay = new Date(userNow);
  endOfDay.setHours(23, 59, 59, 999);

  let start;
  if (period === 'today') {
    start = new Date(userNow);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    start = new Date(userNow);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'month') {
    start = new Date(userNow);
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
  } else {
    // all time
    start = new Date(2020, 0, 1);
  }

  return { start, end: endOfDay };
}

/**
 * Get period label
 */
function getPeriodLabel(ctx, period, start, end) {
  if (period === 'today') return ctx.t('stats.period_today');
  if (period === 'week') return ctx.t('stats.period_week', { start: fmtDDMM(start), end: fmtDDMM(end) });
  if (period === 'month') return ctx.t('stats.period_month', { start: fmtDDMM(start), end: fmtDDMM(end) });
  return ctx.t('stats.period_all');
}

/**
 * Calculate streak: consecutive days (from today backwards) where all planned intakes were taken
 */
function calculateStreak(logs, timezone) {
  if (!logs.length) return 0;

  // Group logs by date string
  const byDate = {};
  for (const log of logs) {
    const d = new Date(log.planned_at);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: timezone });
    if (!byDate[dateStr]) byDate[dateStr] = [];
    byDate[dateStr].push(log);
  }

  // Sort dates descending
  const dates = Object.keys(byDate).sort().reverse();
  let streak = 0;

  for (const dateStr of dates) {
    const dayLogs = byDate[dateStr];
    const allTaken = dayLogs.every(l => l.status === 'taken');
    const hasPending = dayLogs.some(l => l.status === 'pending');
    if (allTaken && !hasPending) {
      streak++;
    } else if (hasPending) {
      // Skip today if still pending
      continue;
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Build day-by-day visual for a medicine's logs (only for week period)
 */
function buildDayVisual(logs, start, end, timezone) {
  // Group by date
  const byDate = {};
  for (const log of logs) {
    const d = new Date(log.planned_at);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: timezone });
    if (!byDate[dateStr]) byDate[dateStr] = [];
    byDate[dateStr].push(log);
  }

  const parts = [];
  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toLocaleDateString('en-CA', { timeZone: timezone });
    const dayLogs = byDate[dateStr];
    if (dayLogs && dayLogs.length > 0) {
      const dayName = ru.stats.day_names[current.getDay()];
      const icons = dayLogs.map(l => l.status === 'taken' ? '✅' : '❌').join('');
      parts.push(`${dayName} ${icons}`);
    }
    current.setDate(current.getDate() + 1);
  }

  return parts.join(' ');
}

/**
 * Show stats menu
 */
async function showStatsMenu(ctx) {
  const text = ctx.t('stats.title');
  const keyboard = new InlineKeyboard()
    .text(ctx.t('stats.btn_today'), 'stats:today')
    .text(ctx.t('stats.btn_week'), 'stats:week')
    .row()
    .text(ctx.t('stats.btn_month'), 'stats:month')
    .text(ctx.t('stats.btn_all'), 'stats:all')
    .row()
    .text(ctx.t('common.back'), 'main_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

/**
 * Show stats for a specific period
 */
async function showStatsForPeriod(ctx, period) {
  const timezone = ctx.dbUser.timezone || 'Etc/GMT-3';
  const { start, end } = getDateRange(period, timezone);
  const periodLabel = getPeriodLabel(ctx, period, start, end);

  const logs = await getIntakeLogsForPeriod(
    ctx.dbUser.id,
    start.toISOString(),
    end.toISOString()
  );

  if (!logs.length) {
    const text = ctx.t('stats.no_data', { period: periodLabel });
    const keyboard = new InlineKeyboard()
      .text(ctx.t('common.back'), 'stats');
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    return;
  }

  // Group by medicine
  const byMedicine = {};
  for (const log of logs) {
    const medId = log.medicine_id;
    if (!byMedicine[medId]) {
      byMedicine[medId] = {
        name: log.medicines?.name || ctx.t('stats.unknown_medicine'),
        dosage: log.medicines?.dosage || '',
        logs: [],
      };
    }
    byMedicine[medId].logs.push(log);
  }

  let totalPlanned = 0;
  let totalTaken = 0;
  const lines = [];

  for (const [medId, med] of Object.entries(byMedicine)) {
    const planned = med.logs.length;
    const taken = med.logs.filter(l => l.status === 'taken').length;
    const pct = planned > 0 ? Math.round((taken / planned) * 100) : 0;

    totalPlanned += planned;
    totalTaken += taken;

    const label = med.dosage ? `${med.name} ${med.dosage}` : med.name;
    let line = ctx.t('stats.medicine_line', { name: label, taken, planned, pct });

    const streak = calculateStreak(med.logs, timezone);
    if (streak > 0) {
      line += '\n   ' + ctx.t('stats.streak', { count: streak, days: getDaysWord(ctx, streak) });
    }

    // Day-by-day visual only for week period
    if (period === 'week') {
      const dayVisual = buildDayVisual(med.logs, start, end, timezone);
      if (dayVisual) {
        line += `\n   ${dayVisual}`;
      }
    }

    lines.push(line);
  }

  const totalPct = totalPlanned > 0 ? Math.round((totalTaken / totalPlanned) * 100) : 0;

  let text = ctx.t('stats.result_title', { period: periodLabel });
  text += lines.join('\n\n');
  text += '\n\n' + ctx.t('stats.result_total', { taken: totalTaken, planned: totalPlanned, pct: totalPct });

  const keyboard = new InlineKeyboard()
    .text(ctx.t('common.back'), 'stats');

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

/**
 * Proper Russian declension for "день" using i18n keys
 */
function getDaysWord(ctx, n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 19) return ctx.t('stats.days_5');
  if (last === 1) return ctx.t('stats.days_1');
  if (last >= 2 && last <= 4) return ctx.t('stats.days_2');
  return ctx.t('stats.days_5');
}

/**
 * Register stats handlers
 */
export function registerStatsHandlers(bot) {
  bot.callbackQuery('stats', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showStatsMenu(ctx);
  });

  bot.callbackQuery(/^stats:(today|week|month|all)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const period = ctx.match[1];
    await showStatsForPeriod(ctx, period);
  });
}
