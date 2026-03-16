import { supabase } from '../../src/db/supabase.js';
import { Bot } from 'grammy';
import { BOT_TOKEN, CRON_SECRET, MAX_SNOOZE } from '../../src/config.js';
import { getPendingIntakeLogs, createIntakeLog } from '../../src/db/queries/intakeLogs.js';
import { getUserActiveSchedules } from '../../src/db/queries/schedules.js';

/**
 * Get user's local "now" and "today" in their timezone
 */
function getUserNow(timezone) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = {};
  for (const { type, value } of formatter.formatToParts(now)) {
    parts[type] = value;
  }
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    hours: parseInt(parts.hour, 10),
    minutes: parseInt(parts.minute, 10),
    now,
  };
}

/**
 * Check if a schedule should run on a given date
 */
function shouldRunToday(schedule, dateStr) {
  const startDate = schedule.start_date;
  if (startDate && dateStr < startDate) return false;

  // Check duration
  if (schedule.duration_type === 'until_date' && schedule.duration_value) {
    if (dateStr > schedule.duration_value) return false;
  }
  if (schedule.duration_type === 'days' && schedule.duration_value && startDate) {
    const start = new Date(startDate);
    const today = new Date(dateStr);
    const daysDiff = Math.floor((today - start) / (1000 * 60 * 60 * 24));
    if (daysDiff >= schedule.duration_value) return false;
  }

  // Check frequency
  if (schedule.frequency === 'daily') return true;

  if (schedule.frequency === 'every_other_day' && startDate) {
    const start = new Date(startDate);
    const today = new Date(dateStr);
    const daysDiff = Math.floor((today - start) / (1000 * 60 * 60 * 24));
    return daysDiff % 2 === 0;
  }

  if (schedule.frequency === 'weekly' && schedule.frequency_days?.length > 0) {
    const today = new Date(dateStr);
    const jsDay = today.getUTCDay(); // 0=Sun, 1=Mon, ...
    return schedule.frequency_days.includes(jsDay);
  }

  return true;
}

/**
 * Resolve time for a schedule: return "HH:MM" string
 */
function resolveTime(schedule, userSettings) {
  if (schedule.time_mode === 'exact') {
    return schedule.time_value;
  }

  // Period mode — use user's day_periods settings
  const periods = userSettings?.day_periods || {
    morning: '08:00',
    afternoon: '13:00',
    evening: '19:00',
    night: '22:00',
  };

  return periods[schedule.time_value] || '08:00';
}

/**
 * Create a planned_at timestamp for a given date + time in a timezone
 */
function createPlannedAt(dateStr, timeStr, timezone) {
  const [hours, minutes] = timeStr.split(':').map(Number);

  // Create a date in the user's timezone
  // We use a trick: create a date string that represents the local time,
  // then convert it by finding the UTC offset
  const localStr = `${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

  // Get the UTC offset for this timezone at this date
  const testDate = new Date(localStr + 'Z');
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Find offset by comparing UTC and local representations
  // Simpler approach: use the timezone offset
  const parts = {};
  for (const { type, value } of formatter.formatToParts(testDate)) {
    parts[type] = value;
  }

  const localHour = parseInt(parts.hour, 10);
  const utcHour = testDate.getUTCHours();
  let offset = localHour - utcHour;
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;

  // Adjust: we want the UTC time such that local time = desired time
  const result = new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00Z`);
  result.setUTCHours(result.getUTCHours() - offset);

  return result.toISOString();
}

export default async function handler(req, res) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const bot = new Bot(BOT_TOKEN);

    // Step 1: Get all users who have active schedules
    const { data: usersWithSchedules } = await supabase
      .from('schedules')
      .select('user_id')
      .eq('status', 'active');

    const userIds = [...new Set((usersWithSchedules || []).map(s => s.user_id))];

    let generatedCount = 0;
    let reminderCount = 0;

    // Step 2: For each user, generate today's intake_logs
    for (const userId of userIds) {
      const { data: user } = await supabase
        .from('users')
        .select('id, telegram_id, timezone, settings')
        .eq('id', userId)
        .single();

      if (!user) continue;

      const timezone = user.timezone || 'Europe/Moscow';
      const settings = user.settings || {};
      const { dateStr } = getUserNow(timezone);

      const schedules = await getUserActiveSchedules(userId);

      for (const schedule of schedules) {
        if (!shouldRunToday(schedule, dateStr)) continue;

        const timeStr = resolveTime(schedule, settings);
        const plannedAt = createPlannedAt(dateStr, timeStr, timezone);

        // Check if log already exists for this schedule+date
        const { data: existing } = await supabase
          .from('intake_logs')
          .select('id')
          .eq('schedule_id', schedule.id)
          .gte('planned_at', `${dateStr}T00:00:00Z`)
          .lte('planned_at', `${dateStr}T23:59:59Z`)
          .limit(1);

        if (existing && existing.length > 0) continue;

        await createIntakeLog({
          scheduleId: schedule.id,
          medicineId: schedule.medicine_id,
          userId,
          plannedAt,
        });
        generatedCount++;
      }
    }

    // Step 3: Send reminders for pending logs where planned_at <= now
    const now = new Date().toISOString();
    const pendingLogs = await getPendingIntakeLogs(now);

    for (const log of pendingLogs) {
      if (!log.users?.telegram_id) continue;

      const userSettings = log.users?.settings || {};
      if (userSettings.notifications?.intake_reminders === false) continue;

      const medName = log.medicines?.name || 'Лекарство';
      const dose = log.schedules?.dose_per_intake || 1;
      const unit = log.medicines?.quantity_unit || 'шт';
      const medNotes = log.medicines?.notes;

      let text = `💊 *Напоминание о приёме*\n\n`;
      text += `${medName}${log.medicines?.dosage ? ' ' + log.medicines.dosage : ''}\n`;
      text += `💊 Доза: ${dose} ${unit}\n`;

      if (medNotes) text += `📝 ${medNotes}\n`;

      const keyboard = new InlineKeyboard()
        .text('✅ Принял', `intake:${log.id}:take_remind`)
        .text('⏰ +15 мин', `intake:${log.id}:snooze`)
        .text('❌ Пропуск', `intake:${log.id}:skip_remind`);

      try {
        await bot.api.sendMessage(log.users.telegram_id, text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });

        // Mark as notified by updating a field (use snoozed count tracking)
        // We track via a separate approach: set status to 'notified' temporarily
        // Actually, let's keep status as pending but track notification separately
        // For simplicity, we don't change status — the reminder just sends
        reminderCount++;
      } catch (e) {
        console.error(`Failed to send reminder to user ${log.user_id}:`, e.message);
      }
    }

    // Step 4: Handle snoozed logs — auto-skip if too many snoozes
    const { data: snoozedLogs } = await supabase
      .from('intake_logs')
      .select('id, snooze_count')
      .eq('status', 'snoozed')
      .lte('planned_at', now);

    if (snoozedLogs) {
      for (const log of snoozedLogs) {
        const snoozeCount = log.snooze_count || 0;
        if (snoozeCount >= MAX_SNOOZE) {
          await supabase
            .from('intake_logs')
            .update({ status: 'skipped', confirmed_at: new Date().toISOString() })
            .eq('id', log.id);
        }
      }
    }

    return res.json({
      ok: true,
      generated: generatedCount,
      reminders: reminderCount,
    });
  } catch (error) {
    console.error('Reminders cron error:', error);
    return res.status(500).json({ error: error.message });
  }
}
