import { supabase } from '../supabase.js';
import { log } from '../../utils/logger.js';

/**
 * Create a new medkit and add owner as member
 */
export async function createMedkit(name, ownerId) {
  const { data: medkit, error } = await supabase
    .from('medkits')
    .insert({ name, owner_id: ownerId })
    .select()
    .single();

  if (error) throw error;

  // Add owner as member
  await supabase.from('medkit_members').insert({
    medkit_id: medkit.id,
    user_id: ownerId,
    role: 'owner',
  });

  return medkit;
}

/**
 * Get all medkits the user has access to (own + shared)
 */
export async function getUserMedkits(userId) {
  const { data } = await supabase
    .from('medkit_members')
    .select(`
      role,
      medkit:medkits (
        id,
        name,
        owner_id,
        created_at
      )
    `)
    .eq('user_id', userId);

  if (!data) return [];

  return data.map((m) => ({
    ...m.medkit,
    role: m.role,
    isShared: m.role !== 'owner',
  }));
}

/**
 * Get a single medkit by ID (with role check)
 */
export async function getMedkit(medkitId, userId) {
  const { data: member } = await supabase
    .from('medkit_members')
    .select('role, medkit:medkits(*)')
    .eq('medkit_id', medkitId)
    .eq('user_id', userId)
    .single();

  if (!member || !member.medkit) return null;

  return { ...member.medkit, role: member.role };
}

/**
 * Rename a medkit
 */
export async function renameMedkit(medkitId, newName) {
  const { data } = await supabase
    .from('medkits')
    .update({ name: newName })
    .eq('id', medkitId)
    .select()
    .single();
  return data;
}

/**
 * #74 Delete a medkit and all its data with proper cascade order.
 * #75 Sequential operations with error handling (no real transactions in Supabase JS).
 *
 * Order: intake_logs → schedules → shopping_list → medicine_notes → medicines
 *        → medkit_members → invitations → medkits
 */
export async function deleteMedkit(medkitId) {
  // Get all medicine IDs in this medkit (needed for child-table deletes)
  const { data: meds } = await supabase
    .from('medicines')
    .select('id')
    .eq('medkit_id', medkitId);
  const medIds = (meds || []).map(m => m.id);

  try {
    if (medIds.length > 0) {
      // 1. intake_logs (via schedules → medicine_id)
      await supabase.from('intake_logs').delete().in('medicine_id', medIds);
      // 2. schedules
      await supabase.from('schedules').delete().in('medicine_id', medIds);
      // 3. shopping_list (by medicine_id)
      await supabase.from('shopping_list').delete().in('medicine_id', medIds);
      // 4. medicine_history (medicine_notes equivalent)
      await supabase.from('medicine_history').delete().in('medicine_id', medIds);
    }
    // 5. medicines
    await supabase.from('medicines').delete().eq('medkit_id', medkitId);
    // 6. medkit_members
    await supabase.from('medkit_members').delete().eq('medkit_id', medkitId);
    // 7. invitations
    await supabase.from('invitations').delete().eq('medkit_id', medkitId);
    // 8. medkits
    const { error } = await supabase.from('medkits').delete().eq('id', medkitId);
    if (error) throw error;
  } catch (err) {
    // Log but still try to clean up the medkit itself
    log('error', { action: 'cascade_delete_medkit', medkitId, error: err?.message });
    // Attempt final cleanup
    await supabase.from('medkit_members').delete().eq('medkit_id', medkitId);
    await supabase.from('medkits').delete().eq('id', medkitId);
    throw err;
  }
}

/**
 * Count medicines in a medkit (excluding archived)
 */
export async function countMedkitMedicines(medkitId) {
  const { count } = await supabase
    .from('medicines')
    .select('*', { count: 'exact', head: true })
    .eq('medkit_id', medkitId)
    .eq('is_archived', false);
  return count || 0;
}
