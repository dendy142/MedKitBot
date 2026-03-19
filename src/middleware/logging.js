import { supabase } from '../db/supabase.js';
import { log } from '../utils/logger.js';

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
    log('error', { action: 'log_action', error: error.message });
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
    log('error', { action: 'log_medicine_change', error: error.message });
  }
}
