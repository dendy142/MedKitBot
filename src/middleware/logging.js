import { supabase } from '../db/supabase.js';

/**
 * Log an action to the action_logs table
 */
export async function logAction(userId, action, entityType, entityId, details = {}) {
  try {
    await supabase.from('action_logs').insert({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
    });
  } catch (error) {
    console.error('Error logging action:', error);
  }
}

/**
 * Log a medicine field change to medicine_history
 */
export async function logMedicineChange(medicineId, userId, fieldName, oldValue, newValue) {
  try {
    await supabase.from('medicine_history').insert({
      medicine_id: medicineId,
      user_id: userId,
      field_name: fieldName,
      old_value: String(oldValue ?? ''),
      new_value: String(newValue ?? ''),
    });
  } catch (error) {
    console.error('Error logging medicine change:', error);
  }
}
