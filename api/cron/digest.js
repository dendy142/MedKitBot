import { supabase } from '../../src/db/supabase.js';
import { Bot } from 'grammy';
import { BOT_TOKEN, CRON_SECRET } from '../../src/config.js';
import { InlineKeyboard } from 'grammy';
import { t } from '../../src/locales/index.js';
import { pluralize } from '../../src/utils/format.js';

export default async function handler(req, res) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const bot = new Bot(BOT_TOKEN);
    const now = new Date();

    // Find users with digest enabled
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
        if (!settings?.digest?.enabled) continue;

        const lang = settings.language || 'ru';
        const timezone = user.timezone || 'Etc/GMT-3';
        const digestTime = settings.digest.time || '08:00';

        // Check if current hour matches digest time in user's timezone
        const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
        const currentHour = String(userNow.getHours()).padStart(2, '0');
        const currentMinute = String(userNow.getMinutes()).padStart(2, '0');

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

        // Intakes count
        if (include.includes('intakes')) {
          const startOfDay = `${todayStr}T00:00:00`;
          const endOfDay = `${todayStr}T23:59:59`;
          const { count: intakeCount } = await supabase
            .from('intake_logs')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .gte('planned_at', startOfDay)
            .lte('planned_at', endOfDay);
          if (intakeCount > 0) {
            parts.push(t('cron.digest_intakes', lang, { count: intakeCount }));
          }
        }

        // Expiring medicines
        if (include.includes('expiry')) {
          const thresholdDate = new Date(now.getTime() + thresholds.expiry_days * 86400000);

          // Get user's medkits
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
              parts.push(t('cron.digest_expiring', lang, { count: expiryCount, word }));
            }
          }
        }

        // Low stock
        if (include.includes('low_stock')) {
          const { data: memberships } = await supabase
            .from('medkit_members')
            .select('medkit_id')
            .eq('user_id', user.id);

          if (memberships && memberships.length > 0) {
            const medkitIds = memberships.map(m => m.medkit_id);
            const { count: lowCount } = await supabase
              .from('medicines')
              .select('*', { count: 'exact', head: true })
              .in('medkit_id', medkitIds)
              .eq('is_archived', false)
              .lte('quantity', thresholds.low_stock_count)
              .gt('quantity', 0);
            if (lowCount > 0) {
              const word = pluralize(lowCount, t('cron.med_1', lang), t('cron.med_2', lang), t('cron.med_5', lang));
              parts.push(t('cron.digest_low', lang, { count: lowCount, word }));
            }
          }
        }

        // Shopping list
        if (include.includes('shopping')) {
          const { count: shopCount } = await supabase
            .from('shopping_list')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('is_bought', false);
          if (shopCount > 0) {
            parts.push(t('cron.digest_shopping', lang, { count: shopCount }));
          }
        }

        // Skip if nothing to report
        if (parts.length === 0) continue;

        const dateStr = fmtDate(userNow);
        let text = t('cron.digest_title', lang, { date: dateStr });
        text += parts.join('\n');

        const keyboard = new InlineKeyboard()
          .text(t('menu.btn_medkits', lang), 'medkits')
          .text(t('menu.btn_intake', lang), 'intake_today');

        await bot.api.sendMessage(user.telegram_id, text, {
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
        console.error(`Failed to send digest to user ${user.id}:`, e.message);
      }
    }

    return res.json({ ok: true, sent });
  } catch (error) {
    console.error('Digest cron error:', error);
    return res.status(500).json({ error: error.message });
  }
}

function fmtDate(d) {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
