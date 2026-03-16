import { InlineKeyboard } from 'grammy';
import { supabase } from '../db/supabase.js';
import { getMedkit } from '../db/queries/medkits.js';
import { createInvitation, getInvitationByCode, acceptInvitation, getMedkitInvitations } from '../db/queries/invitations.js';

const ROLE_LABELS = {
  owner: '👑 Владелец',
  editor: '✏️ Редактор',
  viewer: '👁 Только просмотр',
};

const ROLE_EMOJI = {
  owner: '👑',
  editor: '✏️',
  viewer: '👁',
};

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
function memberDisplayName(member) {
  const user = member.users;
  if (!user) return 'Неизвестный';
  if (user.username) return `@${user.username}`;
  return user.first_name || 'Пользователь';
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
    await ctx.answerCallbackQuery('Аптечка не найдена');
    return;
  }

  if (medkit.role !== 'owner') {
    await ctx.answerCallbackQuery('Только владелец может делиться аптечкой');
    return;
  }

  const keyboard = new InlineKeyboard()
    .text('🔗 По ссылке', `medkit:${medkitId}:share:link`)
    .text('📝 По @username', `medkit:${medkitId}:share:username`)
    .row()
    .text('👥 Участники', `medkit:${medkitId}:members`)
    .row()
    .text('◀️ Назад', `medkit:${medkitId}`);

  await ctx.editMessageText(
    `👥 *Поделиться аптечкой «${medkit.name}»*\n\nВыберите способ:`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ─── Share by link — role selection ──────────────────────────

async function showLinkRoleSelect(ctx, medkitId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery('Нет доступа');
    return;
  }

  const keyboard = new InlineKeyboard()
    .text('✏️ Редактор', `medkit:${medkitId}:share:link:editor`)
    .text('👁 Только просмотр', `medkit:${medkitId}:share:link:viewer`)
    .row()
    .text('◀️ Назад', `medkit:${medkitId}:share`);

  await ctx.editMessageText(
    '🔗 *Приглашение по ссылке*\n\nВыберите роль для приглашённого:',
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ─── Share by link — generate ────────────────────────────────

async function generateShareLink(ctx, medkitId, role) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery('Нет доступа');
    return;
  }

  const invitation = await createInvitation(medkitId, role);
  const link = `https://t.me/my_med_kit_bot?start=invite_${invitation.invite_code}`;

  const keyboard = new InlineKeyboard()
    .text('🔗 Новая ссылка', `medkit:${medkitId}:share:link`)
    .row()
    .text('◀️ Назад', `medkit:${medkitId}:share`);

  await ctx.editMessageText(
    `🔗 *Ссылка-приглашение*\n\nРоль: ${ROLE_LABELS[role]}\nАптечка: *${medkit.name}*\n\nОтправьте эту ссылку:\n\`${link}\``,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ─── Share by username — role selection ──────────────────────

async function showUsernameRoleSelect(ctx, medkitId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery('Нет доступа');
    return;
  }

  const keyboard = new InlineKeyboard()
    .text('✏️ Редактор', `medkit:${medkitId}:share:user:editor`)
    .text('👁 Только просмотр', `medkit:${medkitId}:share:user:viewer`)
    .row()
    .text('◀️ Назад', `medkit:${medkitId}:share`);

  await ctx.editMessageText(
    '📝 *Приглашение по username*\n\nВыберите роль для приглашённого:',
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ─── Share by username — ask for username text input ─────────

async function askUsername(ctx, medkitId, role) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery('Нет доступа');
    return;
  }

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
    .text('❌ Отмена', `medkit:${medkitId}:share`);

  await ctx.editMessageText(
    `📝 *Приглашение по username*\n\nРоль: ${ROLE_LABELS[role]}\n\nВведите username пользователя:`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ─── Members list ────────────────────────────────────────────

async function showMembers(ctx, medkitId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit) {
    await ctx.answerCallbackQuery('Аптечка не найдена');
    return;
  }

  const members = await getMedkitMembers(medkitId);
  const isOwner = medkit.role === 'owner';

  let text = `👥 *Участники: ${medkit.name}*\n\n`;

  for (const m of members) {
    const name = memberDisplayName(m);
    text += `${ROLE_EMOJI[m.role] || '👤'} ${name} — ${ROLE_LABELS[m.role] || m.role}\n`;
  }

  const pendingInvites = await getMedkitInvitations(medkitId);
  if (pendingInvites.length > 0) {
    text += '\n📨 *Ожидают принятия:*\n';
    for (const inv of pendingInvites) {
      const target = inv.invited_username ? `@${inv.invited_username}` : 'по ссылке';
      text += `⏳ ${target} — ${ROLE_LABELS[inv.role]}\n`;
    }
  }

  const keyboard = new InlineKeyboard();

  if (isOwner) {
    // Show non-owner members with action buttons
    const nonOwners = members.filter(m => m.role !== 'owner');
    for (const m of nonOwners) {
      const name = memberDisplayName(m);
      keyboard
        .text(`${ROLE_EMOJI[m.role]} ${name}`, `medkit:${medkitId}:member:${m.id}`)
        .row();
    }
    keyboard.text('📨 Пригласить', `medkit:${medkitId}:share`).row();
  }

  // Non-owners can leave
  if (!isOwner) {
    keyboard.text('🚪 Покинуть аптечку', `medkit:${medkitId}:leave`).row();
  }

  keyboard.text('◀️ Назад', isOwner ? `medkit:${medkitId}:share` : `medkit:${medkitId}`);

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// ─── Member detail (for owner) ───────────────────────────────

async function showMemberDetail(ctx, medkitId, memberId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery('Нет доступа');
    return;
  }

  const { data: member } = await supabase
    .from('medkit_members')
    .select('*, users(id, telegram_id, username, first_name)')
    .eq('id', memberId)
    .single();

  if (!member) {
    await ctx.answerCallbackQuery('Участник не найден');
    return;
  }

  const name = memberDisplayName(member);

  const keyboard = new InlineKeyboard()
    .text('✏️ Изменить роль', `medkit:${medkitId}:member:${memberId}:role`)
    .row()
    .text('👑 Передать владение', `medkit:${medkitId}:transfer:${memberId}`)
    .row()
    .text('🗑 Удалить участника', `medkit:${medkitId}:member:${memberId}:remove`)
    .row()
    .text('◀️ Назад', `medkit:${medkitId}:members`);

  await ctx.editMessageText(
    `👤 *Участник: ${name}*\nРоль: ${ROLE_LABELS[member.role]}\n\nВыберите действие:`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ─── Change role ─────────────────────────────────────────────

async function showRoleSelect(ctx, medkitId, memberId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery('Нет доступа');
    return;
  }

  const keyboard = new InlineKeyboard()
    .text('✏️ Редактор', `medkit:${medkitId}:member:${memberId}:setrole:editor`)
    .text('👁 Только просмотр', `medkit:${medkitId}:member:${memberId}:setrole:viewer`)
    .row()
    .text('◀️ Назад', `medkit:${medkitId}:member:${memberId}`);

  await ctx.editMessageText(
    '🔄 *Изменить роль*\n\nВыберите новую роль:',
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

async function setMemberRole(ctx, medkitId, memberId, role) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery('Нет доступа');
    return;
  }

  const { data: member } = await supabase
    .from('medkit_members')
    .select('*, users(telegram_id)')
    .eq('id', memberId)
    .single();

  if (!member) {
    await ctx.answerCallbackQuery('Участник не найден');
    return;
  }

  await supabase
    .from('medkit_members')
    .update({ role })
    .eq('id', memberId);

  // Notify the member
  try {
    await ctx.api.sendMessage(
      member.users.telegram_id,
      `🔄 Ваша роль в аптечке «${medkit.name}» изменена на: ${ROLE_LABELS[role]}`
    );
  } catch { /* user may have blocked the bot */ }

  await ctx.answerCallbackQuery('Роль изменена');
  await showMembers(ctx, medkitId);
}

// ─── Remove member ───────────────────────────────────────────

async function confirmRemoveMember(ctx, medkitId, memberId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery('Нет доступа');
    return;
  }

  const { data: member } = await supabase
    .from('medkit_members')
    .select('*, users(username, first_name)')
    .eq('id', memberId)
    .single();

  if (!member) {
    await ctx.answerCallbackQuery('Участник не найден');
    return;
  }

  const name = memberDisplayName(member);

  const keyboard = new InlineKeyboard()
    .text('✅ Да, удалить', `medkit:${medkitId}:member:${memberId}:remove:confirm`)
    .text('❌ Нет', `medkit:${medkitId}:member:${memberId}`)
    ;

  await ctx.editMessageText(
    `🗑 Удалить участника *${name}* из аптечки «${medkit.name}»?`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

async function removeMember(ctx, medkitId, memberId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery('Нет доступа');
    return;
  }

  const { data: member } = await supabase
    .from('medkit_members')
    .select('*, users(telegram_id)')
    .eq('id', memberId)
    .single();

  if (!member) {
    await ctx.answerCallbackQuery('Участник не найден');
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
      `❌ Вы были удалены из аптечки «${medkit.name}».`
    );
  } catch { /* user may have blocked the bot */ }

  await ctx.answerCallbackQuery('Участник удалён');
  await showMembers(ctx, medkitId);
}

// ─── Leave medkit (non-owner) ────────────────────────────────

async function confirmLeave(ctx, medkitId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit) {
    await ctx.answerCallbackQuery('Аптечка не найдена');
    return;
  }

  if (medkit.role === 'owner') {
    await ctx.answerCallbackQuery('Владелец не может покинуть аптечку. Сначала передайте владение.');
    return;
  }

  const keyboard = new InlineKeyboard()
    .text('✅ Да, покинуть', `medkit:${medkitId}:leave:confirm`)
    .text('❌ Нет', `medkit:${medkitId}:members`);

  await ctx.editMessageText(
    `🚪 Вы уверены, что хотите покинуть аптечку «${medkit.name}»?`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

async function leaveMedkit(ctx, medkitId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role === 'owner') {
    await ctx.answerCallbackQuery('Невозможно покинуть аптечку');
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
      const name = ctx.dbUser.username ? `@${ctx.dbUser.username}` : ctx.dbUser.first_name || 'Пользователь';
      await ctx.api.sendMessage(
        ownerMember.users.telegram_id,
        `🚪 ${name} покинул(а) аптечку «${medkit.name}».`
      );
    }
  } catch { /* ignore */ }

  await ctx.answerCallbackQuery('Вы покинули аптечку');

  // Go back to medkit list
  const { getUserMedkits } = await import('../db/queries/medkits.js');
  const medkits = await getUserMedkits(ctx.dbUser.id);

  const keyboard = new InlineKeyboard();
  if (medkits.length === 0) {
    keyboard.text('➕ Создать аптечку', 'medkit:create').row();
  }
  keyboard.text('◀️ К аптечкам', 'medkits');

  await ctx.editMessageText(
    `✅ Вы покинули аптечку «${medkit.name}».`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ─── Transfer ownership ─────────────────────────────────────

async function confirmTransfer(ctx, medkitId, memberId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery('Нет доступа');
    return;
  }

  const { data: member } = await supabase
    .from('medkit_members')
    .select('*, users(username, first_name)')
    .eq('id', memberId)
    .single();

  if (!member) {
    await ctx.answerCallbackQuery('Участник не найден');
    return;
  }

  const name = memberDisplayName(member);

  const keyboard = new InlineKeyboard()
    .text('✅ Да, передать', `medkit:${medkitId}:transfer:${memberId}:confirm`)
    .text('❌ Нет', `medkit:${medkitId}:member:${memberId}`);

  await ctx.editMessageText(
    `👑 *Передача владения*\n\nВы уверены, что хотите передать владение аптечкой «${medkit.name}» пользователю *${name}*?\n\n⚠️ Вы станете редактором.`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

async function transferOwnership(ctx, medkitId, memberId) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit || medkit.role !== 'owner') {
    await ctx.answerCallbackQuery('Нет доступа');
    return;
  }

  const { data: member } = await supabase
    .from('medkit_members')
    .select('*, users(id, telegram_id, username, first_name)')
    .eq('id', memberId)
    .single();

  if (!member) {
    await ctx.answerCallbackQuery('Участник не найден');
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
  const name = memberDisplayName(member);
  try {
    await ctx.api.sendMessage(
      member.users.telegram_id,
      `👑 Вам передано владение аптечкой «${medkit.name}»!`
    );
  } catch { /* user may have blocked the bot */ }

  await ctx.answerCallbackQuery('Владение передано');

  const keyboard = new InlineKeyboard()
    .text('◀️ К аптечке', `medkit:${medkitId}`);

  await ctx.editMessageText(
    `✅ Владение аптечкой «${medkit.name}» передано пользователю *${name}*.\n\nВаша новая роль: ✏️ Редактор`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

// ─── Handle invite deep link (called from start.js) ─────────

export async function handleInviteDeepLink(ctx, inviteCode) {
  const invitation = await getInvitationByCode(inviteCode);

  if (!invitation) {
    await ctx.reply(
      '❌ Приглашение недействительно или срок его действия истёк.',
      {
        reply_markup: new InlineKeyboard().text('🏠 Меню', 'main_menu'),
      }
    );
    return;
  }

  const medkitName = invitation.medkits?.name || 'Неизвестная аптечка';

  // Check if user is already a member
  const alreadyMember = await isAlreadyMember(invitation.medkit_id, ctx.dbUser.id);
  if (alreadyMember) {
    await ctx.reply(
      `ℹ️ Вы уже являетесь участником аптечки «${medkitName}».`,
      {
        reply_markup: new InlineKeyboard()
          .text('📦 Открыть', `medkit:${invitation.medkit_id}`)
          .text('🏠 Меню', 'main_menu'),
      }
    );
    return;
  }

  // Check if invitation is for specific username
  if (invitation.invited_username && invitation.invited_username !== ctx.dbUser.username) {
    await ctx.reply(
      '❌ Это приглашение предназначено для другого пользователя.',
      {
        reply_markup: new InlineKeyboard().text('🏠 Меню', 'main_menu'),
      }
    );
    return;
  }

  // Check if user is the owner (can't accept own invitation)
  if (invitation.medkits?.owner_id === ctx.dbUser.id) {
    await ctx.reply(
      'ℹ️ Вы являетесь владельцем этой аптечки.',
      {
        reply_markup: new InlineKeyboard().text('🏠 Меню', 'main_menu'),
      }
    );
    return;
  }

  // Accept the invitation
  const result = await acceptInvitation(invitation.id, ctx.dbUser.id);
  if (!result) {
    await ctx.reply(
      '❌ Не удалось принять приглашение. Попробуйте позже.',
      {
        reply_markup: new InlineKeyboard().text('🏠 Меню', 'main_menu'),
      }
    );
    return;
  }

  await ctx.reply(
    `✅ Вы присоединились к аптечке «${medkitName}»!\n\nРоль: ${ROLE_LABELS[invitation.role]}`,
    {
      reply_markup: new InlineKeyboard()
        .text('📦 Открыть', `medkit:${invitation.medkit_id}`)
        .text('🏠 Меню', 'main_menu'),
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
        const inviteeName = ctx.dbUser.username ? `@${ctx.dbUser.username}` : ctx.dbUser.first_name || 'Пользователь';
        await ctx.api.sendMessage(
          owner.telegram_id,
          `👥 ${inviteeName} присоединился к аптечке «${medkitName}»!`
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
      '⚠️ Введите корректный username.',
      new InlineKeyboard().text('◀️ Назад', `medkit:${medkitId}:share`)
    );
    return;
  }

  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit) {
    await editBotMsg(ctx, msgId,
      '❌ Аптечка не найдена.',
      new InlineKeyboard().text('◀️ Назад', 'medkits')
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
      `❌ Пользователь @${text} не найден.\n\nПользователь должен сначала написать боту.`,
      new InlineKeyboard()
        .text('🔄 Попробовать снова', `medkit:${medkitId}:share:user:${role}`)
        .row()
        .text('◀️ Назад', `medkit:${medkitId}:share`)
    );
    return;
  }

  // Check if already a member
  const alreadyMember = await isAlreadyMember(medkitId, targetUser.id);
  if (alreadyMember) {
    await editBotMsg(ctx, msgId,
      `ℹ️ @${text} уже является участником этой аптечки.`,
      new InlineKeyboard().text('◀️ Назад', `medkit:${medkitId}:share`)
    );
    return;
  }

  // Check if it's the owner themselves
  if (targetUser.id === ctx.dbUser.id) {
    await editBotMsg(ctx, msgId,
      'ℹ️ Вы не можете пригласить самого себя.',
      new InlineKeyboard().text('◀️ Назад', `medkit:${medkitId}:share`)
    );
    return;
  }

  // Create invitation
  const invitation = await createInvitation(medkitId, role, text);
  const link = `https://t.me/my_med_kit_bot?start=invite_${invitation.invite_code}`;

  // Send notification to the invited user
  try {
    await ctx.api.sendMessage(
      targetUser.telegram_id,
      `📨 Вас пригласили в аптечку «${medkit.name}»!\n\nРоль: ${ROLE_LABELS[role]}\n\nНажмите, чтобы принять:`,
      {
        reply_markup: new InlineKeyboard()
          .url('✅ Принять приглашение', link),
      }
    );
  } catch {
    // User may have blocked the bot
    await editBotMsg(ctx, msgId,
      `⚠️ Не удалось отправить уведомление @${text}. Возможно, пользователь заблокировал бота.\n\nСсылка-приглашение:\n\`${link}\``,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('◀️ Назад', `medkit:${medkitId}:share`),
      }
    );
    return;
  }

  await editBotMsg(ctx, msgId,
    `✅ Приглашение отправлено @${text}!\n\nРоль: ${ROLE_LABELS[role]}`,
    new InlineKeyboard()
      .text('📨 Пригласить ещё', `medkit:${medkitId}:share:username`)
      .row()
      .text('◀️ Назад', `medkit:${medkitId}:share`)
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
}
