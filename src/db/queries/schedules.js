import { supabase } from '../supabase.js';

/**
 * Create a new schedule (intake course)
 */
export async function createSchedule(data) {
  const { data: schedule, error } = await supabase
    .from('schedules')
    .insert({
      medicine_id: data.medicineId,
      user_id: data.userId,
      time_mode: data.timeMode,
      time_value: data.timeValue,
      dose_per_intake: data.dosePerIntake || 1,
      frequency: data.frequency || 'daily',
      frequency_days: data.frequencyDays || [],
      duration_type: data.durationType || 'indefinite',
      duration_value: data.durationValue || null,
      profile_id: data.profileId || null,
      start_date: data.startDate || new Date().toISOString().split('T')[0],
      status: 'active',
    })
    .select()
    .single();

  if (error) throw error;
  return schedule;
}

/**
 * Get active schedules for a medicine
 */
export async function getMedicineSchedules(medicineId) {
  const { data } = await supabase
    .from('schedules')
    .select('*')
    .eq('medicine_id', medicineId)
    .order('created_at', { ascending: false });
  return data || [];
}

/**
 * Get all active schedules for a user
 */
export async function getUserActiveSchedules(userId) {
  const { data } = await supabase
    .from('schedules')
    .select('*, medicines(name, dosage, quantity, quantity_unit, medkit_id)')
    .eq('user_id', userId)
    .eq('status', 'active');
  return data || [];
}

/**
 * Update schedule status
 */
export async function updateScheduleStatus(scheduleId, status) {
  const { data, error } = await supabase
    .from('schedules')
    .update({ status })
    .eq('id', scheduleId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Get a single schedule
 */
export async function getSchedule(scheduleId) {
  const { data } = await supabase
    .from('schedules')
    .select('*, medicines(name, dosage, quantity, quantity_unit)')
    .eq('id', scheduleId)
    .single();
  return data;
}

/**
 * Delete a schedule
 */
export async function deleteSchedule(scheduleId) {
  const { error } = await supabase
    .from('schedules')
    .delete()
    .eq('id', scheduleId);
  if (error) throw error;
}
