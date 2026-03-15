import { supabase } from '../supabase.js';

/**
 * Create an invitation
 */
export async function createInvitation(medkitId, role = 'editor', invitedUsername = null) {
  const inviteCode = Math.random().toString(36).substring(2, 10);

  const { data, error } = await supabase
    .from('invitations')
    .insert({
      medkit_id: medkitId,
      invite_code: inviteCode,
      invited_username: invitedUsername,
      role,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get invitation by code
 */
export async function getInvitationByCode(inviteCode) {
  const { data } = await supabase
    .from('invitations')
    .select('*, medkits(name, owner_id)')
    .eq('invite_code', inviteCode)
    .eq('status', 'pending')
    .single();
  return data;
}

/**
 * Accept an invitation
 */
export async function acceptInvitation(invitationId, userId) {
  const invitation = await getInvitationById(invitationId);
  if (!invitation) return null;

  // Add user as member
  await supabase.from('medkit_members').insert({
    medkit_id: invitation.medkit_id,
    user_id: userId,
    role: invitation.role,
  });

  // Mark invitation as accepted
  await supabase
    .from('invitations')
    .update({ status: 'accepted' })
    .eq('id', invitationId);

  return invitation;
}

/**
 * Get invitation by ID
 */
async function getInvitationById(invitationId) {
  const { data } = await supabase
    .from('invitations')
    .select('*')
    .eq('id', invitationId)
    .single();
  return data;
}

/**
 * Get pending invitations for a medkit
 */
export async function getMedkitInvitations(medkitId) {
  const { data } = await supabase
    .from('invitations')
    .select('*')
    .eq('medkit_id', medkitId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return data || [];
}

/**
 * Expire old invitations
 */
export async function expireOldInvitations() {
  await supabase
    .from('invitations')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString());
}
