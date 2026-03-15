import { supabase } from '../../src/db/supabase.js';
import { Bot } from 'grammy';
import { BOT_TOKEN, CRON_SECRET } from '../../src/config.js';

export default async function handler(req, res) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const bot = new Bot(BOT_TOKEN);

    // Get medicines expiring within threshold days
    const now = new Date();
    const thirtyDaysFromNow = new Date(now);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    // Find medicines expiring soon (not archived)
    const { data: expiringMeds } = await supabase
      .from('medicines')
      .select('*, medkits(name, owner_id)')
      .eq('is_archived', false)
      .lte('expiry_date', thirtyDaysFromNow.toISOString().split('T')[0])
      .gte('expiry_date', now.toISOString().split('T')[0]);

    if (!expiringMeds || expiringMeds.length === 0) {
      return res.json({ ok: true, notified: 0 });
    }

    // Group by medkit owner and notify
    const byOwner = {};
    for (const med of expiringMeds) {
      const ownerId = med.medkits?.owner_id;
      if (!ownerId) continue;
      if (!byOwner[ownerId]) byOwner[ownerId] = [];
      byOwner[ownerId].push(med);
    }

    let notified = 0;
    for (const [userId, meds] of Object.entries(byOwner)) {
      const { data: user } = await supabase
        .from('users')
        .select('telegram_id, settings')
        .eq('id', userId)
        .single();

      if (!user || !user.settings?.notifications?.expiry_alerts) continue;

      let text = '⚠️ *Срок годности истекает:*\n\n';
      for (const med of meds) {
        const daysLeft = Math.ceil((new Date(med.expiry_date) - now) / (1000 * 60 * 60 * 24));
        const emoji = daysLeft <= 0 ? '❌' : '⚠️';
        text += `${emoji} ${med.name}${med.dosage ? ' ' + med.dosage : ''}\n`;
        text += `   📦 ${med.medkits?.name} | ${daysLeft <= 0 ? 'ПРОСРОЧЕНО' : `${daysLeft} дн.`}\n\n`;
      }

      try {
        await bot.api.sendMessage(user.telegram_id, text, { parse_mode: 'Markdown' });
        notified++;
      } catch (e) {
        console.error(`Failed to notify user ${userId}:`, e.message);
      }
    }

    return res.json({ ok: true, notified });
  } catch (error) {
    console.error('Expiry check error:', error);
    return res.status(500).json({ error: error.message });
  }
}
