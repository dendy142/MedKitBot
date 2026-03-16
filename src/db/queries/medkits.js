import { supabase } from '../supabase.js';

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
    .select('role')
    .eq('medkit_id', medkitId)
    .eq('user_id', userId)
    .single();

  if (!member) return null;

  const { data: medkit } = await supabase
    .from('medkits')
    .select('*')
    .eq('id', medkitId)
    .single();

  if (!medkit) return null;

  return { ...medkit, role: member.role };
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
 * Delete a medkit and all its data
 */
export async function deleteMedkit(medkitId) {
  // Delete members, medicines, etc. (cascade should handle this via FK)
  await supabase.from('medkit_members').delete().eq('medkit_id', medkitId);
  await supabase.from('medicines').delete().eq('medkit_id', medkitId);
  const { error } = await supabase.from('medkits').delete().eq('id', medkitId);
  if (error) throw error;
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

/**
 * Count medicines for multiple medkits at once (excluding archived)
 * Returns a map of medkitId → count
 */
export async function countMedkitMedicinesBatch(medkitIds) {
  if (!medkitIds.length) return {};
  const { data } = await supabase
    .from('medicines')
    .select('medkit_id')
    .in('medkit_id', medkitIds)
    .eq('is_archived', false);

  const counts = {};
  for (const id of medkitIds) counts[id] = 0;
  if (data) {
    for (const row of data) {
      counts[row.medkit_id] = (counts[row.medkit_id] || 0) + 1;
    }
  }
  return counts;
}
