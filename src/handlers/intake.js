import { InlineKeyboard } from 'grammy';
import { getTodayIntakeLogs, markIntakeTaken, markIntakeSkipped } from '../db/queries/intakeLogs.js';
import { getMedicine, updateMedicine } from '../db/queries/medicines.js';
import { getSchedule } from '../db/queries/schedules.js';
import { addToShoppingList } from '../db/queries/shoppingList.js';
import { supabase } from '../db/supabase.js';
import { formatQuantity } from '../utils/format.js';

/**
 * Format time string from ISO or HH:MM
 */
function formatTime(plannedAt) {
  const d = new Date(plannedAt);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Status emoji for intake log
 */
function statusEmoji(status) {
  switch (status) {
    case 'taken': return '✅';
    case 'skipped': return '❌';
    case 'snoozed': return '⏰';
    default: return '⏳';
  }
}

/**
 * #28 Auto-add to shopping list when medicine is low stock
 * Checks settings.autoShoppingList and thresholds, adds if not duplicate
 */
async function checkAutoShoppingList(ctx, med, newQty) {
  try {
    const settings = ctx.dbUser?.settings || {};
    if (!settings.autoShoppingList) return;

    const thresholds = settings.thresholds || {};
    const lowCount = thresholds.low_stock_count || 5;
    const lowPercent = thresholds.low_stock_percent || 20;
    const isLow = newQty <= lowCount || (med.initial_quantity > 0 && (newQty / med.initial_quantity) * 100 <= lowPercent);

    if (!isLow) return;

    // Check for duplicate (unbought item with same medicine_id)
    const { data: existing } = await supabase
      .from('shopping_list')
      .select('id')
      .eq('medicine_id', med.id)
      .eq('is_bought', false)
      .limit(1);

    if (existing && existing.length > 0) return;

    await addToShoppingList(ctx.dbUser.id, med.name, med.id, med.medkit_id);

    // Send notification about auto-add
    try {
      await ctx.api.sendMessage(ctx.chat.id,
        ctx.t('cron.auto_added_shop', { name: med.name }),
        { parse_mode: 'Markdown' }
      );
    } catch { /* ignore notification errors */ }
  } catch (e) {
    console.error('Error in auto-shopping list check:', e);
  }
}

/**
 * Build today's intake view text and keyboard
 */
async function buildTodayView(ctx, userId, timezone) {
  const logs = await getTodayIntakeLogs(userId, timezone);

  if (logs.length === 0) {
    return {
      text: ctx.t('intake.empty'),
      keyboard: new InlineKeyboard().text(ctx.t('common.back'), 'main_menu'),
    };
  }

  // Group by time
  const byTime = {};
  for (const log of logs) {
    const time = formatTime(log.planned_at);
    if (!byTime[time]) byTime[time] = [];
    byTime[time].push(log);
  }

  let text = ctx.t('intake.title');
  const keyboard = new InlineKeyboard();
  const times = Object.keys(byTime).sort();

  for (const time of times) {
    text += ctx.t('intake.time_header', { time });
    for (const log of byTime[time]) {
      const name = log.medicines?.name || ctx.t('intake.unknown_medicine');
      const dose = log.schedules?.dose_per_intake || 1;
      const unit = log.medicines?.quantity_unit || ctx.t('intake.default_unit');
      const emoji = statusEmoji(log.status);

      text += `  ${emoji} ${name} — ${dose} ${unit}`;
      if (log.note) text += ` 📝`;
      text += '\n';

      // Action buttons for pending/snoozed intakes
      if (log.status === 'pending' || log.status === 'snoozed') {
        keyboard
          .text(`✅ ${name}`, `intake:${log.id}:take`)
          .text('❌', `intake:${log.id}:skip`)
          .row();
      }
    }
    text += '\n';
  }

  // Summary
  const total = logs.length;
  const taken = logs.filter(l => l.status === 'taken').length;
  const skipped = logs.filter(l => l.status === 'skipped').length;
  const pending = logs.filter(l => l.status === 'pending' || l.status === 'snoozed').length;

  text += ctx.t('intake.summary', { taken, total });
  if (skipped > 0) text += ctx.t('intake.summary_skipped', { count: skipped });
  if (pending > 0) text += ctx.t('intake.summary_pending', { count: pending });

  keyboard.text(ctx.t('common.back'), 'main_menu');

  return { text, keyboard };
}

/**
 * Register intake handlers
 */
export function registerIntakeHandlers(bot) {
  // Today's intake view
  bot.callbackQuery('intake_today', async (ctx) => {
    await ctx.answerCallbackQuery();
    const timezone = ctx.dbUser.timezone || 'Europe/Moscow';
    const { text, keyboard } = await buildTodayView(ctx, ctx.dbUser.id, timezone);
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  // Mark as taken
  bot.callbackQuery(/^intake:([0-9a-f-]+):take$/, async (ctx) => {
    const logId = ctx.match[1];
    try {
      const log = await markIntakeTaken(logId);

      // Subtract dose from medicine quantity
      if (log.medicine_id) {
        const med = await getMedicine(log.medicine_id);
        if (med) {
          const schedule = log.schedule_id ? await getSchedule(log.schedule_id) : null;
          const dose = schedule?.dose_per_intake || 1;
          const newQty = Math.max(0, med.quantity - dose);
          await updateMedicine(log.medicine_id, { quantity: newQty });

          // #40 Auto-pause schedules when quantity reaches zero
          if (newQty <= 0) {
            const { data: activeScheds } = await supabase
              .from('schedules')
              .select('id')
              .eq('medicine_id', log.medicine_id)
              .eq('status', 'active');
            if (activeScheds && activeScheds.length > 0) {
              await supabase
                .from('schedules')
                .update({ status: 'paused' })
                .in('id', activeScheds.map(s => s.id));
              // Notify user about auto-pause after re-rendering
              try {
                await ctx.api.sendMessage(ctx.chat.id,
                  ctx.t('schedule.auto_pause', { name: med.name, count: activeScheds.length })
                );
              } catch { /* ignore notification errors */ }
            }
          }
        }
      }

      await ctx.answerCallbackQuery(ctx.t('intake.taken_toast'));
    } catch (e) {
      console.error('Error marking intake taken:', e);
      await ctx.answerCallbackQuery(ctx.t('intake.taken_error'));
      return;
    }

    // Re-render today view
    const timezone = ctx.dbUser.timezone || 'Europe/Moscow';
    const { text, keyboard } = await buildTodayView(ctx, ctx.dbUser.id, timezone);
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  // Mark as skipped
  bot.callbackQuery(/^intake:([0-9a-f-]+):skip$/, async (ctx) => {
    const logId = ctx.match[1];
    try {
      await markIntakeSkipped(logId);
      await ctx.answerCallbackQuery(ctx.t('intake.skipped_toast'));
    } catch (e) {
      console.error('Error marking intake skipped:', e);
      await ctx.answerCallbackQuery(ctx.t('intake.skipped_error'));
      return;
    }

    // Re-render today view
    const timezone = ctx.dbUser.timezone || 'Europe/Moscow';
    const { text, keyboard } = await buildTodayView(ctx, ctx.dbUser.id, timezone);
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  // Add note to intake — set state for text input
  bot.callbackQuery(/^intake:([0-9a-f-]+):note$/, async (ctx) => {
    const logId = ctx.match[1];
    await ctx.answerCallbackQuery();

    await supabase.from('sessions').upsert(
      {
        key: `state:${ctx.dbUser.id}`,
        value: {
          action: 'intake_note',
          logId,
          msgId: ctx.callbackQuery.message.message_id,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );

    await ctx.editMessageText(
      ctx.t('intake.note_prompt'),
      {
        reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), 'intake_today'),
      }
    );
  });

  // Snooze intake (+15 min) — used from reminder messages
  bot.callbackQuery(/^intake:([0-9a-f-]+):snooze$/, async (ctx) => {
    const logId = ctx.match[1];
    try {
      const { snoozeIntake } = await import('../db/queries/intakeLogs.js');
      await snoozeIntake(logId);
      await ctx.answerCallbackQuery(ctx.t('intake.snoozed_toast'));

      // Update the reminder message
      await ctx.editMessageText(
        ctx.callbackQuery.message.text + '\n\n' + ctx.t('intake.snoozed_label'),
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.error('Error snoozing intake:', e);
      await ctx.answerCallbackQuery(ctx.t('intake.skipped_error'));
    }
  });

  // Take from reminder message
  bot.callbackQuery(/^intake:([0-9a-f-]+):take_remind$/, async (ctx) => {
    const logId = ctx.match[1];
    try {
      const log = await markIntakeTaken(logId);

      // Subtract dose from medicine quantity
      if (log.medicine_id) {
        const med = await getMedicine(log.medicine_id);
        if (med) {
          const schedule = log.schedule_id ? await getSchedule(log.schedule_id) : null;
          const dose = schedule?.dose_per_intake || 1;
          const newQty = Math.max(0, med.quantity - dose);
          await updateMedicine(log.medicine_id, { quantity: newQty });

          // #40 Auto-pause schedules when quantity reaches zero
          if (newQty <= 0) {
            const { data: activeScheds } = await supabase
              .from('schedules')
              .select('id')
              .eq('medicine_id', log.medicine_id)
              .eq('status', 'active');
            if (activeScheds && activeScheds.length > 0) {
              await supabase
                .from('schedules')
                .update({ status: 'paused' })
                .in('id', activeScheds.map(s => s.id));
              try {
                await ctx.api.sendMessage(ctx.chat.id,
                  ctx.t('schedule.auto_pause', { name: med.name, count: activeScheds.length })
                );
              } catch { /* ignore notification errors */ }
            }
          }
        }
      }

      await ctx.answerCallbackQuery(ctx.t('intake.taken_toast'));
      await ctx.editMessageText(
        ctx.callbackQuery.message.text + '\n\n' + ctx.t('intake.taken_label'),
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.error('Error marking intake taken from reminder:', e);
      await ctx.answerCallbackQuery(ctx.t('intake.skipped_error'));
    }
  });

  // Batch take from grouped reminder (#44)
  bot.callbackQuery(/^intake:batch_take:(.+)$/, async (ctx) => {
    const logIdsStr = ctx.match[1];
    const logIds = logIdsStr.split(',');

    for (const logId of logIds) {
      try {
        const log = await markIntakeTaken(logId);

        // Subtract dose from medicine quantity
        if (log.medicine_id) {
          const med = await getMedicine(log.medicine_id);
          if (med) {
            const schedule = log.schedule_id ? await getSchedule(log.schedule_id) : null;
            const dose = schedule?.dose_per_intake || 1;
            const newQty = Math.max(0, med.quantity - dose);
            await updateMedicine(log.medicine_id, { quantity: newQty });

            // #40 Auto-pause schedules when quantity reaches zero
            if (newQty <= 0) {
              const { data: activeScheds } = await supabase
                .from('schedules')
                .select('id')
                .eq('medicine_id', log.medicine_id)
                .eq('status', 'active');
              if (activeScheds && activeScheds.length > 0) {
                await supabase
                  .from('schedules')
                  .update({ status: 'paused' })
                  .in('id', activeScheds.map(s => s.id));
                try {
                  await ctx.api.sendMessage(ctx.chat.id,
                    ctx.t('schedule.auto_pause', { name: med.name, count: activeScheds.length })
                  );
                } catch { /* ignore notification errors */ }
              }
            }
          }
        }
      } catch (e) {
        console.error(`Error marking batch intake taken (${logId}):`, e);
      }
    }

    await ctx.answerCallbackQuery(ctx.t('intake.taken_toast'));
    try {
      await ctx.editMessageText(
        ctx.callbackQuery.message.text + '\n\n' + ctx.t('intake.taken_label'),
        { parse_mode: 'Markdown' }
      );
    } catch { /* message may already be edited */ }
  });

  // Skip from reminder message
  bot.callbackQuery(/^intake:([0-9a-f-]+):skip_remind$/, async (ctx) => {
    const logId = ctx.match[1];
    try {
      await markIntakeSkipped(logId);
      await ctx.answerCallbackQuery(ctx.t('intake.skipped_toast'));
      await ctx.editMessageText(
        ctx.callbackQuery.message.text + '\n\n' + ctx.t('intake.skipped_label'),
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.error('Error skipping intake from reminder:', e);
      await ctx.answerCallbackQuery(ctx.t('intake.skipped_error'));
    }
  });
}
