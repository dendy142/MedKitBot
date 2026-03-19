import { supabase } from '../../src/db/supabase.js';
import { Bot } from 'grammy';
import { BOT_TOKEN, CRON_SECRET } from '../../src/config.js';
import { t } from '../../src/locales/index.js';

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

      const lang = user.settings?.language || 'ru';
      let text = t('cron.expiry_title', lang);
      for (const med of uniqueMeds) {
        const daysLeft = Math.ceil((new Date(med.expiry_date) - now) / (1000 * 60 * 60 * 24));
        const emoji = daysLeft <= 0 ? '❌' : '⚠️';
        const timeLeft = daysLeft <= 0 ? t('cron.expiry_overdue', lang) : t('cron.expiry_days', lang, { count: daysLeft });
        text += `${emoji} ${med.name}${med.dosage ? ' ' + med.dosage : ''}\n`;
        text += `   📦 ${med.medkits?.name} | ${timeLeft}\n\n`;
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

    // ── #27 Low stock warnings ──────────────────────────────────────
    let lowStockNotified = 0;

    // Find medicines where quantity is low, not archived, and has active schedules
    const { data: lowStockMeds } = await supabase
      .from('medicines')
      .select('id, name, quantity, quantity_unit, medkit_id, medkits(id, name, owner_id)')
      .eq('is_archived', false)
      .gt('quantity', 0); // still has some left

    if (lowStockMeds && lowStockMeds.length > 0) {
      // Filter to only medicines with active schedules
      const lowStockMedIds = lowStockMeds.map(m => m.id);
      const { data: activeSchedules } = await supabase
        .from('schedules')
        .select('medicine_id')
        .in('medicine_id', lowStockMedIds)
        .eq('status', 'active');

      const medsWithSchedules = new Set((activeSchedules || []).map(s => s.medicine_id));

      // Get all affected medkit members
      const lowStockMedkitIds = [...new Set(lowStockMeds.filter(m => medsWithSchedules.has(m.id)).map(m => m.medkit_id))];

      if (lowStockMedkitIds.length > 0) {
        const { data: lsMembers } = await supabase
          .from('medkit_members')
          .select('user_id, medkit_id')
          .in('medkit_id', lowStockMedkitIds);

        // Group low-stock medicines per user
        const lowByUser = {};
        for (const member of (lsMembers || [])) {
          const userMeds = lowStockMeds.filter(m =>
            m.medkit_id === member.medkit_id && medsWithSchedules.has(m.id)
          );
          if (userMeds.length === 0) continue;
          if (!lowByUser[member.user_id]) lowByUser[member.user_id] = [];
          lowByUser[member.user_id].push(...userMeds);
        }

        for (const [userId, meds] of Object.entries(lowByUser)) {
          const { data: user } = await supabase
            .from('users')
            .select('telegram_id, settings')
            .eq('id', userId)
            .single();

          if (!user || !user.settings?.notifications?.low_stock) continue;

          const thresholds = user.settings?.thresholds || {};
          const lowCount = thresholds.low_stock_count || 5;
          const lowPercent = thresholds.low_stock_percent || 20;
          const lang = user.settings?.language || 'ru';

          // Deduplicate
          const uniqueMeds = [...new Map(meds.map(m => [m.id, m])).values()];

          for (const med of uniqueMeds) {
            // Check if actually low stock for this user's thresholds
            const isLow = med.quantity <= lowCount;
            if (!isLow) continue;

            // Check if already notified today for this medicine
            const { count: alreadyNotified } = await supabase
              .from('action_logs')
              .select('*', { count: 'exact', head: true })
              .eq('user_id', userId)
              .eq('action', 'low_stock_notification')
              .eq('entity_id', med.id)
              .gte('created_at', todayStr + 'T00:00:00Z');

            if (alreadyNotified > 0) continue;

            try {
              const keyboard = {
                inline_keyboard: [
                  [
                    { text: t('cron.btn_add_to_shop', lang), callback_data: `med:${med.id}:shop` },
                    { text: t('cron.btn_later', lang), callback_data: 'noop' },
                  ],
                ],
              };

              await bot.api.sendMessage(
                user.telegram_id,
                t('cron.low_stock_warning', lang, { name: med.name, count: `${med.quantity} ${med.quantity_unit || 'шт'}` }),
                { reply_markup: keyboard }
              );

              await supabase.from('action_logs').insert({
                user_id: userId,
                action: 'low_stock_notification',
                entity_type: 'medicine',
                entity_id: med.id,
                details: { quantity: med.quantity },
              });

              lowStockNotified++;
            } catch (e) {
              console.error(`Failed to send low stock warning to user ${userId}:`, e.message);
            }
          }
        }
      }
    }

    return res.json({ ok: true, notified, lowStockNotified });
  } catch (error) {
    console.error('Expiry check error:', error);
    return res.status(500).json({ error: error.message });
  }
}
