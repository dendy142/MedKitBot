import { supabase } from '../../src/db/supabase.js';
import { Bot } from 'grammy';
import { BOT_TOKEN, CRON_SECRET } from '../../src/config.js';
import { t } from '../../src/locales/index.js';
import { log } from '../../src/utils/logger.js';
import { safeSend } from '../../src/utils/retry.js';

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

    // Batch: check which users were already notified today & fetch user data
    const allUserIds = Object.keys(byUser);
    const [{ data: alreadyNotifiedLogs }, { data: allUsers }] = await Promise.all([
      supabase
        .from('action_logs')
        .select('user_id')
        .in('user_id', allUserIds)
        .eq('action', 'expiry_notification')
        .gte('created_at', todayStr + 'T00:00:00Z'),
      supabase
        .from('users')
        .select('id, telegram_id, settings')
        .in('id', allUserIds),
    ]);
    const alreadyNotifiedUserIds = new Set((alreadyNotifiedLogs || []).map(l => l.user_id));
    const userMap = {};
    for (const u of (allUsers || [])) userMap[u.id] = u;

    let notified = 0;
    for (const [userId, meds] of Object.entries(byUser)) {
      if (alreadyNotifiedUserIds.has(userId)) continue;

      // Deduplicate medicines (user may be member of multiple medkits)
      const uniqueMeds = [...new Map(meds.map(m => [m.id, m])).values()];

      const user = userMap[userId];
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
        await safeSend(bot, user.telegram_id, text, { parse_mode: 'Markdown' });
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
        errors++;
        log('error', { cron: 'expiry-check', action: 'notify_expiry', userId, error: e.message });
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

        // Batch-fetch all low-stock users
        const lowUserIds = Object.keys(lowByUser);
        const { data: lowUsers } = await supabase
          .from('users')
          .select('id, telegram_id, settings')
          .in('id', lowUserIds);
        const lowUserMap = {};
        for (const u of (lowUsers || [])) lowUserMap[u.id] = u;

        for (const [userId, meds] of Object.entries(lowByUser)) {
          const user = lowUserMap[userId];
          if (!user || !user.settings?.notifications?.low_stock_alerts) continue;

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

            // #28 Auto-add to shopping list if setting enabled
            let autoAdded = false;
            if (user.settings?.autoShoppingList) {
              // Check for existing non-bought item with same medicine_id
              const { data: existingShopItem } = await supabase
                .from('shopping_list')
                .select('id')
                .eq('user_id', userId)
                .eq('medicine_id', med.id)
                .eq('is_bought', false)
                .limit(1);

              if (!existingShopItem || existingShopItem.length === 0) {
                await supabase.from('shopping_list').insert({
                  user_id: userId,
                  medicine_id: med.id,
                  name: med.name,
                  is_bought: false,
                });
                autoAdded = true;
              }
            }

            try {
              let msgText = t('cron.low_stock_warning', lang, { name: med.name, count: `${med.quantity} ${med.quantity_unit || 'шт'}` });

              if (autoAdded) {
                msgText += t('cron.auto_added_shop', lang, { name: med.name });
              }

              const buttons = autoAdded
                ? [[{ text: t('cron.btn_later', lang), callback_data: 'noop' }]]
                : [
                    [
                      { text: t('cron.btn_add_to_shop', lang), callback_data: `med:${med.id}:shop` },
                      { text: t('cron.btn_later', lang), callback_data: 'noop' },
                    ],
                  ];

              const keyboard = { inline_keyboard: buttons };

              await safeSend(bot,
                user.telegram_id,
                msgText,
                { reply_markup: keyboard, parse_mode: 'Markdown' }
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
              errors++;
              log('error', { cron: 'expiry-check', action: 'notify_low_stock', userId, error: e.message });
            }
          }
        }
      }
    }

    // #79 Cron metrics
    const duration = Date.now() - startTime;
    log('info', { cron: 'expiry-check', duration_ms: duration, notified, lowStockNotified, errors });

    return res.json({ ok: true, notified, lowStockNotified, duration_ms: duration });
  } catch (error) {
    const duration = Date.now() - startTime;
    log('error', { cron: 'expiry-check', duration_ms: duration, error: error.message });
    return res.status(500).json({ error: error.message });
  }
}
