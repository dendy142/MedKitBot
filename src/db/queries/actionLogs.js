import { supabase } from '../supabase.js';

/**
 * Get action logs for an entity
 */
export async function getEntityLogs(entityType, entityId, limit = 20) {
  const { data } = await supabase
    .from('action_logs')
    .select('*, users(first_name, username)')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

/**
 * Get medicine change history
 */
export async function getMedicineHistory(medicineId, limit = 20) {
  const { data } = await supabase
    .from('medicine_history')
    .select('*, users(first_name, username)')
    .eq('medicine_id', medicineId)
    .order('changed_at', { ascending: false })
    .limit(limit);
  return data || [];
}
