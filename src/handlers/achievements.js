import { InlineKeyboard } from 'grammy';
import { ACHIEVEMENTS } from '../config.js';
import { supabase } from '../db/supabase.js';

/**
 * Get all unlocked achievements for a user (from action_logs)
 */
async function getUserAchievements(userId) {
  const { data } = await supabase
    .from('action_logs')
    .select('entity_id, created_at')
    .eq('user_id', userId)
    .eq('action', 'achievement_unlocked');
  return data || [];
}

/**
 * Check if achievement is already unlocked
 */
async function isAchievementUnlocked(userId, key) {
  const { count } = await supabase
    .from('action_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('action', 'achievement_unlocked')
    .eq('entity_id', key);
  return count > 0;
}

/**
 * Award an achievement and notify the user
 */
export async function awardAchievement(ctx, key) {
  const already = await isAchievementUnlocked(ctx.dbUser.id, key);
  if (already) return false;

  await supabase.from('action_logs').insert({
    user_id: ctx.dbUser.id,
    action: 'achievement_unlocked',
    entity_type: 'achievement',
    entity_id: key,
  });

  // Notify user
  const name = ctx.t(`achievements.${key}`);
  try {
    await ctx.api.sendMessage(ctx.chat.id, ctx.t('achievements.unlocked', { name }));
  } catch { /* ignore */ }

  return true;
}

/**
 * Award achievement silently (for cron/background, no ctx.chat)
 */
export async function awardAchievementSilent(userId, key, bot, telegramId, t) {
  const already = await isAchievementUnlocked(userId, key);
  if (already) return false;

  await supabase.from('action_logs').insert({
    user_id: userId,
    action: 'achievement_unlocked',
    entity_type: 'achievement',
    entity_id: key,
  });

  const name = t(`achievements.${key}`);
  try {
    await bot.api.sendMessage(telegramId, t('achievements.unlocked', { name }));
  } catch { /* ignore */ }

  return true;
}

/**
 * Check and award relevant achievements after an action
 */
export async function checkAchievements(ctx, action, extra = {}) {
  try {
    if (action === 'medicine_added') {
      // first_medicine
      await awardAchievement(ctx, 'first_medicine');

      // medicines_10
      const { data: memberships } = await supabase
        .from('medkit_members')
        .select('medkit_id')
        .eq('user_id', ctx.dbUser.id);
      if (memberships && memberships.length > 0) {
        const { count } = await supabase
          .from('medicines')
          .select('*', { count: 'exact', head: true })
          .in('medkit_id', memberships.map(m => m.medkit_id))
          .eq('is_archived', false);
        if (count >= 10) {
          await awardAchievement(ctx, 'medicines_10');
        }
      }
    }

    if (action === 'photo_added') {
      await awardAchievement(ctx, 'photo_added');
    }

    if (action === 'medkit_shared') {
      await awardAchievement(ctx, 'shared_medkit');
    }

    if (action === 'profile_created') {
      await awardAchievement(ctx, 'first_profile');
    }

    if (action === 'intake_taken') {
      // Check all_taken_day
      const timezone = ctx.dbUser.timezone || 'Europe/Moscow';
      const now = new Date();
      const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const todayStr = userNow.toLocaleDateString('en-CA');
      const startOfDay = `${todayStr}T00:00:00`;
      const endOfDay = `${todayStr}T23:59:59`;

      const { data: todayLogs } = await supabase
        .from('intake_logs')
        .select('status')
        .eq('user_id', ctx.dbUser.id)
        .gte('planned_at', startOfDay)
        .lte('planned_at', endOfDay);

      if (todayLogs && todayLogs.length > 0) {
        const allTaken = todayLogs.every(l => l.status === 'taken');
        if (allTaken) {
          await awardAchievement(ctx, 'all_taken_day');
        }
      }

      // Check streak achievements
      if (extra.streak) {
        if (extra.streak >= 7) await awardAchievement(ctx, 'streak_7');
        if (extra.streak >= 30) await awardAchievement(ctx, 'streak_30');
      }

      // Check full_week
      if (extra.streak >= 7) {
        await awardAchievement(ctx, 'full_week');
      }
    }
  } catch (e) {
    console.error('Error checking achievements:', e);
  }
}

/**
 * Show achievements screen
 */
async function showAchievements(ctx) {
  const unlocked = await getUserAchievements(ctx.dbUser.id);
  const unlockedKeys = new Set(unlocked.map(a => a.entity_id));

  let text = ctx.t('achievements.title');

  if (unlockedKeys.size === 0) {
    text = ctx.t('achievements.empty');
  } else {
    for (const key of Object.keys(ACHIEVEMENTS)) {
      const name = ctx.t(`achievements.${key}`);
      if (unlockedKeys.has(key)) {
        text += `${name}\n`;
      } else {
        text += ctx.t('achievements.locked', { name }) + '\n';
      }
    }
  }

  const keyboard = new InlineKeyboard()
    .text(ctx.t('common.back'), 'main_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

/**
 * Calculate streak from intake logs
 */
export async function calculateCurrentStreak(userId, timezone) {
  const { data: logs } = await supabase
    .from('intake_logs')
    .select('status, planned_at')
    .eq('user_id', userId)
    .order('planned_at', { ascending: false })
    .limit(500);

  if (!logs || logs.length === 0) return 0;

  const byDate = {};
  for (const log of logs) {
    const d = new Date(log.planned_at);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: timezone });
    if (!byDate[dateStr]) byDate[dateStr] = [];
    byDate[dateStr].push(log);
  }

  const dates = Object.keys(byDate).sort().reverse();
  let streak = 0;

  for (const dateStr of dates) {
    const dayLogs = byDate[dateStr];
    const allTaken = dayLogs.every(l => l.status === 'taken');
    const hasPending = dayLogs.some(l => l.status === 'pending');
    if (allTaken && !hasPending) {
      streak++;
    } else if (hasPending) {
      continue;
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Register achievement handlers
 */
export function registerAchievementHandlers(bot) {
  bot.callbackQuery('achievements', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showAchievements(ctx);
  });
}
