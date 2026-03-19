/**
 * #73 Permission check utility.
 * Roles hierarchy: viewer < editor < owner
 */

import { supabase } from '../db/supabase.js';

const ROLE_LEVELS = { viewer: 0, editor: 1, owner: 2 };

/**
 * Check if a user has at least `minRole` in a medkit.
 *
 * @param {string} medkitId
 * @param {string} userId
 * @param {'viewer'|'editor'|'owner'} minRole
 * @returns {Promise<boolean>}
 */
export async function checkMedkitRole(medkitId, userId, minRole) {
  const { data: member } = await supabase
    .from('medkit_members')
    .select('role')
    .eq('medkit_id', medkitId)
    .eq('user_id', userId)
    .single();

  if (!member) return false;
  return (ROLE_LEVELS[member.role] ?? -1) >= (ROLE_LEVELS[minRole] ?? 999);
}
