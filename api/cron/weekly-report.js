import { supabase } from '../../src/db/supabase.js';
import { Bot } from 'grammy';
import { BOT_TOKEN, CRON_SECRET } from '../../src/config.js';
import { InlineKeyboard } from 'grammy';
import { t } from '../../src/locales/index.js';
import { pluralize } from '../../src/utils/format.js';
import { log } from '../../src/utils/logger.js';
import { safeSend } from '../../src/utils/retry.js';

export default async function handler(req, res) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const bot = new Bot(BOT_TOKEN);
    const now = new Date();

    // Find users with weekly report enabled
    const { data: users } = await supabase
      .from('users')
      .select('id, telegram_id, timezone, settings')
      .not('settings', 'is', null);

    if (!users || users.length === 0) {
      return res.json({ ok: true, sent: 0 });
    }

    let sent = 0;

    for (const user of users) {
      try {
        const settings = user.settings;
        if (!settings?.weeklyReport) continue;

        const lang = settings.language || 'ru';
        const timezone = user.timezone || 'Etc/GMT-3';

        // Calculate last 7 days range
        const weekAgo = new Date(now.getTime() - 7 * 86400000);
        const startDate = weekAgo.toISOString();
        const endDate = now.toISOString();

        const parts = [];

        // 1. Adherence: taken / planned intake logs in the last 7 days
        const { count: plannedCount } = await supabase
          .from('intake_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .gte('planned_at', startDate)
          .lte('planned_at', endDate);

        const { count: takenCount } = await supabase
          .from('intake_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('status', 'taken')
          .gte('planned_at', startDate)
          .lte('planned_at', endDate);

        if (plannedCount > 0) {
          const pct = Math.round((takenCount / plannedCount) * 100);
          parts.push(t('cron.weekly_adherence', lang, { pct, taken: takenCount, planned: plannedCount }));
          if (pct === 100) {
            parts.push(t('cron.weekly_perfect', lang));
          }
        }

        // 2. Expiring medicines
        const thresholds = settings.thresholds || { expiry_days: 30, low_stock_count: 5 };
        const thresholdDate = new Date(now.getTime() + thresholds.expiry_days * 86400000);

        const { data: memberships } = await supabase
          .from('medkit_members')
          .select('medkit_id')
          .eq('user_id', user.id);

        if (memberships && memberships.length > 0) {
          const medkitIds = memberships.map(m => m.medkit_id);

          const { count: expiryCount } = await supabase
            .from('medicines')
            .select('*', { count: 'exact', head: true })
            .in('medkit_id', medkitIds)
            .eq('is_archived', false)
            .not('expiry_date', 'is', null)
            .lte('expiry_date', thresholdDate.toISOString().split('T')[0]);

          if (expiryCount > 0) {
            const word = pluralize(expiryCount, t('cron.med_1', lang), t('cron.med_2', lang), t('cron.med_5', lang));
            parts.push(t('cron.weekly_expiring', lang, { count: expiryCount, word }));
          }

          // 3. Low stock count
          const { count: lowCount } = await supabase
            .from('medicines')
            .select('*', { count: 'exact', head: true })
            .in('medkit_id', medkitIds)
            .eq('is_archived', false)
            .lte('quantity', thresholds.low_stock_count)
            .gt('quantity', 0);

          if (lowCount > 0) {
            const word = pluralize(lowCount, t('cron.med_1', lang), t('cron.med_2', lang), t('cron.med_5', lang));
            parts.push(t('cron.weekly_low_stock', lang, { count: lowCount, word }));
          }
        }

        // 4. Shopping list count
        const { count: shopCount } = await supabase
          .from('shopping_list')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('is_bought', false);

        if (shopCount > 0) {
          parts.push(t('cron.weekly_shopping', lang, { count: shopCount }));
        }

        // Skip if nothing to report
        if (parts.length === 0) continue;

        let text = t('cron.weekly_title', lang);
        text += parts.join('\n');

        const keyboard = new InlineKeyboard()
          .text(t('menu.btn_medkits', lang), 'medkits')
          .text(t('menu.btn_intake', lang), 'intake_today');

        await safeSend(bot, user.telegram_id, text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });

        sent++;
      } catch (e) {
        log('error', { action: 'weekly_report_user', userId: user.id, error: e.message });
      }
    }

    return res.json({ ok: true, sent });
  } catch (error) {
    log('error', { action: 'weekly_report_cron', error: error.message });
    return res.status(500).json({ error: error.message });
  }
}
