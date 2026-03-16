import { InlineKeyboard } from 'grammy';
import { getIntakeLogsForPeriod } from '../db/queries/intakeLogs.js';
import { getUserActiveSchedules } from '../db/queries/schedules.js';
import { DEFAULT_TIMEZONE } from '../config.js';
import { formatProgressBar } from '../utils/format.js';

const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

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
function getPeriodLabel(period, start, end) {
  if (period === 'today') return 'сегодня';
  if (period === 'week') return `неделю (${fmtDDMM(start)} — ${fmtDDMM(end)})`;
  if (period === 'month') return `месяц (${fmtDDMM(start)} — ${fmtDDMM(end)})`;
  return 'всё время';
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
      const dayName = DAY_NAMES[current.getDay()];
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
  const text = '📊 *Статистика приёмов*\n\nВыберите период:';
  const keyboard = new InlineKeyboard()
    .text('Сегодня', 'stats:today')
    .text('Неделя', 'stats:week')
    .row()
    .text('Месяц', 'stats:month')
    .text('Всё время', 'stats:all')
    .row()
    .text('◀️ Назад', 'main_menu');

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
  const timezone = ctx.dbUser.timezone || DEFAULT_TIMEZONE;
  const { start, end } = getDateRange(period, timezone);
  const periodLabel = getPeriodLabel(period, start, end);

  const logs = await getIntakeLogsForPeriod(
    ctx.dbUser.id,
    start.toISOString(),
    end.toISOString()
  );

  if (!logs.length) {
    const text = `📊 *Статистика за ${periodLabel}*\n\nНет данных о приёмах за этот период.`;
    const keyboard = new InlineKeyboard()
      .text('◀️ Назад', 'stats');
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    return;
  }

  // Group by medicine
  const byMedicine = {};
  for (const log of logs) {
    const medId = log.medicine_id;
    if (!byMedicine[medId]) {
      byMedicine[medId] = {
        name: log.medicines?.name || 'Неизвестно',
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
    const bar = formatProgressBar(taken, planned);
    let line = `💊 ${label}: ${bar} ${taken}/${planned} (${pct}%)`;

    const streak = calculateStreak(med.logs, timezone);
    if (streak > 0) {
      const streakEmoji = streak >= 7 ? '🔥🔥' : '🔥';
      const streakSuffix = streak >= 7 ? ' Отличный результат!' : '';
      line += `\n   ${streakEmoji} Стрик: ${streak} ${getDaysWord(streak)} подряд${streakSuffix}`;
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

  let text = `📊 *Статистика за ${periodLabel}*\n\n`;
  text += lines.join('\n\n');
  const totalBar = formatProgressBar(totalTaken, totalPlanned);
  text += `\n\n📈 Общее: ${totalBar} ${totalTaken}/${totalPlanned} (${totalPct}%)`;

  const keyboard = new InlineKeyboard()
    .text('◀️ Назад', 'stats');

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

/**
 * Proper Russian declension for "день"
 */
function getDaysWord(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 19) return 'дней';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дня';
  return 'дней';
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
