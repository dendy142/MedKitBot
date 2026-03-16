import { InlineKeyboard } from 'grammy';
import { TIMEZONES, DEFAULT_SETTINGS } from '../config.js';
import { updateUserSettings, updateUserTimezone } from '../db/queries/users.js';
import { supabase } from '../db/supabase.js';

const SORT_LABELS = {
  name: 'По имени',
  expiry: 'По сроку',
  category: 'По категории',
  quantity: 'По остатку',
};

/**
 * Show main settings menu
 */
async function showSettings(ctx) {
  const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
  const tz = ctx.dbUser.timezone || 'Europe/Moscow';
  const tzLabel = TIMEZONES.find(t => t.value === tz)?.label || tz;

  let text = `⚙️ *Настройки*\n\n`;
  text += `🕐 Часовой пояс: ${tzLabel}\n`;
  text += `🔔 Напоминания: ${s.notifications?.intake_reminders ? '✅' : '❌'}\n`;
  text += `📅 Сроки годности: ${s.notifications?.expiry_alerts ? '✅' : '❌'}\n`;
  text += `📉 Остатки: ${s.notifications?.low_stock_alerts ? '✅' : '❌'}\n`;
  text += `📊 Дайджест: ${s.digest?.enabled ? '✅' : '❌'}\n`;

  const keyboard = new InlineKeyboard()
    .text('🕐 Часовой пояс', 'set:tz')
    .row()
    .text('🔔 Уведомления', 'set:notif')
    .row()
    .text('📐 Пороги', 'set:thresh')
    .row()
    .text('🌅 Периоды дня', 'set:periods')
    .row()
    .text('📊 Дайджест', 'set:digest')
    .row()
    .text('📋 Отображение', 'set:display')
    .row()
    .text('📤 Экспорт', 'export')
    .text('📥 Импорт', 'import')
    .row()
    .text('◀️ Назад', 'main_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

/**
 * Register settings handlers
 */
export function registerSettingsHandlers(bot) {
  bot.callbackQuery('settings', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showSettings(ctx);
  });

  // --- Timezone ---
  bot.callbackQuery('set:tz', async (ctx) => {
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard();
    for (let i = 0; i < TIMEZONES.length; i += 3) {
      keyboard.text(TIMEZONES[i].label, `set:tz:${TIMEZONES[i].value}`);
      if (TIMEZONES[i + 1]) keyboard.text(TIMEZONES[i + 1].label, `set:tz:${TIMEZONES[i + 1].value}`);
      if (TIMEZONES[i + 2]) keyboard.text(TIMEZONES[i + 2].label, `set:tz:${TIMEZONES[i + 2].value}`);
      keyboard.row();
    }
    keyboard.text('◀️ Назад', 'settings');
    await ctx.editMessageText('🕐 Выберите часовой пояс:', {
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^set:tz:(.+)$/, async (ctx) => {
    await updateUserTimezone(ctx.dbUser.id, ctx.match[1]);
    ctx.dbUser.timezone = ctx.match[1];
    await ctx.answerCallbackQuery('Часовой пояс обновлён');
    await showSettings(ctx);
  });

  // --- Notifications ---
  function buildNotificationKeyboard(n) {
    return new InlineKeyboard()
      .text(`${n.intake_reminders ? '✅' : '❌'} Напоминания о приёме`, 'set:notif:intake_reminders')
      .row()
      .text(`${n.expiry_alerts ? '✅' : '❌'} Сроки годности`, 'set:notif:expiry_alerts')
      .row()
      .text(`${n.low_stock_alerts ? '✅' : '❌'} Остатки`, 'set:notif:low_stock_alerts')
      .row()
      .text(`${n.shared_medkit_changes ? '✅' : '❌'} Общие аптечки`, 'set:notif:shared_medkit_changes')
      .row()
      .text('◀️ Назад', 'settings');
  }

  bot.callbackQuery('set:notif', async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
    const n = s.notifications || DEFAULT_SETTINGS.notifications;
    await ctx.editMessageText('🔔 *Уведомления*\n\nНажмите чтобы вкл/выкл:', {
      parse_mode: 'Markdown',
      reply_markup: buildNotificationKeyboard(n),
    });
  });

  bot.callbackQuery(/^set:notif:(\w+)$/, async (ctx) => {
    const key = ctx.match[1];
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.notifications = { ...(s.notifications || DEFAULT_SETTINGS.notifications) };
    s.notifications[key] = !s.notifications[key];
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(s.notifications[key] ? 'Включено' : 'Выключено');
    await ctx.editMessageText('🔔 *Уведомления*\n\nНажмите чтобы вкл/выкл:', {
      parse_mode: 'Markdown',
      reply_markup: buildNotificationKeyboard(s.notifications),
    });
  });

  // --- Thresholds ---
  function buildThresholdView(t) {
    const check = (val, current) => val === current ? ' ✅' : '';
    const text = `📐 *Пороги предупреждений*\n\n` +
      `📅 Срок годности: за *${t.expiry_days}* дн.\n` +
      `📉 Остаток: *${t.low_stock_count}* шт. или *${t.low_stock_percent}%*`;
    const keyboard = new InlineKeyboard()
      .text(`📅 14 дн.${check(14, t.expiry_days)}`, 'set:thresh:expiry:14')
      .text(`📅 30 дн.${check(30, t.expiry_days)}`, 'set:thresh:expiry:30')
      .text(`📅 60 дн.${check(60, t.expiry_days)}`, 'set:thresh:expiry:60')
      .row()
      .text(`📉 3 шт.${check(3, t.low_stock_count)}`, 'set:thresh:stock:3')
      .text(`📉 5 шт.${check(5, t.low_stock_count)}`, 'set:thresh:stock:5')
      .text(`📉 10 шт.${check(10, t.low_stock_count)}`, 'set:thresh:stock:10')
      .row()
      .text('◀️ Назад', 'settings');
    return { text, keyboard };
  }

  bot.callbackQuery('set:thresh', async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
    const t = s.thresholds || DEFAULT_SETTINGS.thresholds;
    const { text, keyboard } = buildThresholdView(t);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  bot.callbackQuery(/^set:thresh:expiry:(\d+)$/, async (ctx) => {
    const days = parseInt(ctx.match[1]);
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.thresholds = { ...(s.thresholds || DEFAULT_SETTINGS.thresholds) };
    s.thresholds.expiry_days = days;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(`Порог: ${days} дней`);
    const { text, keyboard } = buildThresholdView(s.thresholds);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  bot.callbackQuery(/^set:thresh:stock:(\d+)$/, async (ctx) => {
    const count = parseInt(ctx.match[1]);
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.thresholds = { ...(s.thresholds || DEFAULT_SETTINGS.thresholds) };
    s.thresholds.low_stock_count = count;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(`Порог остатка: ${count} шт.`);
    const { text, keyboard } = buildThresholdView(s.thresholds);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  // --- Day Periods ---
  bot.callbackQuery('set:periods', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showPeriodsMenu(ctx);
  });

  bot.callbackQuery(/^set:period:(morning|afternoon|evening|night)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const period = ctx.match[1];
    const periodLabels = {
      morning: '🌅 Утро',
      afternoon: '☀️ День',
      evening: '🌆 Вечер',
      night: '🌙 Ночь',
    };

    const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
    const dp = s.day_periods || DEFAULT_SETTINGS.day_periods;
    const currentValue = dp[period] || DEFAULT_SETTINGS.day_periods[period];

    // Set state for text input
    const msg = await ctx.editMessageText(
      `${periodLabels[period]}\n\nТекущее время: *${currentValue}*\n\nВведите новое время в формате ЧЧ:ММ (например, 08:00):`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('◀️ Отмена', 'set:periods'),
      }
    );

    await supabase.from('sessions').upsert({
      key: `state:${ctx.dbUser.id}`,
      value: {
        action: 'set_period',
        period,
        msgId: msg.message_id,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  });

  // --- Digest Settings ---
  bot.callbackQuery('set:digest', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showDigestMenu(ctx);
  });

  bot.callbackQuery('set:digest:toggle', async (ctx) => {
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.digest = { ...(s.digest || DEFAULT_SETTINGS.digest) };
    s.digest.enabled = !s.digest.enabled;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(s.digest.enabled ? 'Дайджест включён' : 'Дайджест выключен');
    await showDigestMenu(ctx);
  });

  bot.callbackQuery('set:digest:time', async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
    const digestTime = s.digest?.time || DEFAULT_SETTINGS.digest.time;

    const msg = await ctx.editMessageText(
      `🕐 Время дайджеста\n\nТекущее время: *${digestTime}*\n\nВведите новое время в формате ЧЧ:ММ (например, 08:00):`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('◀️ Отмена', 'set:digest'),
      }
    );

    await supabase.from('sessions').upsert({
      key: `state:${ctx.dbUser.id}`,
      value: {
        action: 'set_digest_time',
        msgId: msg.message_id,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  });

  // --- Display ---
  function buildDisplayView(d) {
    const check = (val, current) => val === current ? ' ✅' : '';
    const text = `📋 *Отображение*\n\n` +
      `🔀 Сортировка: *${SORT_LABELS[d.default_sort] || d.default_sort}*\n` +
      `📅 Формат дат: *${d.date_format}*`;
    const keyboard = new InlineKeyboard()
      .text(`По имени${check('name', d.default_sort)}`, 'set:disp:sort:name')
      .text(`По сроку${check('expiry', d.default_sort)}`, 'set:disp:sort:expiry')
      .row()
      .text(`По категории${check('category', d.default_sort)}`, 'set:disp:sort:category')
      .text(`По остатку${check('quantity', d.default_sort)}`, 'set:disp:sort:quantity')
      .row()
      .text(`ДД.ММ.ГГГГ${check('DD.MM.YYYY', d.date_format)}`, 'set:disp:date:DD.MM.YYYY')
      .text(`ГГГГ-ММ-ДД${check('YYYY-MM-DD', d.date_format)}`, 'set:disp:date:YYYY-MM-DD')
      .row()
      .text('◀️ Назад', 'settings');
    return { text, keyboard };
  }

  bot.callbackQuery('set:display', async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
    const d = s.display || DEFAULT_SETTINGS.display;
    const { text, keyboard } = buildDisplayView(d);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  bot.callbackQuery(/^set:disp:sort:(\w+)$/, async (ctx) => {
    const sort = ctx.match[1];
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.display = { ...(s.display || DEFAULT_SETTINGS.display) };
    s.display.default_sort = sort;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(`Сортировка: ${SORT_LABELS[sort] || sort}`);
    const { text, keyboard } = buildDisplayView(s.display);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  bot.callbackQuery(/^set:disp:date:(.+)$/, async (ctx) => {
    const fmt = ctx.match[1];
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.display = { ...(s.display || DEFAULT_SETTINGS.display) };
    s.display.date_format = fmt;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(`Формат: ${fmt}`);
    const { text, keyboard } = buildDisplayView(s.display);
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });
}

// --- Helper: show day periods menu ---
async function showPeriodsMenu(ctx) {
  const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
  const dp = s.day_periods || DEFAULT_SETTINGS.day_periods;

  const text = `🌅 *Время периодов дня*\n\n` +
    `🌅 Утро: ${dp.morning}\n` +
    `☀️ День: ${dp.afternoon}\n` +
    `🌆 Вечер: ${dp.evening}\n` +
    `🌙 Ночь: ${dp.night}`;

  const keyboard = new InlineKeyboard()
    .text('🌅 Утро', 'set:period:morning')
    .text('☀️ День', 'set:period:afternoon')
    .row()
    .text('🌆 Вечер', 'set:period:evening')
    .text('🌙 Ночь', 'set:period:night')
    .row()
    .text('◀️ Назад', 'settings');

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// --- Helper: show digest menu ---
async function showDigestMenu(ctx) {
  const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
  const dg = s.digest || DEFAULT_SETTINGS.digest;

  const text = `📊 *Настройки дайджеста*\n\n` +
    `Статус: ${dg.enabled ? '✅ Включён' : '❌ Выключен'}\n` +
    `🕐 Время: ${dg.time || '08:00'}`;

  const keyboard = new InlineKeyboard()
    .text(dg.enabled ? '🔕 Выключить' : '🔔 Включить', 'set:digest:toggle')
    .row()
    .text(`🕐 Время: ${dg.time || '08:00'}`, 'set:digest:time')
    .row()
    .text('◀️ Назад', 'settings');

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

/**
 * Handle text input for settings states (day period, digest time)
 * Called from textState.js
 */
export async function handleSettingsTextState(state, text, ctx) {
  if (state.action === 'set_period') {
    const timeMatch = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      await ctx.api.editMessageText(ctx.chat.id, state.msgId,
        '⚠️ Неверный формат. Введите время в формате ЧЧ:ММ (например, 08:00):',
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('◀️ Отмена', 'set:periods'),
        }
      );
      return 'keep_state';
    }

    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      await ctx.api.editMessageText(ctx.chat.id, state.msgId,
        '⚠️ Некорректное время. Введите время в формате ЧЧ:ММ (например, 08:00):',
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('◀️ Отмена', 'set:periods'),
        }
      );
      return 'keep_state';
    }

    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.day_periods = { ...(s.day_periods || DEFAULT_SETTINGS.day_periods) };
    s.day_periods[state.period] = timeStr;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;

    const periodLabels = {
      morning: '🌅 Утро',
      afternoon: '☀️ День',
      evening: '🌆 Вечер',
      night: '🌙 Ночь',
    };

    // Show updated periods menu
    const dp = s.day_periods;
    const menuText = `🌅 *Время периодов дня*\n\n` +
      `🌅 Утро: ${dp.morning}\n` +
      `☀️ День: ${dp.afternoon}\n` +
      `🌆 Вечер: ${dp.evening}\n` +
      `🌙 Ночь: ${dp.night}\n\n` +
      `✅ ${periodLabels[state.period]} обновлено: ${timeStr}`;

    const keyboard = new InlineKeyboard()
      .text('🌅 Утро', 'set:period:morning')
      .text('☀️ День', 'set:period:afternoon')
      .row()
      .text('🌆 Вечер', 'set:period:evening')
      .text('🌙 Ночь', 'set:period:night')
      .row()
      .text('◀️ Назад', 'settings');

    await ctx.api.editMessageText(ctx.chat.id, state.msgId, menuText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    return 'handled';
  }

  if (state.action === 'set_digest_time') {
    const timeMatch = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      await ctx.api.editMessageText(ctx.chat.id, state.msgId,
        '⚠️ Неверный формат. Введите время в формате ЧЧ:ММ (например, 08:00):',
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('◀️ Отмена', 'set:digest'),
        }
      );
      return 'keep_state';
    }

    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      await ctx.api.editMessageText(ctx.chat.id, state.msgId,
        '⚠️ Некорректное время. Введите время в формате ЧЧ:ММ (например, 08:00):',
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('◀️ Отмена', 'set:digest'),
        }
      );
      return 'keep_state';
    }

    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.digest = { ...(s.digest || DEFAULT_SETTINGS.digest) };
    s.digest.time = timeStr;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;

    // Show updated digest menu
    const dg = s.digest;
    const menuText = `📊 *Настройки дайджеста*\n\n` +
      `Статус: ${dg.enabled ? '✅ Включён' : '❌ Выключен'}\n` +
      `🕐 Время: ${dg.time}\n\n` +
      `✅ Время дайджеста обновлено: ${timeStr}`;

    const keyboard = new InlineKeyboard()
      .text(dg.enabled ? '🔕 Выключить' : '🔔 Включить', 'set:digest:toggle')
      .row()
      .text(`🕐 Время: ${dg.time}`, 'set:digest:time')
      .row()
      .text('◀️ Назад', 'settings');

    await ctx.api.editMessageText(ctx.chat.id, state.msgId, menuText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    return 'handled';
  }

  return null;
}
