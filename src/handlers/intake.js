import { InlineKeyboard } from 'grammy';
import { getTodayIntakeLogs, markIntakeTaken, markIntakeSkipped } from '../db/queries/intakeLogs.js';
import { getMedicine, updateMedicine } from '../db/queries/medicines.js';
import { getSchedule } from '../db/queries/schedules.js';
import { supabase } from '../db/supabase.js';
import { formatQuantity, formatProgressBar } from '../utils/format.js';

/**
 * Format time string from ISO in user's timezone
 */
function formatTime(plannedAt, timezone = 'Europe/Moscow') {
  const d = new Date(plannedAt);
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone });
  return fmt.format(d);
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
 * Build today's intake view text and keyboard
 */
async function buildTodayView(userId, timezone) {
  const logs = await getTodayIntakeLogs(userId, timezone);

  if (logs.length === 0) {
    return {
      text: '💊 *Приём на сегодня*\n\nНет запланированных приёмов.\n\n💡 _Добавьте курс приёма через карточку лекарства → 📆 Курс приёма_',
      keyboard: new InlineKeyboard()
        .text('📦 Аптечки', 'medkits')
        .row()
        .text('◀️ Назад', 'main_menu'),
    };
  }

  // Group by time
  const byTime = {};
  for (const log of logs) {
    const time = formatTime(log.planned_at, timezone);
    if (!byTime[time]) byTime[time] = [];
    byTime[time].push(log);
  }

  let text = '💊 *Приём на сегодня*\n\n';
  const keyboard = new InlineKeyboard();
  const times = Object.keys(byTime).sort();

  for (const time of times) {
    text += `🕐 *${time}*\n`;
    for (const log of byTime[time]) {
      const name = log.medicines?.name || 'Неизвестно';
      const dose = log.schedules?.dose_per_intake || 1;
      const unit = log.medicines?.quantity_unit || 'шт';
      const emoji = statusEmoji(log.status);

      text += `  ${emoji} ${name} — ${dose} ${unit}`;
      if (log.status === 'snoozed' && log.snooze_count) text += ` (⏰×${log.snooze_count})`;
      if (log.note) text += ` 📝`;
      text += '\n';

      // Action buttons for pending/snoozed intakes
      if (log.status === 'pending' || log.status === 'snoozed') {
        keyboard
          .text(`✅ ${name}`, `intake:${log.id}:take`)
          .text('❌', `intake:${log.id}:skip`)
          .text('📝', `intake:${log.id}:note`)
          .row();
      }
    }

    // P1.5: "Take All" button if 2+ pending in this time slot
    const pendingInSlot = byTime[time].filter(l => l.status === 'pending' || l.status === 'snoozed');
    if (pendingInSlot.length >= 2) {
      keyboard.text(`✅ Принять все в ${time}`, `intake:takeall:${time}`).row();
    }

    text += '\n';
  }

  // Summary
  const total = logs.length;
  const taken = logs.filter(l => l.status === 'taken').length;
  const skipped = logs.filter(l => l.status === 'skipped').length;
  const pending = logs.filter(l => l.status === 'pending' || l.status === 'snoozed').length;

  const bar = formatProgressBar(taken, total);
  text += `📊 ${bar} ${taken}/${total} принято`;
  if (skipped > 0) text += `, ${skipped} пропущено`;
  if (pending > 0) text += `, ${pending} ожидает`;

  keyboard.text('🔄 Обновить', 'intake_today');
  keyboard.text('◀️ Назад', 'main_menu');

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
    const { text, keyboard } = await buildTodayView(ctx.dbUser.id, timezone);
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
        }
      }

      await ctx.answerCallbackQuery('✅ Приём отмечен');
    } catch (e) {
      console.error('Error marking intake taken:', e);
      await ctx.answerCallbackQuery('Ошибка при отметке приёма');
      return;
    }

    // Re-render today view
    const timezone = ctx.dbUser.timezone || 'Europe/Moscow';
    const { text, keyboard } = await buildTodayView(ctx.dbUser.id, timezone);
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  // P1.5: Take all in a time slot
  bot.callbackQuery(/^intake:takeall:(.+)$/, async (ctx) => {
    const timeSlot = ctx.match[1];
    const timezone = ctx.dbUser.timezone || 'Europe/Moscow';
    const logs = await getTodayIntakeLogs(ctx.dbUser.id, timezone);

    // Find pending/snoozed logs matching this time slot
    const pending = logs.filter(l => {
      const t = formatTime(l.planned_at, timezone);
      return t === timeSlot && (l.status === 'pending' || l.status === 'snoozed');
    });

    let taken = 0;
    for (const log of pending) {
      try {
        await markIntakeTaken(log.id);
        // Subtract dose from medicine quantity
        if (log.medicine_id) {
          const med = await getMedicine(log.medicine_id);
          if (med) {
            const dose = log.schedules?.dose_per_intake || 1;
            const newQty = Math.max(0, med.quantity - dose);
            await updateMedicine(log.medicine_id, { quantity: newQty });
          }
        }
        taken++;
      } catch (e) {
        console.error('Error in takeall:', e);
      }
    }

    await ctx.answerCallbackQuery(`✅ Принято: ${taken}`);

    // Re-render today view
    const { text, keyboard } = await buildTodayView(ctx.dbUser.id, timezone);
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
      await ctx.answerCallbackQuery('❌ Приём пропущен');
    } catch (e) {
      console.error('Error marking intake skipped:', e);
      await ctx.answerCallbackQuery('Ошибка');
      return;
    }

    // Re-render today view
    const timezone = ctx.dbUser.timezone || 'Europe/Moscow';
    const { text, keyboard } = await buildTodayView(ctx.dbUser.id, timezone);
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
      '📝 Введите заметку к приёму:',
      {
        reply_markup: new InlineKeyboard().text('❌ Отмена', 'intake_today'),
      }
    );
  });

  // Snooze intake (+15 min) — used from reminder messages
  bot.callbackQuery(/^intake:([0-9a-f-]+):snooze$/, async (ctx) => {
    const logId = ctx.match[1];
    try {
      const { snoozeIntake } = await import('../db/queries/intakeLogs.js');
      await snoozeIntake(logId);
      await ctx.answerCallbackQuery('⏰ Отложено на 15 мин');

      // Update the reminder message
      await ctx.editMessageText(
        ctx.callbackQuery.message.text + '\n\n⏰ _Отложено_',
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.error('Error snoozing intake:', e);
      await ctx.answerCallbackQuery('Ошибка');
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
        }
      }

      await ctx.answerCallbackQuery('✅ Приём отмечен');
      await ctx.editMessageText(
        ctx.callbackQuery.message.text + '\n\n✅ _Принято_',
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.error('Error marking intake taken from reminder:', e);
      await ctx.answerCallbackQuery('Ошибка');
    }
  });

  // Skip from reminder message
  bot.callbackQuery(/^intake:([0-9a-f-]+):skip_remind$/, async (ctx) => {
    const logId = ctx.match[1];
    try {
      await markIntakeSkipped(logId);
      await ctx.answerCallbackQuery('❌ Пропущено');
      await ctx.editMessageText(
        ctx.callbackQuery.message.text + '\n\n❌ _Пропущено_',
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.error('Error skipping intake from reminder:', e);
      await ctx.answerCallbackQuery('Ошибка');
    }
  });
}
