/**
 * Profiles handler — Wave 3: Family & Profiles (#46-#63)
 *
 * New DB tables (to be created separately):
 *
 * CREATE TABLE profiles (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 *   name TEXT NOT NULL,
 *   birth_year INTEGER,
 *   icon TEXT DEFAULT '👤',
 *   tags JSONB DEFAULT '[]',
 *   created_at TIMESTAMPTZ DEFAULT now()
 * );
 *
 * CREATE TABLE medicine_notes (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   medicine_id UUID REFERENCES medicines(id) ON DELETE CASCADE,
 *   user_id UUID REFERENCES users(id),
 *   text TEXT NOT NULL,
 *   created_at TIMESTAMPTZ DEFAULT now()
 * );
 * CREATE INDEX idx_medicine_notes_medicine ON medicine_notes (medicine_id);
 *
 * CREATE TABLE wellbeing_logs (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id UUID REFERENCES users(id),
 *   profile_id UUID REFERENCES profiles(id),
 *   date DATE NOT NULL,
 *   mood TEXT NOT NULL, -- 'good', 'ok', 'bad'
 *   note TEXT,
 *   created_at TIMESTAMPTZ DEFAULT now()
 * );
 * CREATE UNIQUE INDEX idx_wellbeing_user_profile_date ON wellbeing_logs (user_id, profile_id, date) WHERE profile_id IS NOT NULL;
 * CREATE UNIQUE INDEX idx_wellbeing_user_date_no_profile ON wellbeing_logs (user_id, date) WHERE profile_id IS NULL;
 *
 * Additional columns needed:
 *   ALTER TABLE medicines ADD COLUMN profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
 *   ALTER TABLE schedules ADD COLUMN profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
 *   ALTER TABLE intake_logs ADD COLUMN notes TEXT;
 *   ALTER TABLE intake_logs ADD COLUMN skip_reason TEXT;
 */

import { InlineKeyboard } from 'grammy';
import { supabase } from '../db/supabase.js';
import { updateUserSettings } from '../db/queries/users.js';
import ru from '../locales/ru.js';

// Profile icon options
const PROFILE_ICONS = ['👶', '👦', '👧', '👨', '👩', '👴', '👵', '🐱', '🐶', '🐰'];

// ── DB helpers ──────────────────────────────────────────────────────

async function getUserProfiles(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  return data || [];
}

async function getProfile(profileId) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .single();
  return data;
}

async function createProfile(userId, name, birthYear, icon) {
  const { data, error } = await supabase
    .from('profiles')
    .insert({
      user_id: userId,
      name,
      birth_year: birthYear || null,
      icon: icon || '👤',
      tags: [],
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateProfile(profileId, updates) {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', profileId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteProfile(profileId) {
  const { error } = await supabase
    .from('profiles')
    .delete()
    .eq('id', profileId);
  if (error) throw error;
}

async function countProfileMedicines(profileId) {
  const { count } = await supabase
    .from('medicines')
    .select('*', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('is_archived', false);
  return count || 0;
}

async function countProfileSchedules(profileId) {
  const { count } = await supabase
    .from('schedules')
    .select('*', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('status', 'active');
  return count || 0;
}

async function transferMedicinesToGeneral(profileId) {
  await supabase
    .from('medicines')
    .update({ profile_id: null })
    .eq('profile_id', profileId);
  await supabase
    .from('schedules')
    .update({ profile_id: null })
    .eq('profile_id', profileId);
}

async function deleteMedicinesForProfile(profileId) {
  // Archive medicines instead of hard-delete
  await supabase
    .from('medicines')
    .update({ is_archived: true, profile_id: null })
    .eq('profile_id', profileId);
  await supabase
    .from('schedules')
    .update({ status: 'paused', profile_id: null })
    .eq('profile_id', profileId);
}

// ── Session helpers ─────────────────────────────────────────────────

async function setState(userId, state) {
  await supabase.from('sessions').upsert(
    { key: `state:${userId}`, value: state, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
}

async function clearState(userId) {
  await supabase.from('sessions').delete().eq('key', `state:${userId}`);
}

function calcAge(birthYear) {
  if (!birthYear) return null;
  return new Date().getFullYear() - birthYear;
}

// ── Profile list ────────────────────────────────────────────────────

async function showProfileList(ctx) {
  const profiles = await getUserProfiles(ctx.dbUser.id);
  const settings = ctx.dbUser.settings || {};
  const defaultProfileId = settings.defaultProfileId || null;

  let text = ctx.t('profile.title');

  if (profiles.length === 0) {
    text += ctx.t('profile.empty');
  } else {
    for (const p of profiles) {
      let line = ctx.t('profile.list_item', { icon: p.icon, name: p.name });
      const age = calcAge(p.birth_year);
      if (age !== null) {
        line += ctx.t('profile.list_item_age', { age });
      }
      if (p.id === defaultProfileId) line += ' ⭐';
      text += line + '\n';
    }
  }

  const keyboard = new InlineKeyboard();
  for (const p of profiles) {
    keyboard.text(`${p.icon} ${p.name}`, `profile:${p.id}`).row();
  }
  keyboard.text(ctx.t('profile.btn_add'), 'profile:create').row();
  keyboard.text(ctx.t('common.back'), 'settings');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

// ── Profile card ────────────────────────────────────────────────────

async function showProfileCard(ctx, profileId) {
  const profile = await getProfile(profileId);
  if (!profile) {
    await ctx.answerCallbackQuery(ctx.t('common.not_found'));
    return;
  }

  const settings = ctx.dbUser.settings || {};
  const isDefault = settings.defaultProfileId === profileId;

  let text = ctx.t('profile.card_title', { icon: profile.icon, name: profile.name });
  if (isDefault) text += ctx.t('profile.is_default');

  if (profile.birth_year) {
    const age = calcAge(profile.birth_year);
    text += ctx.t('profile.card_age', { age });
    text += ctx.t('profile.card_birth_year', { year: profile.birth_year });
  }

  // Tags (#62)
  if (profile.tags && profile.tags.length > 0) {
    text += ctx.t('profile.card_tags', { tags: profile.tags.join(', ') });
  }

  // Medicine and schedule counts (parallel)
  const [medCount, schedCount] = await Promise.all([
    countProfileMedicines(profileId),
    countProfileSchedules(profileId),
  ]);
  text += ctx.t('profile.card_medicines_count', { count: medCount });
  if (schedCount > 0) {
    text += ctx.t('profile.card_schedules_count', { count: schedCount });
  }

  const keyboard = new InlineKeyboard()
    .text(ctx.t('profile.btn_edit_name'), `profile:${profileId}:edit:name`)
    .text(ctx.t('profile.btn_edit_year'), `profile:${profileId}:edit:year`)
    .row()
    .text(ctx.t('profile.btn_edit_icon'), `profile:${profileId}:edit:icon`)
    .text(ctx.t('profile.btn_edit_tags'), `profile:${profileId}:edit:tags`)
    .row();

  // Default toggle (#56)
  if (isDefault) {
    keyboard.text(ctx.t('profile.btn_clear_default'), `profile:${profileId}:undefault`);
  } else {
    keyboard.text(ctx.t('profile.btn_set_default'), `profile:${profileId}:default`);
  }
  keyboard.row();

  // Wellbeing journal (#59)
  keyboard.text(ctx.t('profile.btn_wellbeing'), `wellbeing:${profileId}:calendar`);
  keyboard.row();

  keyboard.text(ctx.t('profile.btn_delete'), `profile:${profileId}:delete`);
  keyboard.row();
  keyboard.text(ctx.t('profile.btn_to_profiles'), 'profiles');

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// ── Icon picker keyboard ────────────────────────────────────────────

function iconPickerKeyboard(callbackPrefix) {
  const keyboard = new InlineKeyboard();
  // 5x2 layout
  for (let i = 0; i < PROFILE_ICONS.length; i += 5) {
    for (let j = i; j < i + 5 && j < PROFILE_ICONS.length; j++) {
      keyboard.text(PROFILE_ICONS[j], `${callbackPrefix}:${PROFILE_ICONS[j]}`);
    }
    keyboard.row();
  }
  return keyboard;
}

// ── Wellbeing calendar ──────────────────────────────────────────────

async function showWellbeingCalendar(ctx, profileId, year, month) {
  const profile = profileId ? await getProfile(profileId) : null;

  const now = new Date();
  if (!year) year = now.getFullYear();
  if (!month) month = now.getMonth() + 1; // 1-based

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  let query = supabase
    .from('wellbeing_logs')
    .select('date, mood')
    .eq('user_id', ctx.dbUser.id)
    .gte('date', startDate)
    .lt('date', endDate)
    .order('date', { ascending: true });

  if (profileId) {
    query = query.eq('profile_id', profileId);
  } else {
    query = query.is('profile_id', null);
  }

  const { data: logs } = await query;
  const moodMap = {};
  for (const log of (logs || [])) {
    moodMap[log.date] = log.mood;
  }

  const monthNames = ru.format.months;
  const monthName = monthNames[month - 1];

  let text = ctx.t('wellbeing.calendar_title', { month: monthName, year });

  // Build calendar rows
  const daysInMonth = new Date(year, month, 0).getDate();
  let calendarText = '';
  let goodCount = 0, okCount = 0, badCount = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const mood = moodMap[dateStr];
    let emoji;
    if (mood === 'good') { emoji = '😊'; goodCount++; }
    else if (mood === 'ok') { emoji = '😐'; okCount++; }
    else if (mood === 'bad') { emoji = '😔'; badCount++; }
    else { emoji = '·'; }
    calendarText += `${String(d).padStart(2, '0')}${emoji} `;
    if (d % 7 === 0) calendarText += '\n';
  }

  text += calendarText.trim() + '\n';

  if (goodCount + okCount + badCount > 0) {
    text += ctx.t('wellbeing.summary', {
      good_count: goodCount,
      ok_count: okCount,
      bad_count: badCount,
    });
  } else {
    text += '\n' + ctx.t('wellbeing.no_data');
  }

  // Navigation buttons
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const prevName = monthNames[prevMonth - 1];
  const nextName = monthNames[nextMonth - 1];

  const pid = profileId || 'none';
  const keyboard = new InlineKeyboard()
    .text(ctx.t('wellbeing.btn_prev_month', { month: prevName }), `wellbeing:${pid}:cal:${prevYear}:${prevMonth}`)
    .text(ctx.t('wellbeing.btn_next_month', { month: nextName }), `wellbeing:${pid}:cal:${nextYear}:${nextMonth}`)
    .row();

  // Log mood for today
  const todayStr = now.toISOString().split('T')[0];
  const todayMonth = now.getMonth() + 1;
  if (year === now.getFullYear() && month === todayMonth) {
    keyboard
      .text('😊', `wellbeing:${pid}:mood:good`)
      .text('😐', `wellbeing:${pid}:mood:ok`)
      .text('😔', `wellbeing:${pid}:mood:bad`)
      .row();
  }

  if (profileId) {
    keyboard.text(ctx.t('common.back'), `profile:${profileId}`);
  } else {
    keyboard.text(ctx.t('common.back'), 'settings');
  }

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// ── Medicine notes ──────────────────────────────────────────────────

async function showMedicineNotes(ctx, medicineId) {
  const { data: med } = await supabase
    .from('medicines')
    .select('name')
    .eq('id', medicineId)
    .single();

  if (!med) {
    await ctx.answerCallbackQuery(ctx.t('common.not_found'));
    return;
  }

  const { data: notes } = await supabase
    .from('medicine_notes')
    .select('*')
    .eq('medicine_id', medicineId)
    .order('created_at', { ascending: false })
    .limit(20);

  let text = ctx.t('profile.notes_title', { name: med.name });
  if (!notes || notes.length === 0) {
    text += ctx.t('profile.notes_empty');
  } else {
    for (const note of notes) {
      const d = new Date(note.created_at);
      const dateStr = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
      text += ctx.t('profile.note_item', { date: dateStr, text: note.text });
    }
  }

  const keyboard = new InlineKeyboard()
    .text(ctx.t('profile.btn_add_note'), `mednote:${medicineId}:add`)
    .row()
    .text(ctx.t('medicine.btn_to_medicine'), `med:${medicineId}`);

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// ── Profile filter for medkit list ──────────────────────────────────

async function showProfileFilter(ctx, medkitId) {
  const profiles = await getUserProfiles(ctx.dbUser.id);

  let text = ctx.t('profile.filter_title');
  const keyboard = new InlineKeyboard();

  keyboard.text(ctx.t('profile.filter_all'), `medkit:${medkitId}:filter:profile:all`).row();
  keyboard.text(ctx.t('profile.filter_general'), `medkit:${medkitId}:filter:profile:general`).row();

  for (const p of profiles) {
    keyboard.text(`${p.icon} ${p.name}`, `medkit:${medkitId}:filter:profile:${p.id}`).row();
  }

  keyboard.text(ctx.t('common.back'), `medkit:${medkitId}`);

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// ── "For whom?" step in addMedicine ─────────────────────────────────

/**
 * Show profile picker for the addMedicine wizard (#47)
 * Called from addMedicine after notes step (before confirm)
 */
export async function showForWhomPicker(ctx, state) {
  const profiles = await getUserProfiles(ctx.dbUser.id);

  if (profiles.length === 0) {
    // No profiles — skip this step, medicine goes to general
    return false;
  }

  const keyboard = new InlineKeyboard();
  keyboard.text(ctx.t('profile.general'), 'addmed:profile:none').row();

  for (const p of profiles) {
    keyboard.text(`${p.icon} ${p.name}`, `addmed:profile:${p.id}`).row();
  }

  const text = ctx.t('profile.for_whom');
  const opts = { parse_mode: 'Markdown', reply_markup: keyboard };
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, opts);
  } else if (state.msgId) {
    await ctx.api.editMessageText(ctx.chat.id, state.msgId, text, opts);
  }
  return true;
}

// ── Stats by profile (#50) ──────────────────────────────────────────

export async function showStatsProfilePicker(ctx) {
  const profiles = await getUserProfiles(ctx.dbUser.id);

  if (profiles.length === 0) {
    // No profiles, proceed to regular stats
    return false;
  }

  let text = ctx.t('profile.stats_title');
  const keyboard = new InlineKeyboard();
  keyboard.text(ctx.t('profile.stats_all'), 'stats:all_profiles').row();

  for (const p of profiles) {
    keyboard.text(`${p.icon} ${p.name}`, `stats:profile:${p.id}`).row();
  }

  keyboard.text(ctx.t('profile.filter_general'), 'stats:profile:general').row();
  keyboard.text(ctx.t('common.back'), 'stats');

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  return true;
}

// ── Dashboard profiles (#51) ────────────────────────────────────────

export async function getProfileDashboardLines(userId, t) {
  const today = new Date().toISOString().split('T')[0];

  // Fetch all needed data in parallel (3 queries instead of N*3)
  const [{ data: profiles }, { data: allProfileMeds }, { data: todayLogs }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, name, icon')
      .eq('user_id', userId),
    supabase
      .from('medicines')
      .select('id, profile_id')
      .eq('is_archived', false)
      .not('profile_id', 'is', null),
    supabase
      .from('intake_logs')
      .select('status, medicine_id')
      .eq('user_id', userId)
      .gte('planned_at', today + 'T00:00:00')
      .lt('planned_at', today + 'T23:59:59'),
  ]);

  if (!profiles || profiles.length === 0) return '';

  // Index medicines by profile_id
  const medsByProfile = {};
  for (const m of (allProfileMeds || [])) {
    if (!medsByProfile[m.profile_id]) medsByProfile[m.profile_id] = new Set();
    medsByProfile[m.profile_id].add(m.id);
  }

  let lines = '';
  for (const p of profiles) {
    const medIdSet = medsByProfile[p.id];
    if (!medIdSet || medIdSet.size === 0) continue;

    const relevant = (todayLogs || []).filter(l => medIdSet.has(l.medicine_id));
    if (relevant.length === 0) continue;

    const taken = relevant.filter(l => l.status === 'taken').length;
    const skipped = relevant.filter(l => l.status === 'skipped').length;

    let line = t('profile.dashboard_line', {
      icon: p.icon,
      name: p.name,
      intakes_today: relevant.length,
      taken,
    });
    if (skipped > 0) {
      line += t('profile.dashboard_line_skip', { skipped });
    }
    lines += line + '\n';
  }

  return lines;
}

// ── Export by profile (#63) ─────────────────────────────────────────

export async function showExportProfilePicker(ctx) {
  const profiles = await getUserProfiles(ctx.dbUser.id);

  if (profiles.length === 0) {
    return false;
  }

  let text = ctx.t('profile.export_profile_title');
  const keyboard = new InlineKeyboard();
  keyboard.text(ctx.t('profile.export_all_profiles'), 'export:profile:all').row();

  for (const p of profiles) {
    keyboard.text(`${p.icon} ${p.name}`, `export:profile:${p.id}`).row();
  }

  keyboard.text(ctx.t('profile.filter_general'), 'export:profile:general').row();
  keyboard.text(ctx.t('common.back'), 'export');

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  return true;
}

// ── Text state handler ──────────────────────────────────────────────

export async function handleProfileTextState(state, text, ctx) {
  const msgId = state.msgId;

  // Profile creation — name step
  if (state.action === 'create_profile' && state.step === 'name') {
    state.profileName = text;
    state.step = 'birth_year';
    await setState(ctx.dbUser.id, state);

    const keyboard = new InlineKeyboard()
      .text(ctx.t('common.skip'), 'profile:create:skip_year')
      .row()
      .text(ctx.t('common.cancel'), 'profiles');

    await ctx.api.editMessageText(ctx.chat.id, msgId,
      ctx.t('profile.create_birth_year'),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    return 'handled';
  }

  // Profile creation — birth year step
  if (state.action === 'create_profile' && state.step === 'birth_year') {
    const year = parseInt(text);
    const currentYear = new Date().getFullYear();
    if (isNaN(year) || year < 1900 || year > currentYear) {
      const keyboard = new InlineKeyboard()
        .text(ctx.t('common.skip'), 'profile:create:skip_year')
        .row()
        .text(ctx.t('common.cancel'), 'profiles');

      await ctx.api.editMessageText(ctx.chat.id, msgId,
        ctx.t('profile.create_invalid_year'),
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );
      return 'keep_state';
    }

    state.profileBirthYear = year;
    state.step = 'icon';
    await setState(ctx.dbUser.id, state);

    const keyboard = iconPickerKeyboard('profile:create:icon');
    keyboard.row();
    keyboard.text(ctx.t('common.cancel'), 'profiles');

    await ctx.api.editMessageText(ctx.chat.id, msgId,
      ctx.t('profile.create_icon'),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    return 'handled';
  }

  // Edit profile name
  if (state.action === 'edit_profile_name') {
    const profile = await getProfile(state.profileId);
    if (!profile) return 'handled';

    await updateProfile(state.profileId, { name: text });
    await clearState(ctx.dbUser.id);

    const keyboard = new InlineKeyboard()
      .text(ctx.t('profile.btn_to_profiles'), 'profiles')
      .text(ctx.t('common.back'), `profile:${state.profileId}`);

    await ctx.api.editMessageText(ctx.chat.id, msgId,
      ctx.t('profile.name_updated'),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    return 'handled';
  }

  // Edit profile birth year
  if (state.action === 'edit_profile_year') {
    const year = parseInt(text);
    const currentYear = new Date().getFullYear();
    if (isNaN(year) || year < 1900 || year > currentYear) {
      const keyboard = new InlineKeyboard()
        .text(ctx.t('common.cancel'), `profile:${state.profileId}`);
      await ctx.api.editMessageText(ctx.chat.id, msgId,
        ctx.t('profile.create_invalid_year'),
        { parse_mode: 'Markdown', reply_markup: keyboard }
      );
      return 'keep_state';
    }

    await updateProfile(state.profileId, { birth_year: year });
    await clearState(ctx.dbUser.id);

    const keyboard = new InlineKeyboard()
      .text(ctx.t('common.back'), `profile:${state.profileId}`);
    await ctx.api.editMessageText(ctx.chat.id, msgId,
      ctx.t('profile.year_updated'),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    return 'handled';
  }

  // Edit profile tags (#62)
  if (state.action === 'edit_profile_tags') {
    const tags = text.split(',').map(t => t.trim()).filter(t => t.length > 0);
    await updateProfile(state.profileId, { tags });
    await clearState(ctx.dbUser.id);

    const keyboard = new InlineKeyboard()
      .text(ctx.t('common.back'), `profile:${state.profileId}`);
    await ctx.api.editMessageText(ctx.chat.id, msgId,
      ctx.t('profile.tags_updated'),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    return 'handled';
  }

  // Medicine note (#61)
  if (state.action === 'add_medicine_note') {
    await supabase.from('medicine_notes').insert({
      medicine_id: state.medicineId,
      user_id: ctx.dbUser.id,
      text,
    });
    await clearState(ctx.dbUser.id);

    const keyboard = new InlineKeyboard()
      .text(ctx.t('profile.btn_to_notes'), `mednotes:${state.medicineId}`)
      .text(ctx.t('medicine.btn_to_medicine'), `med:${state.medicineId}`);
    await ctx.api.editMessageText(ctx.chat.id, msgId,
      ctx.t('profile.note_added'),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    return 'handled';
  }

  // Wellbeing note
  if (state.action === 'wellbeing_note') {
    await supabase
      .from('wellbeing_logs')
      .update({ note: text })
      .eq('id', state.wellbeingLogId);
    await clearState(ctx.dbUser.id);

    const keyboard = new InlineKeyboard()
      .text(ctx.t('common.back'), `wellbeing:${state.profileId || 'none'}:calendar`);
    await ctx.api.editMessageText(ctx.chat.id, msgId,
      ctx.t('wellbeing.saved'),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
    return 'handled';
  }

  // Skip reason "other" text (#58)
  if (state.action === 'skip_reason_other') {
    await supabase
      .from('intake_logs')
      .update({ skip_reason: text })
      .eq('id', state.logId);
    await clearState(ctx.dbUser.id);

    const keyboard = new InlineKeyboard()
      .text(ctx.t('intake.btn_to_intakes'), 'intake_today')
      .text(ctx.t('common.main_menu'), 'main_menu');
    await ctx.api.editMessageText(ctx.chat.id, msgId,
      ctx.t('profile.skip_reason_saved_toast'),
      { reply_markup: keyboard }
    );
    return 'handled';
  }

  return null;
}

// ── Register all handlers ───────────────────────────────────────────

export function registerProfileHandlers(bot) {

  // ── Profile list ──────────────────────────────────────────────────
  bot.callbackQuery('profiles', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showProfileList(ctx);
  });

  // ── Profile card ──────────────────────────────────────────────────
  bot.callbackQuery(/^profile:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showProfileCard(ctx, ctx.match[1]);
  });

  // ── Create profile wizard ─────────────────────────────────────────

  bot.callbackQuery('profile:create', async (ctx) => {
    await ctx.answerCallbackQuery();
    const msg = await ctx.editMessageText(
      ctx.t('profile.create_name'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), 'profiles'),
      }
    );
    await setState(ctx.dbUser.id, {
      action: 'create_profile',
      step: 'name',
      msgId: msg.message_id,
    });
  });

  // Skip birth year — go to icon picker
  bot.callbackQuery('profile:create:skip_year', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { data: session } = await supabase
      .from('sessions')
      .select('value')
      .eq('key', `state:${ctx.dbUser.id}`)
      .single();
    const state = session?.value;
    if (!state || state.action !== 'create_profile') return;

    state.profileBirthYear = null;
    state.step = 'icon';
    await setState(ctx.dbUser.id, state);

    const keyboard = iconPickerKeyboard('profile:create:icon');
    keyboard.row();
    keyboard.text(ctx.t('common.cancel'), 'profiles');

    await ctx.editMessageText(
      ctx.t('profile.create_icon'),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  });

  // Icon selected — create profile
  bot.callbackQuery(/^profile:create:icon:(.+)$/, async (ctx) => {
    const icon = ctx.match[1];
    await ctx.answerCallbackQuery(ctx.t('profile.created_toast'));

    const { data: session } = await supabase
      .from('sessions')
      .select('value')
      .eq('key', `state:${ctx.dbUser.id}`)
      .single();
    const state = session?.value;
    if (!state || state.action !== 'create_profile') return;

    const profile = await createProfile(
      ctx.dbUser.id,
      state.profileName,
      state.profileBirthYear,
      icon
    );
    await clearState(ctx.dbUser.id);

    await ctx.editMessageText(
      ctx.t('profile.created', { name: profile.name }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(`${profile.icon} ${profile.name}`, `profile:${profile.id}`)
          .row()
          .text(ctx.t('profile.btn_to_profiles'), 'profiles'),
      }
    );
  });

  // ── Edit profile ──────────────────────────────────────────────────

  // Edit name
  bot.callbackQuery(/^profile:([0-9a-f-]+):edit:name$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const profileId = ctx.match[1];
    const msg = await ctx.editMessageText(
      ctx.t('profile.edit_name_prompt'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), `profile:${profileId}`),
      }
    );
    await setState(ctx.dbUser.id, {
      action: 'edit_profile_name',
      profileId,
      msgId: msg.message_id,
    });
  });

  // Edit birth year
  bot.callbackQuery(/^profile:([0-9a-f-]+):edit:year$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const profileId = ctx.match[1];
    const msg = await ctx.editMessageText(
      ctx.t('profile.edit_year_prompt'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), `profile:${profileId}`),
      }
    );
    await setState(ctx.dbUser.id, {
      action: 'edit_profile_year',
      profileId,
      msgId: msg.message_id,
    });
  });

  // Edit icon — show picker
  bot.callbackQuery(/^profile:([0-9a-f-]+):edit:icon$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const profileId = ctx.match[1];
    const keyboard = iconPickerKeyboard(`profile:${profileId}:seticon`);
    keyboard.row();
    keyboard.text(ctx.t('common.cancel'), `profile:${profileId}`);

    await ctx.editMessageText(
      ctx.t('profile.create_icon'),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  });

  // Set icon
  bot.callbackQuery(/^profile:([0-9a-f-]+):seticon:(.+)$/, async (ctx) => {
    const profileId = ctx.match[1];
    const icon = ctx.match[2];
    await updateProfile(profileId, { icon });
    await ctx.answerCallbackQuery(ctx.t('profile.icon_updated_toast'));
    await showProfileCard(ctx, profileId);
  });

  // Edit tags (#62)
  bot.callbackQuery(/^profile:([0-9a-f-]+):edit:tags$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const profileId = ctx.match[1];
    const msg = await ctx.editMessageText(
      ctx.t('profile.edit_tags_prompt'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), `profile:${profileId}`),
      }
    );
    await setState(ctx.dbUser.id, {
      action: 'edit_profile_tags',
      profileId,
      msgId: msg.message_id,
    });
  });

  // ── Set / clear default profile (#56) ─────────────────────────────

  bot.callbackQuery(/^profile:([0-9a-f-]+):default$/, async (ctx) => {
    const profileId = ctx.match[1];
    const s = { ...(ctx.dbUser.settings || {}) };
    s.defaultProfileId = profileId;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(ctx.t('profile.default_set_toast'));
    await showProfileCard(ctx, profileId);
  });

  bot.callbackQuery(/^profile:([0-9a-f-]+):undefault$/, async (ctx) => {
    const profileId = ctx.match[1];
    const s = { ...(ctx.dbUser.settings || {}) };
    delete s.defaultProfileId;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(ctx.t('profile.default_cleared_toast'));
    await showProfileCard(ctx, profileId);
  });

  // ── Delete profile (#55) ──────────────────────────────────────────

  bot.callbackQuery(/^profile:([0-9a-f-]+):delete$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const profileId = ctx.match[1];
    const [profile, medCount] = await Promise.all([
      getProfile(profileId),
      countProfileMedicines(profileId),
    ]);
    if (!profile) return;

    let text;
    const keyboard = new InlineKeyboard();
    if (medCount > 0) {
      text = ctx.t('profile.delete_confirm', { name: profile.name, count: medCount });
      keyboard
        .text(ctx.t('profile.btn_transfer'), `profile:${profileId}:del:transfer`)
        .row()
        .text(ctx.t('profile.btn_delete_all'), `profile:${profileId}:del:all`)
        .row();
    } else {
      text = ctx.t('profile.delete_confirm_empty', { name: profile.name });
      keyboard.text(ctx.t('common.yes_delete'), `profile:${profileId}:del:confirm`).row();
    }
    keyboard.text(ctx.t('common.cancel'), `profile:${profileId}`);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  // Transfer medicines and delete
  bot.callbackQuery(/^profile:([0-9a-f-]+):del:transfer$/, async (ctx) => {
    const profileId = ctx.match[1];
    await transferMedicinesToGeneral(profileId);
    // Clear default if this was it
    const s = { ...(ctx.dbUser.settings || {}) };
    if (s.defaultProfileId === profileId) {
      delete s.defaultProfileId;
      await updateUserSettings(ctx.dbUser.id, s);
      ctx.dbUser.settings = s;
    }
    await deleteProfile(profileId);
    await ctx.answerCallbackQuery(ctx.t('profile.deleted_toast'));
    await showProfileList(ctx);
  });

  // Delete all medicines and profile
  bot.callbackQuery(/^profile:([0-9a-f-]+):del:all$/, async (ctx) => {
    const profileId = ctx.match[1];
    await deleteMedicinesForProfile(profileId);
    const s = { ...(ctx.dbUser.settings || {}) };
    if (s.defaultProfileId === profileId) {
      delete s.defaultProfileId;
      await updateUserSettings(ctx.dbUser.id, s);
      ctx.dbUser.settings = s;
    }
    await deleteProfile(profileId);
    await ctx.answerCallbackQuery(ctx.t('profile.deleted_toast'));
    await showProfileList(ctx);
  });

  // Delete profile with no medicines
  bot.callbackQuery(/^profile:([0-9a-f-]+):del:confirm$/, async (ctx) => {
    const profileId = ctx.match[1];
    const s = { ...(ctx.dbUser.settings || {}) };
    if (s.defaultProfileId === profileId) {
      delete s.defaultProfileId;
      await updateUserSettings(ctx.dbUser.id, s);
      ctx.dbUser.settings = s;
    }
    await deleteProfile(profileId);
    await ctx.answerCallbackQuery(ctx.t('profile.deleted_toast'));
    await showProfileList(ctx);
  });

  // ── Profile filter in medkit (#49) ────────────────────────────────

  bot.callbackQuery(/^medkit:([0-9a-f-]+):filter:profile$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showProfileFilter(ctx, ctx.match[1]);
  });

  // ── Wellbeing journal (#59-60) ────────────────────────────────────

  bot.callbackQuery(/^wellbeing:([0-9a-f-]+|none):calendar$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const profileId = ctx.match[1] === 'none' ? null : ctx.match[1];
    await showWellbeingCalendar(ctx, profileId);
  });

  bot.callbackQuery(/^wellbeing:([0-9a-f-]+|none):cal:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const profileId = ctx.match[1] === 'none' ? null : ctx.match[1];
    const year = parseInt(ctx.match[2]);
    const month = parseInt(ctx.match[3]);
    await showWellbeingCalendar(ctx, profileId, year, month);
  });

  // Log mood
  bot.callbackQuery(/^wellbeing:([0-9a-f-]+|none):mood:(good|ok|bad)$/, async (ctx) => {
    const profileId = ctx.match[1] === 'none' ? null : ctx.match[1];
    const mood = ctx.match[2];
    const today = new Date().toISOString().split('T')[0];

    // Upsert wellbeing log
    const insertData = {
      user_id: ctx.dbUser.id,
      profile_id: profileId,
      date: today,
      mood,
    };

    // Try to find existing log for today
    let query = supabase
      .from('wellbeing_logs')
      .select('id')
      .eq('user_id', ctx.dbUser.id)
      .eq('date', today);

    if (profileId) {
      query = query.eq('profile_id', profileId);
    } else {
      query = query.is('profile_id', null);
    }

    const { data: existing } = await query.single();

    let logId;
    if (existing) {
      const { data: updated } = await supabase
        .from('wellbeing_logs')
        .update({ mood })
        .eq('id', existing.id)
        .select()
        .single();
      logId = updated.id;
    } else {
      const { data: created } = await supabase
        .from('wellbeing_logs')
        .insert(insertData)
        .select()
        .single();
      logId = created.id;
    }

    await ctx.answerCallbackQuery(ctx.t('wellbeing.saved_toast'));

    // Offer to add a note
    const keyboard = new InlineKeyboard()
      .text('📝', `wellbeing:${profileId || 'none'}:note:${logId}`)
      .text(ctx.t('common.done'), `wellbeing:${profileId || 'none'}:calendar`)
      .row()
      .text(ctx.t('common.back'), `wellbeing:${profileId || 'none'}:calendar`);

    await ctx.editMessageText(
      ctx.t('wellbeing.saved') + '\n\n' + ctx.t('wellbeing.note_prompt'),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  });

  // Wellbeing note input
  bot.callbackQuery(/^wellbeing:([0-9a-f-]+|none):note:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const profileId = ctx.match[1] === 'none' ? null : ctx.match[1];
    const logId = ctx.match[2];

    const msg = await ctx.editMessageText(
      ctx.t('wellbeing.note_prompt'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.skip'), `wellbeing:${profileId || 'none'}:calendar`),
      }
    );

    await setState(ctx.dbUser.id, {
      action: 'wellbeing_note',
      wellbeingLogId: logId,
      profileId: profileId || 'none',
      msgId: msg.message_id,
    });
  });

  // ── Medicine notes (#61) ──────────────────────────────────────────

  bot.callbackQuery(/^mednotes:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMedicineNotes(ctx, ctx.match[1]);
  });

  bot.callbackQuery(/^mednote:([0-9a-f-]+):add$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medicineId = ctx.match[1];

    const msg = await ctx.editMessageText(
      ctx.t('profile.note_prompt'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.cancel'), `mednotes:${medicineId}`),
      }
    );

    await setState(ctx.dbUser.id, {
      action: 'add_medicine_note',
      medicineId,
      msgId: msg.message_id,
    });
  });

  // ── Skip reason (#58) ────────────────────────────────────────────

  bot.callbackQuery(/^intake:([0-9a-f-]+):skip_reason$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const logId = ctx.match[1];

    const keyboard = new InlineKeyboard()
      .text(ctx.t('profile.skip_reason_forgot'), `intake:${logId}:reason:forgot`)
      .row()
      .text(ctx.t('profile.skip_reason_sick'), `intake:${logId}:reason:sick`)
      .row()
      .text(ctx.t('profile.skip_reason_empty'), `intake:${logId}:reason:empty`)
      .row()
      .text(ctx.t('profile.skip_reason_doctor'), `intake:${logId}:reason:doctor`)
      .row()
      .text(ctx.t('profile.skip_reason_other'), `intake:${logId}:reason:other`)
      .row()
      .text(ctx.t('common.cancel'), 'intake_today');

    await ctx.editMessageText(
      ctx.t('profile.skip_reason_title'),
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  });

  // Save skip reason (preset)
  bot.callbackQuery(/^intake:([0-9a-f-]+):reason:(forgot|sick|empty|doctor)$/, async (ctx) => {
    const logId = ctx.match[1];
    const reason = ctx.match[2];

    const reasonMap = {
      forgot: 'Забыл',
      sick: 'Плохое самочувствие',
      empty: 'Закончилось',
      doctor: 'Решение врача',
    };

    await supabase
      .from('intake_logs')
      .update({ skip_reason: reasonMap[reason] })
      .eq('id', logId);

    await ctx.answerCallbackQuery(ctx.t('profile.skip_reason_saved_toast'));

    // Re-render today view
    const { getTodayIntakeLogs } = await import('../db/queries/intakeLogs.js');
    const timezone = ctx.dbUser.timezone || 'Europe/Moscow';
    // Navigate back to intake view
    const keyboard = new InlineKeyboard()
      .text(ctx.t('intake.btn_to_intakes'), 'intake_today')
      .text(ctx.t('common.main_menu'), 'main_menu');
    await ctx.editMessageText(
      ctx.t('profile.skip_reason_saved_toast'),
      { reply_markup: keyboard }
    );
  });

  // Skip reason "other" — text input
  bot.callbackQuery(/^intake:([0-9a-f-]+):reason:other$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const logId = ctx.match[1];

    const msg = await ctx.editMessageText(
      ctx.t('profile.skip_reason_other_prompt'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.cancel'), 'intake_today'),
      }
    );

    await setState(ctx.dbUser.id, {
      action: 'skip_reason_other',
      logId,
      msgId: msg.message_id,
    });
  });

  // ── Export by profile (#63) ───────────────────────────────────────

  bot.callbackQuery('export:by_profile', async (ctx) => {
    await ctx.answerCallbackQuery();
    const shown = await showExportProfilePicker(ctx);
    if (!shown) {
      // No profiles, fall back to regular export
      await ctx.editMessageText(ctx.t('common.feature_wip'));
    }
  });

  // ── Stats by profile (#50) ───────────────────────────────────────

  bot.callbackQuery('stats:by_profile', async (ctx) => {
    await ctx.answerCallbackQuery();
    const shown = await showStatsProfilePicker(ctx);
    if (!shown) {
      await ctx.editMessageText(ctx.t('common.feature_wip'));
    }
  });
}
