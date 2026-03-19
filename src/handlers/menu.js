import { mainMenuKeyboard } from '../keyboards/mainMenu.js';
import { getUserMedkits } from '../db/queries/medkits.js';
import { countShoppingItems } from '../db/queries/shoppingList.js';
import { getTodayIntakeLogs } from '../db/queries/intakeLogs.js';
import { supabase } from '../db/supabase.js';
import { getProfileDashboardLines } from './profiles.js';

/**
 * Build profile completion data (#84)
 */
async function getProfileCompletion(userId, settings) {
  const criteria = [];
  let done = 0;
  const total = 6;

  // 1. Has medkit
  const { count: medkitCount } = await supabase
    .from('medkit_members')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  const hasMedkit = medkitCount > 0;
  criteria.push({ key: hasMedkit ? 'progress_medkit' : 'progress_no_medkit', done: hasMedkit });
  if (hasMedkit) done++;

  // 2. Has medicine
  if (hasMedkit) {
    const { data: memberships } = await supabase
      .from('medkit_members')
      .select('medkit_id')
      .eq('user_id', userId);
    const medkitIds = (memberships || []).map(m => m.medkit_id);
    const { count: medCount } = await supabase
      .from('medicines')
      .select('*', { count: 'exact', head: true })
      .in('medkit_id', medkitIds)
      .eq('is_archived', false);
    const hasMed = medCount > 0;
    criteria.push({ key: hasMed ? 'progress_medicine' : 'progress_no_medicine', done: hasMed });
    if (hasMed) done++;

    // 3. Has schedule
    const { count: schedCount } = await supabase
      .from('schedules')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'active');
    const hasSched = schedCount > 0;
    criteria.push({ key: hasSched ? 'progress_schedule' : 'progress_no_schedule', done: hasSched });
    if (hasSched) done++;

    // 4. Has photo
    const { data: medsWithPhotos } = await supabase
      .from('medicines')
      .select('photo_file_ids')
      .in('medkit_id', medkitIds)
      .eq('is_archived', false)
      .not('photo_file_ids', 'eq', '{}')
      .limit(1);
    const hasPhoto = medsWithPhotos && medsWithPhotos.length > 0;
    criteria.push({ key: hasPhoto ? 'progress_photo' : 'progress_no_photo', done: hasPhoto });
    if (hasPhoto) done++;
  } else {
    criteria.push({ key: 'progress_no_medicine', done: false });
    criteria.push({ key: 'progress_no_schedule', done: false });
    criteria.push({ key: 'progress_no_photo', done: false });
  }

  // 5. Timezone set (not default Moscow)
  const hasTz = settings?.timezone && settings.timezone !== 'Europe/Moscow';
  // Actually check from user row
  criteria.push({ key: hasTz ? 'progress_timezone' : 'progress_no_timezone', done: hasTz });
  if (hasTz) done++;

  // 6. Has profile
  const { count: profileCount } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  const hasProfile = profileCount > 0;
  criteria.push({ key: hasProfile ? 'progress_profile' : 'progress_no_profile', done: hasProfile });
  if (hasProfile) done++;

  const pct = Math.round((done / total) * 100);
  return { pct, criteria, done, total };
}

/**
 * Build dashboard text for main menu
 */
async function buildDashboard(userId, settings, t, dbUser) {
  const medkits = await getUserMedkits(userId);
  const medkitCount = medkits.length;
  const shopCount = await countShoppingItems(userId);

  // Count expiring, expired, and low-stock medicines
  const thresholds = settings?.thresholds || { expiry_days: 30, low_stock_count: 5 };
  let expiringCount = 0;
  let lowStockCount = 0;
  let expiredCount = 0;
  let expiringSoonCount = 0;
  let hasAttention = false;

  if (medkitCount > 0) {
    const medkitIds = medkits.map(m => m.id);
    const todayStr = new Date().toISOString().split('T')[0];
    const thresholdDate = new Date(Date.now() + thresholds.expiry_days * 86400000);
    const thresholdDateStr = thresholdDate.toISOString().split('T')[0];

    // Total expiring (includes expired + expiring soon) — used for summary line
    const { count: expCount } = await supabase
      .from('medicines')
      .select('*', { count: 'exact', head: true })
      .in('medkit_id', medkitIds)
      .eq('is_archived', false)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', thresholdDateStr);
    expiringCount = expCount || 0;

    // Expired (expiry_date <= today) — for attention banner
    const { count: expiredC } = await supabase
      .from('medicines')
      .select('*', { count: 'exact', head: true })
      .in('medkit_id', medkitIds)
      .eq('is_archived', false)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', todayStr);
    expiredCount = expiredC || 0;

    // Expiring soon (today < expiry_date <= threshold) — for attention banner
    const { count: soonCount } = await supabase
      .from('medicines')
      .select('*', { count: 'exact', head: true })
      .in('medkit_id', medkitIds)
      .eq('is_archived', false)
      .not('expiry_date', 'is', null)
      .gt('expiry_date', todayStr)
      .lte('expiry_date', thresholdDateStr);
    expiringSoonCount = soonCount || 0;

    const { count: lowCount } = await supabase
      .from('medicines')
      .select('*', { count: 'exact', head: true })
      .in('medkit_id', medkitIds)
      .eq('is_archived', false)
      .lte('quantity', thresholds.low_stock_count)
      .gt('quantity', 0);
    lowStockCount = lowCount || 0;

    hasAttention = expiredCount > 0 || expiringSoonCount > 0;
  }

  // Intake stats for today
  const intakeLogs = await getTodayIntakeLogs(userId, settings?.timezone || 'Europe/Moscow');
  const totalIntakes = intakeLogs.length;
  const doneIntakes = intakeLogs.filter(l => l.status === 'taken').length;

  let text = t('menu.title');

  // Empty state when user has no medkits
  if (medkitCount === 0) {
    text += t('menu.empty_medkits') + '\n';
  } else {
    text += t('menu.medkits_count', { count: medkitCount }) + '\n';
    if (totalIntakes > 0) {
      text += t('menu.intake_today', { taken: doneIntakes, total: totalIntakes }) + '\n';
    }
    if (expiringCount > 0) text += t('menu.expiring_soon', { count: expiringCount }) + '\n';
    if (lowStockCount > 0) text += t('menu.low_stock', { count: lowStockCount }) + '\n';
    if (shopCount > 0) text += t('menu.shopping_count', { count: shopCount }) + '\n';

    // Attention banner for expired / expiring-soon medicines (#92)
    if (hasAttention) {
      text += '\n' + t('menu.attention') + '\n';
      if (expiredCount > 0) text += t('menu.attention_expired', { count: expiredCount }) + '\n';
      if (expiringSoonCount > 0) text += t('menu.attention_expiring', { count: expiringSoonCount }) + '\n';
    }
  }

  // #51 Dashboard profile lines
  try {
    const profileLines = await getProfileDashboardLines(userId, t);
    if (profileLines) {
      text += '\n' + profileLines;
    }
  } catch { /* ignore profile dashboard errors */ }

  // Profile completion progress (#84)
  try {
    const { pct, criteria } = await getProfileCompletion(userId, dbUser);
    if (pct < 100) {
      text += '\n' + t('onboarding.progress_title', { pct }) + '\n';
      for (const c of criteria) {
        text += t(`onboarding.${c.key}`) + '\n';
      }
    }
  } catch { /* ignore profile completion errors */ }

  return { text, hasAttention };
}

/**
 * Send main menu (new message)
 */
export async function handleMainMenu(ctx) {
  const { text, hasAttention } = await buildDashboard(ctx.dbUser.id, ctx.dbUser.settings, ctx.t, ctx.dbUser);
  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: mainMenuKeyboard(ctx.t, hasAttention, ctx.dbUser.settings),
  });
}

/**
 * Show main menu via callback query (edit message)
 */
export async function handleMainMenuCallback(ctx) {
  await ctx.answerCallbackQuery();
  const { text, hasAttention } = await buildDashboard(ctx.dbUser.id, ctx.dbUser.settings, ctx.t, ctx.dbUser);
  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: mainMenuKeyboard(ctx.t, hasAttention, ctx.dbUser.settings),
  });
}
