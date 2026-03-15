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
    const todayStr = now.toISOString().split('T')[0];
    const thirtyDaysFromNow = new Date(now);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    // Find medicines expiring soon (not archived)
    const { data: expiringMeds } = await supabase
      .from('medicines')
      .select('*, medkits(id, name, owner_id)')
      .eq('is_archived', false)
      .lte('expiry_date', thirtyDaysFromNow.toISOString().split('T')[0])
      .gte('expiry_date', todayStr);

    if (!expiringMeds || expiringMeds.length === 0) {
      return res.json({ ok: true, notified: 0 });
    }

    // Group by medkit to find all members (not just owners)
    const medkitIds = [...new Set(expiringMeds.map(m => m.medkit_id))];

    // Get all members of affected medkits
    const { data: members } = await supabase
      .from('medkit_members')
      .select('user_id, medkit_id')
      .in('medkit_id', medkitIds);

    if (!members || members.length === 0) {
      return res.json({ ok: true, notified: 0 });
    }

    // Group medicines by user (through medkit membership)
    const byUser = {};
    for (const member of members) {
      const userMeds = expiringMeds.filter(m => m.medkit_id === member.medkit_id);
      if (userMeds.length === 0) continue;
      if (!byUser[member.user_id]) byUser[member.user_id] = [];
      byUser[member.user_id].push(...userMeds);
    }

    let notified = 0;
    for (const [userId, meds] of Object.entries(byUser)) {
      // Deduplicate medicines (user may be member of multiple medkits)
      const uniqueMeds = [...new Map(meds.map(m => [m.id, m])).values()];

      // Check if already notified today
      const { count } = await supabase
        .from('action_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('action', 'expiry_notification')
        .gte('created_at', todayStr + 'T00:00:00Z');

      if (count > 0) continue; // skip, already notified

      const { data: user } = await supabase
        .from('users')
        .select('telegram_id, settings')
        .eq('id', userId)
        .single();

      if (!user || !user.settings?.notifications?.expiry_alerts) continue;

      let text = '⚠️ *Срок годности истекает:*\n\n';
      for (const med of uniqueMeds) {
        const daysLeft = Math.ceil((new Date(med.expiry_date) - now) / (1000 * 60 * 60 * 24));
        const emoji = daysLeft <= 0 ? '❌' : '⚠️';
        text += `${emoji} ${med.name}${med.dosage ? ' ' + med.dosage : ''}\n`;
        text += `   📦 ${med.medkits?.name} | ${daysLeft <= 0 ? 'ПРОСРОЧЕНО' : `${daysLeft} дн.`}\n\n`;
      }

      try {
        await bot.api.sendMessage(user.telegram_id, text, { parse_mode: 'Markdown' });
        notified++;

        // Log notification
        await supabase.from('action_logs').insert({
          user_id: userId,
          action: 'expiry_notification',
          entity_type: 'medicine',
          entity_id: uniqueMeds[0].id,
          details: { count: uniqueMeds.length },
        });
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
