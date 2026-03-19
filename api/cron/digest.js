import { supabase } from '../../src/db/supabase.js';
import { Bot } from 'grammy';
import { BOT_TOKEN, CRON_SECRET, TIPS } from '../../src/config.js';
import { InlineKeyboard } from 'grammy';
import { t } from '../../src/locales/index.js';
import { pluralize } from '../../src/utils/format.js';
import { log } from '../../src/utils/logger.js';
import { safeSend } from '../../src/utils/retry.js';
import { awardAchievementSilent } from '../../src/handlers/achievements.js';

export default async function handler(req, res) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // #79 Cron metrics
  const startTime = Date.now();
  let errors = 0;

  try {
    const bot = new Bot(BOT_TOKEN);
    const now = new Date();

    // Find all users with settings
    const { data: users } = await supabase
      .from('users')
      .select('id, telegram_id, timezone, settings, created_at, last_active_at, last_inactivity_reminder_at')
      .not('settings', 'is', null);

    if (!users || users.length === 0) {
      return res.json({ ok: true, sent: 0 });
    }

    let sent = 0;
    let tipsSent = 0;
    let inactiveReminders = 0;

    for (const user of users) {
      try {
        const settings = user.settings;
        const lang = settings?.language || 'ru';
        const timezone = user.timezone || 'Europe/Moscow';

        // ─── Feature tips (#83) ───────────────────────────────
        if (settings?.showTips !== false) {
          try {
            await sendTipIfNeeded(bot, user, lang, now);
            tipsSent++;
          } catch (e) {
            log('error', { cron: 'digest', action: 'send_tip', userId: user.id, error: e.message });
          }
        }

        // ─── Inactive user reminder (#89) ─────────────────────
        if (settings?.inactivityReminder !== false) {
          try {
            await sendInactiveReminderIfNeeded(bot, user, lang, now);
            inactiveReminders++;
          } catch (e) {
            log('error', { cron: 'digest', action: 'inactive_reminder', userId: user.id, error: e.message });
          }
        }

        // ─── #90 month_with_bot achievement ─────────────────────
        if (user.created_at) {
          try {
            const createdAt = new Date(user.created_at);
            const daysSinceCreation = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
            if (daysSinceCreation >= 30) {
              const tBound = (key, params) => t(key, lang, params);
              await awardAchievementSilent(user.id, 'month_with_bot', bot, user.telegram_id, tBound);
            }
          } catch (e) {
            log('error', { cron: 'digest', action: 'month_with_bot', userId: user.id, error: e.message });
          }
        }

        // ─── Digest ───────────────────────────────────────────
        if (!settings?.digest?.enabled) continue;

        const digestTime = settings.digest.time || '08:00';

        // Check if current hour matches digest time in user's timezone
        const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));

        // Allow 30-minute window for cron execution
        const [digestH, digestM] = digestTime.split(':').map(Number);
        const digestMinutes = digestH * 60 + digestM;
        const currentMinutes = userNow.getHours() * 60 + userNow.getMinutes();
        if (Math.abs(currentMinutes - digestMinutes) > 30) continue;

        // Check if digest already sent today
        const todayStr = userNow.toLocaleDateString('en-CA', { timeZone: timezone });
        const { count: alreadySent } = await supabase
          .from('action_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('action', 'digest_sent')
          .gte('created_at', `${todayStr}T00:00:00`)
          .lte('created_at', `${todayStr}T23:59:59`);

        if (alreadySent > 0) continue;

        // Build digest
        const include = settings.digest.include || ['intakes', 'expiry', 'low_stock'];
        const thresholds = settings.thresholds || { expiry_days: 30, low_stock_count: 5 };

        const parts = [];

        // Fetch memberships once (needed for expiry + low_stock)
        const needsMedkits = include.includes('expiry') || include.includes('low_stock');
        let medkitIds = [];
        if (needsMedkits) {
          const { data: memberships } = await supabase
            .from('medkit_members')
            .select('medkit_id')
            .eq('user_id', user.id);
          medkitIds = (memberships || []).map(m => m.medkit_id);
        }

        // Build all digest count queries in parallel
        const digestQueries = [];
        const queryKeys = [];

        if (include.includes('intakes')) {
          queryKeys.push('intakes');
          digestQueries.push(
            supabase.from('intake_logs').select('*', { count: 'exact', head: true })
              .eq('user_id', user.id)
              .gte('planned_at', `${todayStr}T00:00:00`)
              .lte('planned_at', `${todayStr}T23:59:59`)
          );
        }

        if (include.includes('expiry') && medkitIds.length > 0) {
          const thresholdDate = new Date(now.getTime() + thresholds.expiry_days * 86400000);
          queryKeys.push('expiry');
          digestQueries.push(
            supabase.from('medicines').select('*', { count: 'exact', head: true })
              .in('medkit_id', medkitIds)
              .eq('is_archived', false)
              .not('expiry_date', 'is', null)
              .lte('expiry_date', thresholdDate.toISOString().split('T')[0])
          );
        }

        if (include.includes('low_stock') && medkitIds.length > 0) {
          queryKeys.push('low_stock');
          digestQueries.push(
            supabase.from('medicines').select('*', { count: 'exact', head: true })
              .in('medkit_id', medkitIds)
              .eq('is_archived', false)
              .lte('quantity', thresholds.low_stock_count)
              .gt('quantity', 0)
          );
        }

        if (include.includes('shopping')) {
          queryKeys.push('shopping');
          digestQueries.push(
            supabase.from('shopping_list').select('*', { count: 'exact', head: true })
              .eq('user_id', user.id)
              .eq('is_bought', false)
          );
        }

        const digestResults = await Promise.all(digestQueries);
        const counts = {};
        for (let i = 0; i < queryKeys.length; i++) {
          counts[queryKeys[i]] = digestResults[i].count || 0;
        }

        if (counts.intakes > 0) {
          parts.push(t('cron.digest_intakes', lang, { count: counts.intakes }));
        }
        if (counts.expiry > 0) {
          const word = pluralize(counts.expiry, t('cron.med_1', lang), t('cron.med_2', lang), t('cron.med_5', lang));
          parts.push(t('cron.digest_expiring', lang, { count: counts.expiry, word }));
        }
        if (counts.low_stock > 0) {
          const word = pluralize(counts.low_stock, t('cron.med_1', lang), t('cron.med_2', lang), t('cron.med_5', lang));
          parts.push(t('cron.digest_low', lang, { count: counts.low_stock, word }));
        }
        if (counts.shopping > 0) {
          parts.push(t('cron.digest_shopping', lang, { count: counts.shopping }));
        }

        // Skip if nothing to report
        if (parts.length === 0) continue;

        const dateStr = fmtDate(userNow);
        let text = t('cron.digest_title', lang, { date: dateStr });
        text += parts.join('\n');

        const keyboard = new InlineKeyboard()
          .text(t('menu.btn_medkits', lang), 'medkits')
          .text(t('menu.btn_intake', lang), 'intake_today');

        await safeSend(bot, user.telegram_id, text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });

        // Log digest sent
        await supabase.from('action_logs').insert({
          user_id: user.id,
          action: 'digest_sent',
          entity_type: 'digest',
          details: { date: todayStr },
        });

        sent++;
      } catch (e) {
        errors++;
        log('error', { cron: 'digest', action: 'send_digest', userId: user.id, error: e.message });
      }
    }

    // #79 Cron metrics
    const duration = Date.now() - startTime;
    log('info', { cron: 'digest', duration_ms: duration, sent, tipsSent, inactiveReminders, users: users.length, errors });

    return res.json({ ok: true, sent, tipsSent, inactiveReminders, duration_ms: duration });
  } catch (error) {
    const duration = Date.now() - startTime;
    log('error', { cron: 'digest', duration_ms: duration, error: error.message });
    return res.status(500).json({ error: error.message });
  }
}

function fmtDate(d) {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/**
 * #83 Feature tips — send one tip per day for first 7 days
 */
async function sendTipIfNeeded(bot, user, lang, now) {
  const createdAt = new Date(user.created_at);
  const daysSinceCreation = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

  // Only first 7 days
  if (daysSinceCreation < 0 || daysSinceCreation >= 7) return;

  const tipKey = TIPS[daysSinceCreation]; // tip_1 through tip_7
  if (!tipKey) return;

  // Check if already sent
  const { count: alreadySent } = await supabase
    .from('action_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('action', 'tip_sent')
    .eq('entity_id', tipKey);

  if (alreadySent > 0) return;

  const tipText = t(`onboarding.${tipKey}`, lang);
  if (tipText === `onboarding.${tipKey}`) return; // Key not found

  try {
    await safeSend(bot, user.telegram_id, tipText);

    await supabase.from('action_logs').insert({
      user_id: user.id,
      action: 'tip_sent',
      entity_type: 'tip',
      entity_id: tipKey,
    });
  } catch { /* user may have blocked the bot */ }
}

/**
 * #89 Inactive user reminder — if last_active_at > 14 days ago
 * and user has active schedules, send one reminder max every 30 days
 */
async function sendInactiveReminderIfNeeded(bot, user, lang, now) {
  if (!user.last_active_at) return;

  const lastActive = new Date(user.last_active_at);
  const daysSinceActive = Math.floor((now - lastActive) / (1000 * 60 * 60 * 24));

  // Only if inactive for > 14 days
  if (daysSinceActive <= 14) return;

  // Check last reminder sent (max 1 per 30 days)
  if (user.last_inactivity_reminder_at) {
    const lastReminder = new Date(user.last_inactivity_reminder_at);
    const daysSinceReminder = Math.floor((now - lastReminder) / (1000 * 60 * 60 * 24));
    if (daysSinceReminder < 30) return;
  }

  // Check if user has active schedules
  const { count: activeScheds } = await supabase
    .from('schedules')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'active');

  if (!activeScheds || activeScheds === 0) return;

  // Count pending intakes
  const todayStr = now.toISOString().split('T')[0];
  const { count: pendingCount } = await supabase
    .from('intake_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .gte('planned_at', `${todayStr}T00:00:00`);

  const count = pendingCount || activeScheds;

  try {
    await safeSend(bot,
      user.telegram_id,
      t('cron.inactive_reminder', lang, { count })
    );

    // Update last_inactivity_reminder_at
    await supabase
      .from('users')
      .update({ last_inactivity_reminder_at: now.toISOString() })
      .eq('id', user.id);
  } catch { /* user may have blocked the bot */ }
}
