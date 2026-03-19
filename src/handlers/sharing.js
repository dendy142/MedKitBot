import { InlineKeyboard } from 'grammy';
import { supabase } from '../db/supabase.js';
import { getMedkit } from '../db/queries/medkits.js';
import { getMedkitMedicines } from '../db/queries/medicines.js';
import { createInvitation, getInvitationByCode, acceptInvitation, getMedkitInvitations } from '../db/queries/invitations.js';
import { formatQuantity, formatExpiry } from '../utils/format.js';
import { checkAchievements } from './achievements.js';

function getRoleLabels(ctx) {
  return {
    owner: ctx.t('sharing.role_owner'),
    editor: ctx.t('sharing.role_editor'),
    viewer: ctx.t('sharing.role_viewer'),
  };
}

function getRoleEmoji(ctx) {
  return {
    owner: ctx.t('sharing.role_emoji_owner'),
    editor: ctx.t('sharing.role_emoji_editor'),
    viewer: ctx.t('sharing.role_emoji_viewer'),
  };
}

/**
 * Get medkit members with user info
 */
async function getMedkitMembers(medkitId) {
  const { data } = await supabase
    .from('medkit_members')
    .select('*, users(id, telegram_id, username, first_name)')
    .eq('medkit_id', medkitId)
    .order('role', { ascending: true });
  return data || [];
}

/**
 * Display name for a member
 */
function memberDisplayName(ctx, member) {
  const user = member.users;
  if (!user) return ctx.t('sharing.unknown_user');
  if (user.username) return `@${user.username}`;
  return user.first_name || ctx.t('sharing.default_user');
}

/**
 * Check if user is already a member of a medkit
 */
async function isAlreadyMember(medkitId, userId) {
  const { data } = await supabase
    .from('medkit_members')
    .select('id')
    .eq('medkit_id', medkitId)
    .eq('user_id', userId)
    .single();
  return !!data;
}

// ─── Share menu ──────────────────────────────────────────────

async function showShareMenu(ctx, medkitId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit) {
    await ctx.answerCallbackQuery(ctx.t('sharing.medkit_not_found'));
    return;
  }

  if (medkit.role !== 'owner') {
    await ctx.answerCallbackQuery(ctx.t('sharing.owner_only'));
    return;
  }

  const keyboard = new InlineKeyboard()
    .text(ctx.t('sharing.btn_link'), `medkit:${medkitId}:share:link`)
    .text(ctx.t('sharing.btn_username'), `medkit:${medkitId}:share:username`)
    .row()
    .text(ctx.t('sharing.btn_members'), `medkit:${medkitId}:members`)
    .row()
    .text(ctx.t('common.back'), `medkit:${medkitId}`);

  await ctx.editMessageText(
    ctx.t('sharing.share_title', { name: medkit.name }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ─── Share by link — role selection ──────────────────────────

async function showLinkRoleSelect(ctx, medkitId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery(ctx.t('sharing.no_access'));
    return;
  }

  const ROLE_LABELS = getRoleLabels(ctx);
  const keyboard = new InlineKeyboard()
    .text(ROLE_LABELS.editor, `medkit:${medkitId}:share:link:editor`)
    .text(ROLE_LABELS.viewer, `medkit:${medkitId}:share:link:viewer`)
    .row()
    .text(ctx.t('common.back'), `medkit:${medkitId}:share`);

  await ctx.editMessageText(
    ctx.t('sharing.link_role_title'),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ─── Share by link — generate ────────────────────────────────

async function generateShareLink(ctx, medkitId, role) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery(ctx.t('sharing.no_access'));
    return;
  }

  const ROLE_LABELS = getRoleLabels(ctx);
  const invitation = await createInvitation(medkitId, role);
  const link = `https://t.me/my_med_kit_bot?start=invite_${invitation.invite_code}`;

  // Count medicines for pretty invite card (#85)
  const medicines = await getMedkitMedicines(medkitId);
  const medCount = medicines.length;

  const keyboard = new InlineKeyboard()
    .text(ctx.t('sharing.btn_new_link'), `medkit:${medkitId}:share:link`)
    .row()
    .text(ctx.t('common.back'), `medkit:${medkitId}:share`);

  // Pretty invite card (#85)
  const cardText = ctx.t('sharing.invite_card', { name: medkit.name, medCount, link });

  await ctx.editMessageText(cardText, { parse_mode: 'Markdown', reply_markup: keyboard });

  // Award achievement (#90)
  try { await checkAchievements(ctx, 'medkit_shared'); } catch { /* ignore */ }
}

// ─── Share by username — role selection ──────────────────────

async function showUsernameRoleSelect(ctx, medkitId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery(ctx.t('sharing.no_access'));
    return;
  }

  const ROLE_LABELS = getRoleLabels(ctx);
  const keyboard = new InlineKeyboard()
    .text(ROLE_LABELS.editor, `medkit:${medkitId}:share:user:editor`)
    .text(ROLE_LABELS.viewer, `medkit:${medkitId}:share:user:viewer`)
    .row()
    .text(ctx.t('common.back'), `medkit:${medkitId}:share`);

  await ctx.editMessageText(
    ctx.t('sharing.username_role_title'),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ─── Share by username — ask for username text input ─────────

async function askUsername(ctx, medkitId, role) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery(ctx.t('sharing.no_access'));
    return;
  }

  const ROLE_LABELS = getRoleLabels(ctx);
  const msgId = ctx.callbackQuery.message.message_id;

  await supabase.from('sessions').upsert(
    {
      key: `state:${ctx.dbUser.id}`,
      value: { action: 'share_username', medkitId, role, msgId },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );

  const keyboard = new InlineKeyboard()
    .text(ctx.t('common.cancel'), `medkit:${medkitId}:share`);

  await ctx.editMessageText(
    ctx.t('sharing.username_prompt', { role: ROLE_LABELS[role] }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ─── Members list ────────────────────────────────────────────

async function showMembers(ctx, medkitId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit) {
    await ctx.answerCallbackQuery(ctx.t('sharing.medkit_not_found'));
    return;
  }

  const ROLE_LABELS = getRoleLabels(ctx);
  const ROLE_EMOJI = getRoleEmoji(ctx);
  const members = await getMedkitMembers(medkitId);
  const isOwner = medkit.role === 'owner';

  let text = ctx.t('sharing.members_title', { name: medkit.name });

  for (const m of members) {
    const name = memberDisplayName(ctx, m);
    text += `${ROLE_EMOJI[m.role] || '👤'} ${name} — ${ROLE_LABELS[m.role] || m.role}\n`;
  }

  const pendingInvites = await getMedkitInvitations(medkitId);
  if (pendingInvites.length > 0) {
    text += '\n' + ctx.t('sharing.members_pending');
    for (const inv of pendingInvites) {
      const target = inv.invited_username ? `@${inv.invited_username}` : ctx.t('sharing.pending_by_link');
      text += ctx.t('sharing.members_pending_item', { name: target, role: ROLE_LABELS[inv.role] });
    }
  }

  const keyboard = new InlineKeyboard();

  if (isOwner) {
    // Show non-owner members with action buttons
    const nonOwners = members.filter(m => m.role !== 'owner');
    for (const m of nonOwners) {
      const name = memberDisplayName(ctx, m);
      keyboard
        .text(`${ROLE_EMOJI[m.role]} ${name}`, `medkit:${medkitId}:member:${m.id}`)
        .row();
    }
    keyboard.text(ctx.t('sharing.btn_invite'), `medkit:${medkitId}:share`).row();
  }

  // Non-owners can leave
  if (!isOwner) {
    keyboard.text(ctx.t('sharing.btn_leave'), `medkit:${medkitId}:leave`).row();
  }

  keyboard.text(ctx.t('common.back'), isOwner ? `medkit:${medkitId}:share` : `medkit:${medkitId}`);

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// ─── Member detail (for owner) ───────────────────────────────

async function showMemberDetail(ctx, medkitId, memberId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery(ctx.t('sharing.no_access'));
    return;
  }

  const { data: member } = await supabase
    .from('medkit_members')
    .select('*, users(id, telegram_id, username, first_name)')
    .eq('id', memberId)
    .single();

  if (!member) {
    await ctx.answerCallbackQuery(ctx.t('sharing.member_not_found'));
    return;
  }

  const ROLE_LABELS = getRoleLabels(ctx);
  const name = memberDisplayName(ctx, member);

  const keyboard = new InlineKeyboard()
    .text(ctx.t('sharing.btn_change_role'), `medkit:${medkitId}:member:${memberId}:role`)
    .row()
    .text(ctx.t('sharing.btn_transfer'), `medkit:${medkitId}:transfer:${memberId}`)
    .row()
    .text(ctx.t('sharing.btn_remove_member'), `medkit:${medkitId}:member:${memberId}:remove`)
    .row()
    .text(ctx.t('common.back'), `medkit:${medkitId}:members`);

  await ctx.editMessageText(
    ctx.t('sharing.member_detail', { name, role: ROLE_LABELS[member.role] }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ─── Change role ─────────────────────────────────────────────

async function showRoleSelect(ctx, medkitId, memberId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery(ctx.t('sharing.no_access'));
    return;
  }

  const ROLE_LABELS = getRoleLabels(ctx);
  const keyboard = new InlineKeyboard()
    .text(ROLE_LABELS.editor, `medkit:${medkitId}:member:${memberId}:setrole:editor`)
    .text(ROLE_LABELS.viewer, `medkit:${medkitId}:member:${memberId}:setrole:viewer`)
    .row()
    .text(ctx.t('common.back'), `medkit:${medkitId}:member:${memberId}`);

  await ctx.editMessageText(
    ctx.t('sharing.change_role_title'),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

async function setMemberRole(ctx, medkitId, memberId, role) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery(ctx.t('sharing.no_access'));
    return;
  }

  const { data: member } = await supabase
    .from('medkit_members')
    .select('*, users(telegram_id)')
    .eq('id', memberId)
    .single();

  if (!member) {
    await ctx.answerCallbackQuery(ctx.t('sharing.member_not_found'));
    return;
  }

  const ROLE_LABELS = getRoleLabels(ctx);

  await supabase
    .from('medkit_members')
    .update({ role })
    .eq('id', memberId);

  // Notify the member
  try {
    await ctx.api.sendMessage(
      member.users.telegram_id,
      ctx.t('sharing.role_changed_notif', { medkit: medkit.name, role: ROLE_LABELS[role] })
    );
  } catch { /* user may have blocked the bot */ }

  await ctx.answerCallbackQuery(ctx.t('sharing.role_changed_toast'));
  await showMembers(ctx, medkitId);
}

// ─── Remove member ───────────────────────────────────────────

async function confirmRemoveMember(ctx, medkitId, memberId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery(ctx.t('sharing.no_access'));
    return;
  }

  const { data: member } = await supabase
    .from('medkit_members')
    .select('*, users(username, first_name)')
    .eq('id', memberId)
    .single();

  if (!member) {
    await ctx.answerCallbackQuery(ctx.t('sharing.member_not_found'));
    return;
  }

  const name = memberDisplayName(ctx, member);

  const keyboard = new InlineKeyboard()
    .text(ctx.t('common.yes_delete'), `medkit:${medkitId}:member:${memberId}:remove:confirm`)
    .text(ctx.t('common.no'), `medkit:${medkitId}:member:${memberId}`)
    ;

  await ctx.editMessageText(
    ctx.t('sharing.remove_confirm', { name, medkit: medkit.name }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

async function removeMember(ctx, medkitId, memberId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery(ctx.t('sharing.no_access'));
    return;
  }

  const { data: member } = await supabase
    .from('medkit_members')
    .select('*, users(telegram_id)')
    .eq('id', memberId)
    .single();

  if (!member) {
    await ctx.answerCallbackQuery(ctx.t('sharing.member_not_found'));
    return;
  }

  await supabase
    .from('medkit_members')
    .delete()
    .eq('id', memberId);

  // Notify the removed member
  try {
    await ctx.api.sendMessage(
      member.users.telegram_id,
      ctx.t('sharing.remove_notif', { medkit: medkit.name })
    );
  } catch { /* user may have blocked the bot */ }

  await ctx.answerCallbackQuery(ctx.t('sharing.remove_toast'));
  await showMembers(ctx, medkitId);
}

// ─── Leave medkit (non-owner) ────────────────────────────────

async function confirmLeave(ctx, medkitId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit) {
    await ctx.answerCallbackQuery(ctx.t('sharing.medkit_not_found'));
    return;
  }

  if (medkit.role === 'owner') {
    await ctx.answerCallbackQuery(ctx.t('sharing.leave_owner'));
    return;
  }

  const keyboard = new InlineKeyboard()
    .text(ctx.t('sharing.btn_leave_confirm'), `medkit:${medkitId}:leave:confirm`)
    .text(ctx.t('common.no'), `medkit:${medkitId}:members`);

  await ctx.editMessageText(
    ctx.t('sharing.leave_confirm', { name: medkit.name }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

async function leaveMedkit(ctx, medkitId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role === 'owner') {
    await ctx.answerCallbackQuery(ctx.t('sharing.leave_impossible'));
    return;
  }

  await supabase
    .from('medkit_members')
    .delete()
    .eq('medkit_id', medkitId)
    .eq('user_id', ctx.dbUser.id);

  // Notify owner
  try {
    const { data: ownerMember } = await supabase
      .from('medkit_members')
      .select('users(telegram_id)')
      .eq('medkit_id', medkitId)
      .eq('role', 'owner')
      .single();

    if (ownerMember?.users?.telegram_id) {
      const name = ctx.dbUser.username ? `@${ctx.dbUser.username}` : ctx.dbUser.first_name || ctx.t('sharing.default_user');
      await ctx.api.sendMessage(
        ownerMember.users.telegram_id,
        ctx.t('sharing.leave_owner_notif', { name, medkit: medkit.name })
      );
    }
  } catch { /* ignore */ }

  await ctx.answerCallbackQuery(ctx.t('sharing.leave_toast'));

  // Go back to medkit list
  const { getUserMedkits } = await import('../db/queries/medkits.js');
  const medkits = await getUserMedkits(ctx.dbUser.id);

  const keyboard = new InlineKeyboard();
  if (medkits.length === 0) {
    keyboard.text(ctx.t('medkit.btn_create'), 'medkit:create').row();
  }
  keyboard.text(ctx.t('medkit.btn_to_medkits'), 'medkits');

  await ctx.editMessageText(
    ctx.t('sharing.leave_done', { name: medkit.name }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ─── Transfer ownership ─────────────────────────────────────

async function confirmTransfer(ctx, medkitId, memberId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery(ctx.t('sharing.no_access'));
    return;
  }

  const { data: member } = await supabase
    .from('medkit_members')
    .select('*, users(username, first_name)')
    .eq('id', memberId)
    .single();

  if (!member) {
    await ctx.answerCallbackQuery(ctx.t('sharing.member_not_found'));
    return;
  }

  const name = memberDisplayName(ctx, member);

  const keyboard = new InlineKeyboard()
    .text(ctx.t('sharing.btn_transfer_confirm'), `medkit:${medkitId}:transfer:${memberId}:confirm`)
    .text(ctx.t('common.no'), `medkit:${medkitId}:member:${memberId}`);

  await ctx.editMessageText(
    ctx.t('sharing.transfer_confirm', { medkit: medkit.name, name }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

async function transferOwnership(ctx, medkitId, memberId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery(ctx.t('sharing.no_access'));
    return;
  }

  const { data: member } = await supabase
    .from('medkit_members')
    .select('*, users(id, telegram_id, username, first_name)')
    .eq('id', memberId)
    .single();

  if (!member) {
    await ctx.answerCallbackQuery(ctx.t('sharing.member_not_found'));
    return;
  }

  // Get current owner's membership
  const { data: ownerMembership } = await supabase
    .from('medkit_members')
    .select('id')
    .eq('medkit_id', medkitId)
    .eq('user_id', ctx.dbUser.id)
    .single();

  // Update roles
  await supabase
    .from('medkit_members')
    .update({ role: 'editor' })
    .eq('id', ownerMembership.id);

  await supabase
    .from('medkit_members')
    .update({ role: 'owner' })
    .eq('id', memberId);

  // Update medkits.owner_id
  await supabase
    .from('medkits')
    .update({ owner_id: member.users.id })
    .eq('id', medkitId);

  // Notify new owner
  const name = memberDisplayName(ctx, member);
  try {
    await ctx.api.sendMessage(
      member.users.telegram_id,
      ctx.t('sharing.transfer_notif', { name: medkit.name })
    );
  } catch { /* user may have blocked the bot */ }

  await ctx.answerCallbackQuery(ctx.t('sharing.transfer_toast'));

  const keyboard = new InlineKeyboard()
    .text(ctx.t('medkit.btn_to_medkit'), `medkit:${medkitId}`);

  await ctx.editMessageText(
    ctx.t('sharing.transfer_done', { medkit: medkit.name, name }),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ─── Handle invite deep link (called from start.js) ─────────

export async function handleInviteDeepLink(ctx, inviteCode) {
  const invitation = await getInvitationByCode(inviteCode);

  if (!invitation) {
    await ctx.reply(
      ctx.t('sharing.invite_invalid'),
      {
        reply_markup: new InlineKeyboard().text(ctx.t('common.main_menu'), 'main_menu'),
      }
    );
    return;
  }

  const medkitName = invitation.medkits?.name || ctx.t('sharing.invite_unknown_medkit');

  // Check if user is already a member
  const alreadyMember = await isAlreadyMember(invitation.medkit_id, ctx.dbUser.id);
  if (alreadyMember) {
    await ctx.reply(
      ctx.t('sharing.invite_already_member', { name: medkitName }),
      {
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.open'), `medkit:${invitation.medkit_id}`)
          .text(ctx.t('common.main_menu'), 'main_menu'),
      }
    );
    return;
  }

  // Check if invitation is for specific username
  if (invitation.invited_username && invitation.invited_username !== ctx.dbUser.username) {
    await ctx.reply(
      ctx.t('sharing.invite_wrong_user'),
      {
        reply_markup: new InlineKeyboard().text(ctx.t('common.main_menu'), 'main_menu'),
      }
    );
    return;
  }

  // Check if user is the owner (can't accept own invitation)
  if (invitation.medkits?.owner_id === ctx.dbUser.id) {
    await ctx.reply(
      ctx.t('sharing.invite_is_owner'),
      {
        reply_markup: new InlineKeyboard().text(ctx.t('common.main_menu'), 'main_menu'),
      }
    );
    return;
  }

  // Accept the invitation
  const result = await acceptInvitation(invitation.id, ctx.dbUser.id);
  if (!result) {
    await ctx.reply(
      ctx.t('sharing.invite_failed'),
      {
        reply_markup: new InlineKeyboard().text(ctx.t('common.main_menu'), 'main_menu'),
      }
    );
    return;
  }

  const ROLE_LABELS = getRoleLabels(ctx);
  await ctx.reply(
    ctx.t('sharing.invite_accepted', { name: medkitName, role: ROLE_LABELS[invitation.role] }),
    {
      reply_markup: new InlineKeyboard()
        .text(ctx.t('common.open'), `medkit:${invitation.medkit_id}`)
        .text(ctx.t('common.main_menu'), 'main_menu'),
    }
  );

  // Notify the owner
  try {
    if (invitation.medkits?.owner_id) {
      const { data: owner } = await supabase
        .from('users')
        .select('telegram_id')
        .eq('id', invitation.medkits.owner_id)
        .single();

      if (owner?.telegram_id) {
        const inviteeName = ctx.dbUser.username ? `@${ctx.dbUser.username}` : ctx.dbUser.first_name || ctx.t('sharing.default_user');
        await ctx.api.sendMessage(
          owner.telegram_id,
          ctx.t('sharing.invite_owner_notif', { name: inviteeName, medkit: medkitName })
        );
      }
    }
  } catch { /* ignore */ }
}

// ─── Handle text input for share by username ─────────────────

export async function handleShareText(ctx, state) {
  const { medkitId, role, msgId } = state;
  const text = ctx.message.text.trim().replace(/^@/, '');

  try { await ctx.deleteMessage(); } catch { /* ignore */ }

  if (!text) {
    await editBotMsg(ctx, msgId,
      ctx.t('sharing.username_invalid'),
      new InlineKeyboard().text(ctx.t('common.back'), `medkit:${medkitId}:share`)
    );
    return;
  }

  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit) {
    await editBotMsg(ctx, msgId,
      ctx.t('sharing.medkit_not_found_text'),
      new InlineKeyboard().text(ctx.t('common.back'), 'medkits')
    );
    return;
  }

  // Look up the user
  const { data: targetUser } = await supabase
    .from('users')
    .select('*')
    .eq('username', text)
    .single();

  if (!targetUser) {
    await editBotMsg(ctx, msgId,
      ctx.t('sharing.username_not_found', { name: text }),
      new InlineKeyboard()
        .text(ctx.t('common.retry'), `medkit:${medkitId}:share:user:${role}`)
        .row()
        .text(ctx.t('common.back'), `medkit:${medkitId}:share`)
    );
    return;
  }

  // Check if already a member
  const alreadyMember = await isAlreadyMember(medkitId, targetUser.id);
  if (alreadyMember) {
    await editBotMsg(ctx, msgId,
      ctx.t('sharing.username_already_member', { name: text }),
      new InlineKeyboard().text(ctx.t('common.back'), `medkit:${medkitId}:share`)
    );
    return;
  }

  // Check if it's the owner themselves
  if (targetUser.id === ctx.dbUser.id) {
    await editBotMsg(ctx, msgId,
      ctx.t('sharing.username_self'),
      new InlineKeyboard().text(ctx.t('common.back'), `medkit:${medkitId}:share`)
    );
    return;
  }

  const ROLE_LABELS = getRoleLabels(ctx);

  // Create invitation
  const invitation = await createInvitation(medkitId, role, text);
  const link = `https://t.me/my_med_kit_bot?start=invite_${invitation.invite_code}`;

  // Send notification to the invited user
  try {
    await ctx.api.sendMessage(
      targetUser.telegram_id,
      ctx.t('sharing.username_notif', { medkit: medkit.name, role: ROLE_LABELS[role] }),
      {
        reply_markup: new InlineKeyboard()
          .url(ctx.t('sharing.btn_accept'), link),
      }
    );
  } catch {
    // User may have blocked the bot
    await editBotMsg(ctx, msgId,
      ctx.t('sharing.username_notif_fail', { name: text, link }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(ctx.t('common.back'), `medkit:${medkitId}:share`),
      }
    );
    return;
  }

  await editBotMsg(ctx, msgId,
    ctx.t('sharing.username_sent', { name: text, role: ROLE_LABELS[role] }),
    new InlineKeyboard()
      .text(ctx.t('sharing.btn_invite_more'), `medkit:${medkitId}:share:username`)
      .row()
      .text(ctx.t('common.back'), `medkit:${medkitId}:share`)
  );
}

function editBotMsg(ctx, msgId, text, keyboard) {
  const opts = { parse_mode: 'Markdown' };
  if (keyboard instanceof InlineKeyboard) {
    opts.reply_markup = keyboard;
  } else if (keyboard?.reply_markup) {
    Object.assign(opts, keyboard);
  }

  if (msgId) {
    return ctx.api.editMessageText(ctx.chat.id, msgId, text, opts);
  }
  return ctx.reply(text, opts);
}

// ─── Register all sharing handlers ──────────────────────────

export function registerSharingHandlers(bot) {
  // Share menu
  bot.callbackQuery(/^medkit:([0-9a-f-]+):share$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showShareMenu(ctx, ctx.match[1]);
  });

  // Share by link — role selection
  bot.callbackQuery(/^medkit:([0-9a-f-]+):share:link$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showLinkRoleSelect(ctx, ctx.match[1]);
  });

  // Share by link — generate with role
  bot.callbackQuery(/^medkit:([0-9a-f-]+):share:link:(editor|viewer)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await generateShareLink(ctx, ctx.match[1], ctx.match[2]);
  });

  // Share by username — role selection
  bot.callbackQuery(/^medkit:([0-9a-f-]+):share:username$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showUsernameRoleSelect(ctx, ctx.match[1]);
  });

  // Share by username — ask for text input after role
  bot.callbackQuery(/^medkit:([0-9a-f-]+):share:user:(editor|viewer)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await askUsername(ctx, ctx.match[1], ctx.match[2]);
  });

  // Members list
  bot.callbackQuery(/^medkit:([0-9a-f-]+):members$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMembers(ctx, ctx.match[1]);
  });

  // Member detail
  bot.callbackQuery(/^medkit:([0-9a-f-]+):member:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMemberDetail(ctx, ctx.match[1], ctx.match[2]);
  });

  // Change role — show selection
  bot.callbackQuery(/^medkit:([0-9a-f-]+):member:([0-9a-f-]+):role$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showRoleSelect(ctx, ctx.match[1], ctx.match[2]);
  });

  // Set role
  bot.callbackQuery(/^medkit:([0-9a-f-]+):member:([0-9a-f-]+):setrole:(editor|viewer)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await setMemberRole(ctx, ctx.match[1], ctx.match[2], ctx.match[3]);
  });

  // Remove member — confirm
  bot.callbackQuery(/^medkit:([0-9a-f-]+):member:([0-9a-f-]+):remove$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await confirmRemoveMember(ctx, ctx.match[1], ctx.match[2]);
  });

  // Remove member — confirmed
  bot.callbackQuery(/^medkit:([0-9a-f-]+):member:([0-9a-f-]+):remove:confirm$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await removeMember(ctx, ctx.match[1], ctx.match[2]);
  });

  // Leave medkit — confirm
  bot.callbackQuery(/^medkit:([0-9a-f-]+):leave$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await confirmLeave(ctx, ctx.match[1]);
  });

  // Leave medkit — confirmed
  bot.callbackQuery(/^medkit:([0-9a-f-]+):leave:confirm$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await leaveMedkit(ctx, ctx.match[1]);
  });

  // Transfer ownership — confirm
  bot.callbackQuery(/^medkit:([0-9a-f-]+):transfer:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await confirmTransfer(ctx, ctx.match[1], ctx.match[2]);
  });

  // Transfer ownership — confirmed
  bot.callbackQuery(/^medkit:([0-9a-f-]+):transfer:([0-9a-f-]+):confirm$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await transferOwnership(ctx, ctx.match[1], ctx.match[2]);
  });

  // Share medicine list (#86)
  bot.callbackQuery(/^medkit:([0-9a-f-]+):share_list$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];
    const medkit = await getMedkit(medkitId, ctx.dbUser.id);
    if (!medkit) return;

    const medicines = await getMedkitMedicines(medkitId);
    if (medicines.length === 0) {
      return;
    }

    let text = ctx.t('sharing.share_list_title', { name: medkit.name });
    medicines.forEach((med, i) => {
      const qty = formatQuantity(med.quantity, med.quantity_unit);
      const expiry = med.expiry_date ? formatExpiry(med.expiry_date) : '—';
      text += ctx.t('sharing.share_list_item', { n: i + 1, med: `${med.name}${med.dosage ? ' ' + med.dosage : ''}`, qty, expiry });
    });
    text += ctx.t('sharing.share_list_footer');

    // Send as new message (can be forwarded)
    await ctx.reply(text);
  });

  // Export for doctor (#88)
  bot.callbackQuery(/^medkit:([0-9a-f-]+):doctor$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];
    const medkit = await getMedkit(medkitId, ctx.dbUser.id);
    if (!medkit) return;

    const medicines = await getMedkitMedicines(medkitId);
    if (medicines.length === 0) {
      await ctx.reply(ctx.t('sharing.export_doctor_empty'));
      return;
    }

    let text = ctx.t('sharing.export_doctor_title');

    // Patient info (try profiles)
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', ctx.dbUser.id)
      .limit(1);
    if (profiles && profiles.length > 0) {
      const p = profiles[0];
      text += ctx.t('sharing.export_doctor_patient', { name: `${p.icon || ''} ${p.name}`.trim() });
      if (p.birth_year) {
        const age = new Date().getFullYear() - p.birth_year;
        text += ctx.t('sharing.export_doctor_age', { age });
      }
    } else if (ctx.dbUser.first_name) {
      text += ctx.t('sharing.export_doctor_patient', { name: ctx.dbUser.first_name });
    }

    text += ctx.t('sharing.export_doctor_meds');

    for (let i = 0; i < medicines.length; i++) {
      const med = medicines[i];
      const dosage = med.dosage ? ` ${med.dosage}` : '';

      // Get schedules for this medicine
      const { data: scheds } = await supabase
        .from('schedules')
        .select('*')
        .eq('medicine_id', med.id)
        .eq('status', 'active');

      let schedule = '';
      if (scheds && scheds.length > 0) {
        const times = scheds.map(s => s.time_value).join(', ');
        schedule = ` — ${scheds[0].dose_per_intake} ${med.quantity_unit || 'шт'} x ${scheds.length} раз/день (${times})`;
      }

      text += ctx.t('sharing.export_doctor_med_item', { n: i + 1, name: med.name, dosage, schedule });
    }

    // Tags
    const allTags = new Set();
    medicines.forEach(m => (m.tags || []).forEach(t => allTags.add(t)));
    if (allTags.size > 0) {
      text += ctx.t('sharing.export_doctor_tags', { tags: [...allTags].join(', ') });
    }

    await ctx.reply(text, { parse_mode: 'Markdown' });
  });
}
