import { supabase } from '../../src/db/supabase.js';
import { Bot, InlineKeyboard } from 'grammy';
import { BOT_TOKEN, CRON_SECRET, MAX_SNOOZE } from '../../src/config.js';
import { getPendingIntakeLogs, createIntakeLog } from '../../src/db/queries/intakeLogs.js';
import { getUserActiveSchedules } from '../../src/db/queries/schedules.js';
import { t } from '../../src/locales/index.js';
import { log } from '../../src/utils/logger.js';
import { safeSend } from '../../src/utils/retry.js';

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

/**
 * Check if current time falls within user's quiet hours (#42)
 */
function isQuietHour(userSettings, timezone) {
  if (!userSettings?.quiet_hours?.enabled) return false;
  const { from, to } = userSettings.quiet_hours;
  const userNow = getUserNow(timezone);
  const currentMinutes = userNow.hours * 60 + userNow.minutes;
  const [fromH, fromM] = from.split(':').map(Number);
  const [toH, toM] = to.split(':').map(Number);
  const fromMin = fromH * 60 + fromM;
  const toMin = toH * 60 + toM;
  if (fromMin < toMin) return currentMinutes >= fromMin && currentMinutes < toMin;
  return currentMinutes >= fromMin || currentMinutes < toMin; // crosses midnight
}

export default async function handler(req, res) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // #79 Cron metrics
  const startTime = Date.now();
  let errors = 0;

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

    // Step 2: Batch-fetch all users and their schedules
    const { data: users } = await supabase
      .from('users')
      .select('id, telegram_id, timezone, settings')
      .in('id', userIds);

    for (const user of (users || [])) {
      const timezone = user.timezone || 'Europe/Moscow';
      const settings = user.settings || {};
      const { dateStr } = getUserNow(timezone);

      const schedules = await getUserActiveSchedules(user.id);
      const todaySchedules = schedules.filter(s => shouldRunToday(s, dateStr));
      if (todaySchedules.length === 0) continue;

      // Batch check: which schedules already have logs today
      const scheduleIds = todaySchedules.map(s => s.id);
      const { data: existingLogs } = await supabase
        .from('intake_logs')
        .select('schedule_id')
        .in('schedule_id', scheduleIds)
        .gte('planned_at', `${dateStr}T00:00:00Z`)
        .lte('planned_at', `${dateStr}T23:59:59Z`);

      const existingScheduleIds = new Set((existingLogs || []).map(l => l.schedule_id));

      for (const schedule of todaySchedules) {
        if (existingScheduleIds.has(schedule.id)) continue;

        const timeStr = resolveTime(schedule, settings);
        const plannedAt = createPlannedAt(dateStr, timeStr, timezone);

        await createIntakeLog({
          scheduleId: schedule.id,
          medicineId: schedule.medicine_id,
          userId: user.id,
          plannedAt,
        });
        generatedCount++;
      }
    }

    // Step 3: Send reminders for pending logs where planned_at <= now
    const now = new Date().toISOString();
    const pendingLogs = await getPendingIntakeLogs(now);

    // Group logs by user for grouped notifications (#44)
    const logsByUser = {};
    for (const log of pendingLogs) {
      if (!log.users?.telegram_id) continue;

      const userSettings = log.users?.settings || {};
      if (userSettings.notifications?.intake_reminders === false) continue;

      // Check quiet hours (#42)
      const timezone = log.users?.timezone || 'Europe/Moscow';
      if (isQuietHour(userSettings, timezone)) continue;

      const uid = log.user_id;
      if (!logsByUser[uid]) logsByUser[uid] = [];
      logsByUser[uid].push(log);
    }

    // #48 Prefetch all profiles referenced by pending medicines
    const profileIds = [...new Set(pendingLogs.map(l => l.medicines?.profile_id).filter(Boolean))];
    const profileMap = {};
    if (profileIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, name, icon').in('id', profileIds);
      for (const p of (profiles || [])) profileMap[p.id] = p;
    }

    for (const [userId, userLogs] of Object.entries(logsByUser)) {
      const firstLog = userLogs[0];
      const userSettings = firstLog.users?.settings || {};
      const lang = userSettings.language || 'ru';
      const telegramId = firstLog.users.telegram_id;

      // #44 Group by planned_at time (same minute) within each user
      const logsByTime = {};
      for (const log of userLogs) {
        const planned = new Date(log.planned_at);
        const timeKey = `${String(planned.getUTCHours()).padStart(2, '0')}:${String(planned.getUTCMinutes()).padStart(2, '0')}`;
        if (!logsByTime[timeKey]) logsByTime[timeKey] = [];
        logsByTime[timeKey].push(log);
      }

      // #76 Batch check all log IDs for this user at once
      const allUserLogIds = userLogs.map(l => l.id);
      const { data: sentLogs } = await supabase
        .from('action_logs')
        .select('entity_id')
        .eq('action', 'reminder_sent')
        .in('entity_id', allUserLogIds);
      const alreadySentIds = new Set((sentLogs || []).map(l => l.entity_id));

      for (const [timeKey, logs] of Object.entries(logsByTime)) {
        try {
          // Skip if any log in this time group was already sent
          if (logs.some(l => alreadySentIds.has(l.id))) continue;

          // Helper: resolve medicine name with profile prefix
          const getMedName = (logEntry) => {
            let name = logEntry.medicines?.name || t('cron.reminder_medicine', lang);
            if (logEntry.medicines?.profile_id) {
              const prof = profileMap[logEntry.medicines.profile_id];
              if (prof) name = `${prof.icon} ${prof.name}: ${name}`;
            }
            return name;
          };

          if (logs.length >= 2) {
            // Grouped notification (#44)
            let text = t('cron.reminder_grouped', lang);
            const logIds = [];
            for (const logEntry of logs) {
              const medName = getMedName(logEntry);
              const dose = logEntry.schedules?.dose_per_intake || 1;
              const unit = logEntry.medicines?.quantity_unit || '';
              text += t('cron.reminder_grouped_item', lang, { name: `${medName}${logEntry.medicines?.dosage ? ' ' + logEntry.medicines.dosage : ''}`, dose, unit });
              logIds.push(logEntry.id);
            }

            const keyboard = new InlineKeyboard()
              .text(t('cron.btn_take_all', lang), `intake:batch_take:${logIds.join(',')}`)
              .text(t('cron.btn_details', lang), 'intake_today');

            await safeSend(bot, telegramId, text, {
              parse_mode: 'Markdown',
              reply_markup: keyboard,
            });

            // #76 Batch-insert reminder logs
            await supabase.from('action_logs').insert(
              logIds.map(logId => ({ user_id: userId, action: 'reminder_sent', entity_type: 'intake_log', entity_id: logId }))
            );
            reminderCount += logs.length;
          } else {
            // Single notification (original behavior)
            const logEntry = logs[0];
            const medName = getMedName(logEntry);
            const dose = logEntry.schedules?.dose_per_intake || 1;
            const medNotes = logEntry.medicines?.notes;

            let text = t('cron.reminder_title', lang);
            text += `${medName}${logEntry.medicines?.dosage ? ' ' + logEntry.medicines.dosage : ''}\n`;
            text += t('cron.reminder_dose', lang, { dose, unit: logEntry.medicines?.quantity_unit || '' }) + '\n';

            if (medNotes) text += t('cron.reminder_notes', lang, { notes: medNotes }) + '\n';

            const keyboard = new InlineKeyboard()
              .text(t('cron.btn_take', lang), `intake:${logEntry.id}:take_remind`)
              .text(t('cron.btn_snooze', lang), `intake:${logEntry.id}:snooze`)
              .text(t('cron.btn_skip', lang), `intake:${logEntry.id}:skip_remind`);

            await safeSend(bot, telegramId, text, {
              parse_mode: 'Markdown',
              reply_markup: keyboard,
            });

            // #76 Log reminder sent
            await supabase.from('action_logs').insert({ user_id: userId, action: 'reminder_sent', entity_type: 'intake_log', entity_id: logEntry.id });
            reminderCount++;
          }
        } catch (e) {
          errors++;
          log('error', { cron: 'reminders', action: 'send_reminder', userId, error: e.message });
        }
      }
    }

    // Step 4: #43 Adaptive reminders — check for consistently early intakes
    try {
      // Get all active schedules
      const { data: allSchedules } = await supabase
        .from('schedules')
        .select('id, user_id, medicine_id, time_value')
        .eq('status', 'active');

      if (allSchedules && allSchedules.length > 0) {
        // Batch: get all recent adaptive suggestions (last 30 days)
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
        const schedIds = allSchedules.map(s => s.id);
        const { data: recentSuggestions } = await supabase
          .from('action_logs')
          .select('entity_id')
          .eq('action', 'adaptive_suggest')
          .in('entity_id', schedIds)
          .gte('created_at', thirtyDaysAgo);
        const recentlySuggestedIds = new Set((recentSuggestions || []).map(l => l.entity_id));

        const eligibleSchedules = allSchedules.filter(s => !recentlySuggestedIds.has(s.id));

        for (const sched of eligibleSchedules) {
          // Get last 5 taken intake_logs for this schedule
          const { data: recentTaken } = await supabase
            .from('intake_logs')
            .select('planned_at, confirmed_at')
            .eq('schedule_id', sched.id)
            .eq('status', 'taken')
            .not('confirmed_at', 'is', null)
            .order('planned_at', { ascending: false })
            .limit(5);

          if (!recentTaken || recentTaken.length < 3) continue;

          // Check if user confirmed >5 minutes before planned for 3+ consecutive
          let consecutiveEarly = 0;
          let totalEarlyMinutes = 0;
          for (const intake of recentTaken) {
            const planned = new Date(intake.planned_at);
            const confirmed = new Date(intake.confirmed_at);
            const diffMs = planned.getTime() - confirmed.getTime();
            const diffMin = diffMs / 60000;
            if (diffMin > 5) {
              consecutiveEarly++;
              totalEarlyMinutes += diffMin;
            } else {
              break;
            }
          }

          if (consecutiveEarly < 3) continue;

          const avgEarlyMin = Math.round(totalEarlyMinutes / consecutiveEarly);

          // Get user info and medicine name in parallel
          const [{ data: schedUser }, { data: medData }] = await Promise.all([
            supabase.from('users').select('telegram_id, settings').eq('id', sched.user_id).single(),
            supabase.from('medicines').select('name').eq('id', sched.medicine_id).single(),
          ]);

          if (!schedUser) continue;

          const medName = medData?.name || '?';
          const lang = schedUser.settings?.language || 'ru';

          const keyboard = new InlineKeyboard()
            .text(t('cron.btn_shift_yes', lang), `sched:shift:${sched.id}`)
            .text(t('cron.btn_shift_no', lang), 'noop');

          try {
            await safeSend(bot, schedUser.telegram_id,
              t('cron.adaptive_suggest', lang, { name: medName, minutes: avgEarlyMin }),
              { parse_mode: 'Markdown', reply_markup: keyboard }
            );

            await supabase.from('action_logs').insert({
              user_id: sched.user_id,
              action: 'adaptive_suggest',
              entity_type: 'schedule',
              entity_id: sched.id,
              details: { avg_early_minutes: avgEarlyMin },
            });
          } catch (e) {
            log('error', { cron: 'reminders', action: 'adaptive_suggest_send', scheduleId: sched.id, error: e.message });
          }
        }
      }
    } catch (e) {
      log('error', { cron: 'reminders', action: 'adaptive_reminders', error: e.message });
    }

    // Step 5: Handle snoozed logs — batch auto-skip if too many snoozes
    const { data: snoozedLogs } = await supabase
      .from('intake_logs')
      .select('id, snooze_count')
      .eq('status', 'snoozed')
      .lte('planned_at', now);

    if (snoozedLogs) {
      const toSkip = snoozedLogs.filter(l => (l.snooze_count || 0) >= MAX_SNOOZE).map(l => l.id);
      if (toSkip.length > 0) {
        await supabase
          .from('intake_logs')
          .update({ status: 'skipped', confirmed_at: new Date().toISOString() })
          .in('id', toSkip);
      }
    }

    // #79 Cron metrics
    const duration = Date.now() - startTime;
    log('info', { cron: 'reminders', duration_ms: duration, generated: generatedCount, reminders: reminderCount, users: userIds.length, errors });

    return res.json({
      ok: true,
      generated: generatedCount,
      reminders: reminderCount,
      duration_ms: duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    log('error', { cron: 'reminders', duration_ms: duration, error: error.message });
    return res.status(500).json({ error: error.message });
  }
}
