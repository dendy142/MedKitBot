import { supabase } from '../supabase.js';

/**
 * Create an intake log entry
 */
export async function createIntakeLog(data) {
  const { data: log, error } = await supabase
    .from('intake_logs')
    .insert({
      schedule_id: data.scheduleId,
      medicine_id: data.medicineId,
      user_id: data.userId,
      planned_at: data.plannedAt,
      status: data.status || 'pending',
    })
    .select()
    .single();

  if (error) throw error;
  return log;
}

/**
 * Get today's intake logs for a user
 */
export async function getTodayIntakeLogs(userId, timezone = 'Europe/Moscow') {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
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

/**
 * Mark intake as taken
 */
export async function markIntakeTaken(logId, note = null) {
  const { data, error } = await supabase
    .from('intake_logs')
    .update({
      status: 'taken',
      confirmed_at: new Date().toISOString(),
      note,
    })
    .eq('id', logId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Mark intake as skipped
 */
export async function markIntakeSkipped(logId) {
  const { data, error } = await supabase
    .from('intake_logs')
    .update({
      status: 'skipped',
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', logId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Snooze intake (set snoozed status)
 */
export async function snoozeIntake(logId) {
  const { data, error } = await supabase
    .from('intake_logs')
    .update({ status: 'snoozed' })
    .eq('id', logId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get intake logs for a period (for statistics)
 */
export async function getIntakeLogsForPeriod(userId, startDate, endDate, medicineId = null) {
  let query = supabase
    .from('intake_logs')
    .select('*, medicines(name, dosage)')
    .eq('user_id', userId)
    .gte('planned_at', startDate)
    .lte('planned_at', endDate)
    .order('planned_at', { ascending: true });

  if (medicineId) {
    query = query.eq('medicine_id', medicineId);
  }

  const { data } = await query;
  return data || [];
}

/**
 * Get pending intake logs (for reminders cron)
 */
export async function getPendingIntakeLogs(beforeTime) {
  const { data } = await supabase
    .from('intake_logs')
    .select('*, medicines(name, dosage, notes, profile_id, quantity_unit), schedules(dose_per_intake), users(telegram_id, timezone, settings)')
    .eq('status', 'pending')
    .lte('planned_at', beforeTime)
    .order('planned_at', { ascending: true });

  return data || [];
}
