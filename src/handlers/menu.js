import { mainMenuKeyboard } from '../keyboards/mainMenu.js';
import { getUserMedkits } from '../db/queries/medkits.js';
import { countShoppingItems } from '../db/queries/shoppingList.js';
import { getTodayIntakeLogs } from '../db/queries/intakeLogs.js';
import { supabase } from '../db/supabase.js';
import { getProfileDashboardLines } from './profiles.js';

/**
 * Build profile completion data (#84)
 */
async function getProfileCompletion(userId, settings, medkits) {
  const criteria = [];
  let done = 0;
  const total = 6;

  const hasMedkit = medkits.length > 0;
  criteria.push({ key: hasMedkit ? 'progress_medkit' : 'progress_no_medkit', done: hasMedkit });
  if (hasMedkit) done++;

  if (hasMedkit) {
    const medkitIds = medkits.map(m => m.id);

    // Run all checks in parallel
    const [{ count: medCount }, { count: schedCount }, { data: medsWithPhotos }, { count: profileCount }] = await Promise.all([
      supabase
        .from('medicines')
        .select('*', { count: 'exact', head: true })
        .in('medkit_id', medkitIds)
        .eq('is_archived', false),
      supabase
        .from('schedules')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'active'),
      supabase
        .from('medicines')
        .select('photo_file_ids')
        .in('medkit_id', medkitIds)
        .eq('is_archived', false)
        .not('photo_file_ids', 'eq', '{}')
        .limit(1),
      supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
    ]);

    const hasMed = medCount > 0;
    criteria.push({ key: hasMed ? 'progress_medicine' : 'progress_no_medicine', done: hasMed });
    if (hasMed) done++;

    const hasSched = schedCount > 0;
    criteria.push({ key: hasSched ? 'progress_schedule' : 'progress_no_schedule', done: hasSched });
    if (hasSched) done++;

    const hasPhoto = medsWithPhotos && medsWithPhotos.length > 0;
    criteria.push({ key: hasPhoto ? 'progress_photo' : 'progress_no_photo', done: hasPhoto });
    if (hasPhoto) done++;

    // 5. Timezone set
    const hasTz = settings?.timezone && settings.timezone !== 'Europe/Moscow';
    criteria.push({ key: hasTz ? 'progress_timezone' : 'progress_no_timezone', done: hasTz });
    if (hasTz) done++;

    // 6. Has profile
    const hasProfile = profileCount > 0;
    criteria.push({ key: hasProfile ? 'progress_profile' : 'progress_no_profile', done: hasProfile });
    if (hasProfile) done++;
  } else {
    criteria.push({ key: 'progress_no_medicine', done: false });
    criteria.push({ key: 'progress_no_schedule', done: false });
    criteria.push({ key: 'progress_no_photo', done: false });

    const hasTz = settings?.timezone && settings.timezone !== 'Europe/Moscow';
    criteria.push({ key: hasTz ? 'progress_timezone' : 'progress_no_timezone', done: hasTz });
    if (hasTz) done++;

    const { count: profileCount } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    const hasProfile = profileCount > 0;
    criteria.push({ key: hasProfile ? 'progress_profile' : 'progress_no_profile', done: hasProfile });
    if (hasProfile) done++;
  }

  const pct = Math.round((done / total) * 100);
  return { pct, criteria, done, total };
}

/**
 * Build dashboard text for main menu
 */
async function buildDashboard(userId, settings, t, dbUser) {
  // Fetch medkits, shopping count, and intake logs in parallel
  const [medkits, shopCount, intakeLogs] = await Promise.all([
    getUserMedkits(userId),
    countShoppingItems(userId),
    getTodayIntakeLogs(userId, settings?.timezone || 'Europe/Moscow'),
  ]);
  const medkitCount = medkits.length;
  const totalIntakes = intakeLogs.length;
  const doneIntakes = intakeLogs.filter(l => l.status === 'taken').length;

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

    // Run all medicine count queries in parallel
    const [{ count: expCount }, { count: expiredC }, { count: soonCount }, { count: lowCount }] = await Promise.all([
      supabase
        .from('medicines')
        .select('*', { count: 'exact', head: true })
        .in('medkit_id', medkitIds)
        .eq('is_archived', false)
        .not('expiry_date', 'is', null)
        .lte('expiry_date', thresholdDateStr),
      supabase
        .from('medicines')
        .select('*', { count: 'exact', head: true })
        .in('medkit_id', medkitIds)
        .eq('is_archived', false)
        .not('expiry_date', 'is', null)
        .lte('expiry_date', todayStr),
      supabase
        .from('medicines')
        .select('*', { count: 'exact', head: true })
        .in('medkit_id', medkitIds)
        .eq('is_archived', false)
        .not('expiry_date', 'is', null)
        .gt('expiry_date', todayStr)
        .lte('expiry_date', thresholdDateStr),
      supabase
        .from('medicines')
        .select('*', { count: 'exact', head: true })
        .in('medkit_id', medkitIds)
        .eq('is_archived', false)
        .lte('quantity', thresholds.low_stock_count)
        .gt('quantity', 0),
    ]);

    expiringCount = expCount || 0;
    expiredCount = expiredC || 0;
    expiringSoonCount = soonCount || 0;
    lowStockCount = lowCount || 0;
    hasAttention = expiredCount > 0 || expiringSoonCount > 0;
  }

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

  // Fetch profile dashboard lines and completion in parallel
  try {
    const [profileLines, completion] = await Promise.all([
      getProfileDashboardLines(userId, t).catch(() => ''),
      getProfileCompletion(userId, dbUser, medkits).catch(() => null),
    ]);

    if (profileLines) {
      text += '\n' + profileLines;
    }

    if (completion && completion.pct < 100) {
      text += '\n' + t('onboarding.progress_title', { pct: completion.pct }) + '\n';
      for (const c of completion.criteria) {
        text += t(`onboarding.${c.key}`) + '\n';
      }
    }
  } catch { /* ignore dashboard errors */ }

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
