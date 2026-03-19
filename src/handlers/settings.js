import { InlineKeyboard } from 'grammy';
import { TIMEZONES, DEFAULT_SETTINGS } from '../config.js';
import { updateUserSettings, updateUserTimezone } from '../db/queries/users.js';
import { supabase } from '../db/supabase.js';
import { breadcrumb } from '../utils/format.js';

/**
 * Show main settings menu
 */
async function showSettings(ctx) {
  const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
  const tz = ctx.dbUser.timezone || 'Etc/GMT-3';
  const tzLabel = TIMEZONES.find(t => t.value === tz)?.label || tz;

  // #1 Breadcrumb: 🏠 › Настройки
  const crumb = breadcrumb(ctx.t('common.breadcrumb_home'), ctx.t('settings.title').replace(/[*\n]/g, '').trim());
  let text = `${crumb}\n\n` + ctx.t('settings.title');
  text += ctx.t('settings.tz_label', { value: tzLabel }) + '\n';
  text += ctx.t('settings.notif_reminders', { value: s.notifications?.intake_reminders ? '✅' : '❌' }) + '\n';
  text += ctx.t('settings.notif_expiry', { value: s.notifications?.expiry_alerts ? '✅' : '❌' }) + '\n';
  text += ctx.t('settings.notif_stock', { value: s.notifications?.low_stock_alerts ? '✅' : '❌' }) + '\n';
  text += ctx.t('settings.digest_label', { value: s.digest?.enabled ? '✅' : '❌' }) + '\n';
  text += ctx.t('settings.quiet_label', { value: s.quiet_hours?.enabled ? '✅' : '❌' }) + '\n';
  text += ctx.t('settings.weekly_label', { value: s.weeklyReport ? '✅' : '❌' }) + '\n';
  text += ctx.t('settings.auto_shop_label', { value: s.autoShoppingList ? '✅' : '❌' }) + '\n';
  // #113 Notification style
  const notifStyle = s.notifications?.notification_style || 'brief';
  text += ctx.t('notif_style.title', { current: notifStyle === 'brief' ? ctx.t('notif_style.brief') : ctx.t('notif_style.detailed') }) + '\n';

  const keyboard = new InlineKeyboard()
    .text(ctx.t('settings.btn_timezone'), 'set:tz')
    .row()
    .text(ctx.t('settings.btn_notifications'), 'set:notif')
    .row()
    .text(ctx.t('settings.btn_thresholds'), 'set:thresh')
    .row()
    .text(ctx.t('settings.btn_periods'), 'set:periods')
    .row()
    .text(ctx.t('settings.btn_digest'), 'set:digest')
    .row()
    .text(ctx.t('settings.btn_quiet_hours'), 'settings:quiet_hours')
    .row()
    .text(ctx.t('settings.btn_weekly_report'), 'set:weekly_report')
    .row()
    .text(ctx.t('settings.btn_auto_shop'), 'set:auto_shop')
    .row()
    .text(`🔔 ${ctx.t('settings.notif_style_title')} ${notifStyle === 'brief' ? ctx.t('notif_style.brief') : ctx.t('notif_style.detailed')}`, 'set:notif_style')
    .row()
    .text(ctx.t('settings.btn_display'), 'set:display')
    .row()
    .text(ctx.t('settings.btn_profiles'), 'profiles')
    .row()
    .text(ctx.t('settings.btn_export'), 'export')
    .text(ctx.t('settings.btn_import'), 'import')
    .row()
    .text(ctx.t('common.back'), 'main_menu');

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
    keyboard.text(ctx.t('common.back'), 'settings');
    await ctx.editMessageText(ctx.t('settings.tz_prompt'), {
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^set:tz:(.+)$/, async (ctx) => {
    await updateUserTimezone(ctx.dbUser.id, ctx.match[1]);
    ctx.dbUser.timezone = ctx.match[1];
    await ctx.answerCallbackQuery(ctx.t('settings.tz_toast'));
    await showSettings(ctx);
  });

  // --- Notifications ---
  bot.callbackQuery('set:notif', async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
    const n = s.notifications || DEFAULT_SETTINGS.notifications;

    const keyboard = new InlineKeyboard()
      .text(`${n.intake_reminders ? '✅' : '❌'} ${ctx.t('settings.notif_intake')}`, 'set:notif:intake_reminders')
      .row()
      .text(`${n.expiry_alerts ? '✅' : '❌'} ${ctx.t('settings.notif_expiry_alerts')}`, 'set:notif:expiry_alerts')
      .row()
      .text(`${n.low_stock_alerts ? '✅' : '❌'} ${ctx.t('settings.notif_low_stock')}`, 'set:notif:low_stock_alerts')
      .row()
      .text(`${n.shared_medkit_changes ? '✅' : '❌'} ${ctx.t('settings.notif_shared')}`, 'set:notif:shared_medkit_changes')
      .row()
      .text(ctx.t('common.back'), 'settings');

    await ctx.editMessageText(ctx.t('settings.notif_title'), {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^set:notif:(\w+)$/, async (ctx) => {
    const key = ctx.match[1];
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.notifications = { ...(s.notifications || DEFAULT_SETTINGS.notifications) };
    s.notifications[key] = !s.notifications[key];
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(s.notifications[key] ? ctx.t('settings.notif_enabled_toast') : ctx.t('settings.notif_disabled_toast'));

    // Re-render notifications menu
    const n = s.notifications;
    const keyboard = new InlineKeyboard()
      .text(`${n.intake_reminders ? '✅' : '❌'} ${ctx.t('settings.notif_intake')}`, 'set:notif:intake_reminders')
      .row()
      .text(`${n.expiry_alerts ? '✅' : '❌'} ${ctx.t('settings.notif_expiry_alerts')}`, 'set:notif:expiry_alerts')
      .row()
      .text(`${n.low_stock_alerts ? '✅' : '❌'} ${ctx.t('settings.notif_low_stock')}`, 'set:notif:low_stock_alerts')
      .row()
      .text(`${n.shared_medkit_changes ? '✅' : '❌'} ${ctx.t('settings.notif_shared')}`, 'set:notif:shared_medkit_changes')
      .row()
      .text(ctx.t('common.back'), 'settings');

    await ctx.editMessageText(ctx.t('settings.notif_title'), {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  // --- Thresholds ---
  bot.callbackQuery('set:thresh', async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
    const t = s.thresholds || DEFAULT_SETTINGS.thresholds;

    const text = ctx.t('settings.thresh_title') +
      ctx.t('settings.thresh_expiry', { days: t.expiry_days }) + '\n' +
      ctx.t('settings.thresh_stock', { count: t.low_stock_count, percent: t.low_stock_percent });

    const keyboard = new InlineKeyboard()
      .text(ctx.t('settings.btn_thresh_expiry_14'), 'set:thresh:expiry:14')
      .text(ctx.t('settings.btn_thresh_expiry_30'), 'set:thresh:expiry:30')
      .text(ctx.t('settings.btn_thresh_expiry_60'), 'set:thresh:expiry:60')
      .row()
      .text(ctx.t('settings.btn_thresh_stock_3'), 'set:thresh:stock:3')
      .text(ctx.t('settings.btn_thresh_stock_5'), 'set:thresh:stock:5')
      .text(ctx.t('settings.btn_thresh_stock_10'), 'set:thresh:stock:10')
      .row()
      .text(ctx.t('common.back'), 'settings');

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  bot.callbackQuery(/^set:thresh:expiry:(\d+)$/, async (ctx) => {
    const days = parseInt(ctx.match[1]);
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.thresholds = { ...(s.thresholds || DEFAULT_SETTINGS.thresholds) };
    s.thresholds.expiry_days = days;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(ctx.t('settings.thresh_toast_expiry', { days }));
    // Re-render
    const t = s.thresholds;
    const text = ctx.t('settings.thresh_title') +
      ctx.t('settings.thresh_expiry', { days: t.expiry_days }) + '\n' +
      ctx.t('settings.thresh_stock', { count: t.low_stock_count, percent: t.low_stock_percent });
    const keyboard = new InlineKeyboard()
      .text(ctx.t('settings.btn_thresh_expiry_14'), 'set:thresh:expiry:14')
      .text(ctx.t('settings.btn_thresh_expiry_30'), 'set:thresh:expiry:30')
      .text(ctx.t('settings.btn_thresh_expiry_60'), 'set:thresh:expiry:60')
      .row()
      .text(ctx.t('settings.btn_thresh_stock_3'), 'set:thresh:stock:3')
      .text(ctx.t('settings.btn_thresh_stock_5'), 'set:thresh:stock:5')
      .text(ctx.t('settings.btn_thresh_stock_10'), 'set:thresh:stock:10')
      .row()
      .text(ctx.t('common.back'), 'settings');
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  bot.callbackQuery(/^set:thresh:stock:(\d+)$/, async (ctx) => {
    const count = parseInt(ctx.match[1]);
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.thresholds = { ...(s.thresholds || DEFAULT_SETTINGS.thresholds) };
    s.thresholds.low_stock_count = count;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(ctx.t('settings.thresh_toast_stock', { count }));
    const t = s.thresholds;
    const text = ctx.t('settings.thresh_title') +
      ctx.t('settings.thresh_expiry', { days: t.expiry_days }) + '\n' +
      ctx.t('settings.thresh_stock', { count: t.low_stock_count, percent: t.low_stock_percent });
    const keyboard = new InlineKeyboard()
      .text(ctx.t('settings.btn_thresh_expiry_14'), 'set:thresh:expiry:14')
      .text(ctx.t('settings.btn_thresh_expiry_30'), 'set:thresh:expiry:30')
      .text(ctx.t('settings.btn_thresh_expiry_60'), 'set:thresh:expiry:60')
      .row()
      .text(ctx.t('settings.btn_thresh_stock_3'), 'set:thresh:stock:3')
      .text(ctx.t('settings.btn_thresh_stock_5'), 'set:thresh:stock:5')
      .text(ctx.t('settings.btn_thresh_stock_10'), 'set:thresh:stock:10')
      .row()
      .text(ctx.t('common.back'), 'settings');
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
      morning: ctx.t('settings.btn_period_morning'),
      afternoon: ctx.t('settings.btn_period_afternoon'),
      evening: ctx.t('settings.btn_period_evening'),
      night: ctx.t('settings.btn_period_night'),
    };

    const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
    const dp = s.day_periods || DEFAULT_SETTINGS.day_periods;
    const currentValue = dp[period] || DEFAULT_SETTINGS.day_periods[period];

    // Set state for text input
    const msg = await ctx.editMessageText(
      ctx.t('settings.period_edit_prompt', { period: periodLabels[period], current: currentValue }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), 'set:periods'),
      }
    );

    await supabase.from('sessions').upsert({
      key: `state:${ctx.dbUser.id}`,
      value: {
        action: 'set_period',
        period,
        msgId: msg.message_id,
      },
    });
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
    await ctx.answerCallbackQuery(s.digest.enabled ? ctx.t('settings.digest_on_toast') : ctx.t('settings.digest_off_toast'));
    await showDigestMenu(ctx);
  });

  bot.callbackQuery('set:digest:time', async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
    const digestTime = s.digest?.time || DEFAULT_SETTINGS.digest.time;

    const msg = await ctx.editMessageText(
      ctx.t('settings.digest_time_prompt', { current: digestTime }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), 'set:digest'),
      }
    );

    await supabase.from('sessions').upsert({
      key: `state:${ctx.dbUser.id}`,
      value: {
        action: 'set_digest_time',
        msgId: msg.message_id,
      },
    });
  });

  // --- Display ---
  bot.callbackQuery('set:display', async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
    const d = s.display || DEFAULT_SETTINGS.display;

    const text = ctx.t('settings.display_title') +
      ctx.t('settings.display_sort', { value: d.default_sort }) + '\n' +
      ctx.t('settings.display_date', { value: d.date_format });

    const keyboard = new InlineKeyboard()
      .text(ctx.t('settings.btn_sort_name'), 'set:disp:sort:name')
      .text(ctx.t('settings.btn_sort_expiry'), 'set:disp:sort:expiry')
      .row()
      .text(ctx.t('settings.btn_sort_category'), 'set:disp:sort:category')
      .text(ctx.t('settings.btn_sort_quantity'), 'set:disp:sort:quantity')
      .row()
      .text(ctx.t('settings.btn_date_ddmmyyyy'), 'set:disp:date:DD.MM.YYYY')
      .text(ctx.t('settings.btn_date_yyyymmdd'), 'set:disp:date:YYYY-MM-DD')
      .row()
      .text(ctx.t('common.back'), 'settings');

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  bot.callbackQuery(/^set:disp:sort:(\w+)$/, async (ctx) => {
    const sort = ctx.match[1];
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.display = { ...(s.display || DEFAULT_SETTINGS.display) };
    s.display.default_sort = sort;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(ctx.t('settings.sort_toast', { value: sort }));
    const d = s.display;
    const text = ctx.t('settings.display_title') +
      ctx.t('settings.display_sort', { value: d.default_sort }) + '\n' +
      ctx.t('settings.display_date', { value: d.date_format });
    const keyboard = new InlineKeyboard()
      .text(ctx.t('settings.btn_sort_name'), 'set:disp:sort:name')
      .text(ctx.t('settings.btn_sort_expiry'), 'set:disp:sort:expiry')
      .row()
      .text(ctx.t('settings.btn_sort_category'), 'set:disp:sort:category')
      .text(ctx.t('settings.btn_sort_quantity'), 'set:disp:sort:quantity')
      .row()
      .text(ctx.t('settings.btn_date_ddmmyyyy'), 'set:disp:date:DD.MM.YYYY')
      .text(ctx.t('settings.btn_date_yyyymmdd'), 'set:disp:date:YYYY-MM-DD')
      .row()
      .text(ctx.t('common.back'), 'settings');
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  bot.callbackQuery(/^set:disp:date:(.+)$/, async (ctx) => {
    const fmt = ctx.match[1];
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.display = { ...(s.display || DEFAULT_SETTINGS.display) };
    s.display.date_format = fmt;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(ctx.t('settings.date_toast', { value: fmt }));
    const d = s.display;
    const text = ctx.t('settings.display_title') +
      ctx.t('settings.display_sort', { value: d.default_sort }) + '\n' +
      ctx.t('settings.display_date', { value: d.date_format });
    const keyboard = new InlineKeyboard()
      .text(ctx.t('settings.btn_sort_name'), 'set:disp:sort:name')
      .text(ctx.t('settings.btn_sort_expiry'), 'set:disp:sort:expiry')
      .row()
      .text(ctx.t('settings.btn_sort_category'), 'set:disp:sort:category')
      .text(ctx.t('settings.btn_sort_quantity'), 'set:disp:sort:quantity')
      .row()
      .text(ctx.t('settings.btn_date_ddmmyyyy'), 'set:disp:date:DD.MM.YYYY')
      .text(ctx.t('settings.btn_date_yyyymmdd'), 'set:disp:date:YYYY-MM-DD')
      .row()
      .text(ctx.t('common.back'), 'settings');
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  // --- Quiet Hours (#42) ---
  bot.callbackQuery('settings:quiet_hours', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showQuietHoursMenu(ctx);
  });

  bot.callbackQuery('set:quiet:toggle', async (ctx) => {
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.quiet_hours = { ...(s.quiet_hours || { enabled: false, from: '23:00', to: '07:00' }) };
    s.quiet_hours.enabled = !s.quiet_hours.enabled;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(s.quiet_hours.enabled ? ctx.t('settings.quiet_on_toast') : ctx.t('settings.quiet_off_toast'));
    await showQuietHoursMenu(ctx);
  });

  bot.callbackQuery('set:quiet:from', async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
    const qh = s.quiet_hours || { enabled: false, from: '23:00', to: '07:00' };

    const msg = await ctx.editMessageText(
      ctx.t('settings.quiet_from_prompt', { current: qh.from }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), 'settings:quiet_hours'),
      }
    );

    await supabase.from('sessions').upsert({
      key: `state:${ctx.dbUser.id}`,
      value: {
        action: 'set_quiet_from',
        msgId: msg.message_id,
      },
    });
  });

  bot.callbackQuery('set:quiet:to', async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
    const qh = s.quiet_hours || { enabled: false, from: '23:00', to: '07:00' };

    const msg = await ctx.editMessageText(
      ctx.t('settings.quiet_to_prompt', { current: qh.to }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), 'settings:quiet_hours'),
      }
    );

    await supabase.from('sessions').upsert({
      key: `state:${ctx.dbUser.id}`,
      value: {
        action: 'set_quiet_to',
        msgId: msg.message_id,
      },
    });
  });

  // --- Auto Shopping List (#28) ---
  bot.callbackQuery('set:auto_shop', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showAutoShopMenu(ctx);
  });

  bot.callbackQuery('set:auto_shop:toggle', async (ctx) => {
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.autoShoppingList = !s.autoShoppingList;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(s.autoShoppingList ? ctx.t('settings.auto_shop_on_toast') : ctx.t('settings.auto_shop_off_toast'));
    await showAutoShopMenu(ctx);
  });

  // --- Notification Style (#113) ---
  bot.callbackQuery('set:notif_style', async (ctx) => {
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.notifications = { ...(s.notifications || DEFAULT_SETTINGS.notifications) };
    const current = s.notifications.notification_style || 'brief';
    const newStyle = current === 'brief' ? 'detailed' : 'brief';
    s.notifications.notification_style = newStyle;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(ctx.t('notif_style.toast', { style: newStyle === 'brief' ? ctx.t('notif_style.brief') : ctx.t('notif_style.detailed') }));
    await showSettings(ctx);
  });

  // --- Weekly Report (#45) ---
  bot.callbackQuery('set:weekly_report', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showWeeklyReportMenu(ctx);
  });

  bot.callbackQuery('set:weekly:toggle', async (ctx) => {
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.weeklyReport = !s.weeklyReport;
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;
    await ctx.answerCallbackQuery(s.weeklyReport ? ctx.t('settings.weekly_on_toast') : ctx.t('settings.weekly_off_toast'));
    await showWeeklyReportMenu(ctx);
  });
}

// --- Helper: show day periods menu ---
async function showPeriodsMenu(ctx) {
  const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
  const dp = s.day_periods || DEFAULT_SETTINGS.day_periods;

  const text = ctx.t('settings.periods_title') +
    ctx.t('settings.period_morning', { time: dp.morning }) + '\n' +
    ctx.t('settings.period_afternoon', { time: dp.afternoon }) + '\n' +
    ctx.t('settings.period_evening', { time: dp.evening }) + '\n' +
    ctx.t('settings.period_night', { time: dp.night });

  const keyboard = new InlineKeyboard()
    .text(ctx.t('settings.btn_period_morning'), 'set:period:morning')
    .text(ctx.t('settings.btn_period_afternoon'), 'set:period:afternoon')
    .row()
    .text(ctx.t('settings.btn_period_evening'), 'set:period:evening')
    .text(ctx.t('settings.btn_period_night'), 'set:period:night')
    .row()
    .text(ctx.t('common.back'), 'settings');

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// --- Helper: show digest menu ---
async function showDigestMenu(ctx) {
  const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
  const dg = s.digest || DEFAULT_SETTINGS.digest;

  const digestTime = dg.time || '08:00';
  const text = ctx.t('settings.digest_title') +
    (dg.enabled ? ctx.t('settings.digest_status_on') : ctx.t('settings.digest_status_off')) + '\n' +
    ctx.t('settings.digest_time', { time: digestTime });

  const keyboard = new InlineKeyboard()
    .text(dg.enabled ? ctx.t('settings.btn_digest_off') : ctx.t('settings.btn_digest_on'), 'set:digest:toggle')
    .row()
    .text(ctx.t('settings.btn_digest_time', { time: digestTime }), 'set:digest:time')
    .row()
    .text(ctx.t('common.back'), 'settings');

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// --- Helper: show quiet hours menu ---
async function showQuietHoursMenu(ctx) {
  const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
  const qh = s.quiet_hours || { enabled: false, from: '23:00', to: '07:00' };

  const text = ctx.t('settings.quiet_title') +
    (qh.enabled ? ctx.t('settings.quiet_status_on') : ctx.t('settings.quiet_status_off')) + '\n' +
    ctx.t('settings.quiet_from', { time: qh.from }) + '\n' +
    ctx.t('settings.quiet_to', { time: qh.to });

  const keyboard = new InlineKeyboard()
    .text(qh.enabled ? ctx.t('settings.btn_quiet_off') : ctx.t('settings.btn_quiet_on'), 'set:quiet:toggle')
    .row()
    .text(ctx.t('settings.btn_quiet_from', { time: qh.from }), 'set:quiet:from')
    .row()
    .text(ctx.t('settings.btn_quiet_to', { time: qh.to }), 'set:quiet:to')
    .row()
    .text(ctx.t('common.back'), 'settings');

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// --- Helper: show auto shopping list menu ---
async function showAutoShopMenu(ctx) {
  const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
  const enabled = !!s.autoShoppingList;

  const text = ctx.t('settings.auto_shop_title') +
    (enabled ? ctx.t('settings.auto_shop_status_on') : ctx.t('settings.auto_shop_status_off'));

  const keyboard = new InlineKeyboard()
    .text(enabled ? ctx.t('settings.btn_auto_shop_off') : ctx.t('settings.btn_auto_shop_on'), 'set:auto_shop:toggle')
    .row()
    .text(ctx.t('common.back'), 'settings');

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// --- Helper: show weekly report menu ---
async function showWeeklyReportMenu(ctx) {
  const s = ctx.dbUser.settings || DEFAULT_SETTINGS;
  const enabled = !!s.weeklyReport;

  const text = ctx.t('settings.weekly_title') +
    (enabled ? ctx.t('settings.weekly_status_on') : ctx.t('settings.weekly_status_off'));

  const keyboard = new InlineKeyboard()
    .text(enabled ? ctx.t('settings.btn_weekly_off') : ctx.t('settings.btn_weekly_on'), 'set:weekly:toggle')
    .row()
    .text(ctx.t('common.back'), 'settings');

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
        ctx.t('settings.time_invalid'),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), 'set:periods'),
        }
      );
      return 'keep_state';
    }

    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      await ctx.api.editMessageText(ctx.chat.id, state.msgId,
        ctx.t('settings.time_invalid_range'),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), 'set:periods'),
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
      morning: ctx.t('settings.btn_period_morning'),
      afternoon: ctx.t('settings.btn_period_afternoon'),
      evening: ctx.t('settings.btn_period_evening'),
      night: ctx.t('settings.btn_period_night'),
    };

    // Show updated periods menu
    const dp = s.day_periods;
    const menuText = ctx.t('settings.periods_title') +
      ctx.t('settings.period_morning', { time: dp.morning }) + '\n' +
      ctx.t('settings.period_afternoon', { time: dp.afternoon }) + '\n' +
      ctx.t('settings.period_evening', { time: dp.evening }) + '\n' +
      ctx.t('settings.period_night', { time: dp.night }) + '\n\n' +
      ctx.t('settings.period_updated', { period: periodLabels[state.period], time: timeStr });

    const keyboard = new InlineKeyboard()
      .text(ctx.t('settings.btn_period_morning'), 'set:period:morning')
      .text(ctx.t('settings.btn_period_afternoon'), 'set:period:afternoon')
      .row()
      .text(ctx.t('settings.btn_period_evening'), 'set:period:evening')
      .text(ctx.t('settings.btn_period_night'), 'set:period:night')
      .row()
      .text(ctx.t('common.back'), 'settings');

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
        ctx.t('settings.time_invalid'),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), 'set:digest'),
        }
      );
      return 'keep_state';
    }

    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      await ctx.api.editMessageText(ctx.chat.id, state.msgId,
        ctx.t('settings.time_invalid_range'),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), 'set:digest'),
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
    const menuText = ctx.t('settings.digest_title') +
      (dg.enabled ? ctx.t('settings.digest_status_on') : ctx.t('settings.digest_status_off')) + '\n' +
      ctx.t('settings.digest_time', { time: dg.time }) + '\n\n' +
      ctx.t('settings.digest_time_updated', { time: timeStr });

    const keyboard = new InlineKeyboard()
      .text(dg.enabled ? ctx.t('settings.btn_digest_off') : ctx.t('settings.btn_digest_on'), 'set:digest:toggle')
      .row()
      .text(ctx.t('settings.btn_digest_time', { time: dg.time }), 'set:digest:time')
      .row()
      .text(ctx.t('common.back'), 'settings');

    await ctx.api.editMessageText(ctx.chat.id, state.msgId, menuText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    return 'handled';
  }

  if (state.action === 'set_quiet_from' || state.action === 'set_quiet_to') {
    const isFrom = state.action === 'set_quiet_from';
    const cancelCallback = 'settings:quiet_hours';

    const timeMatch = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      await ctx.api.editMessageText(ctx.chat.id, state.msgId,
        ctx.t('settings.time_invalid'),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), cancelCallback),
        }
      );
      return 'keep_state';
    }

    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      await ctx.api.editMessageText(ctx.chat.id, state.msgId,
        ctx.t('settings.time_invalid_range'),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), cancelCallback),
        }
      );
      return 'keep_state';
    }

    const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    const s = { ...(ctx.dbUser.settings || DEFAULT_SETTINGS) };
    s.quiet_hours = { ...(s.quiet_hours || { enabled: false, from: '23:00', to: '07:00' }) };
    if (isFrom) {
      s.quiet_hours.from = timeStr;
    } else {
      s.quiet_hours.to = timeStr;
    }
    await updateUserSettings(ctx.dbUser.id, s);
    ctx.dbUser.settings = s;

    const qh = s.quiet_hours;
    const menuText = ctx.t('settings.quiet_title') +
      (qh.enabled ? ctx.t('settings.quiet_status_on') : ctx.t('settings.quiet_status_off')) + '\n' +
      ctx.t('settings.quiet_from', { time: qh.from }) + '\n' +
      ctx.t('settings.quiet_to', { time: qh.to }) + '\n\n' +
      (isFrom ? ctx.t('settings.quiet_from_updated', { time: timeStr }) : ctx.t('settings.quiet_to_updated', { time: timeStr }));

    const keyboard = new InlineKeyboard()
      .text(qh.enabled ? ctx.t('settings.btn_quiet_off') : ctx.t('settings.btn_quiet_on'), 'set:quiet:toggle')
      .row()
      .text(ctx.t('settings.btn_quiet_from', { time: qh.from }), 'set:quiet:from')
      .row()
      .text(ctx.t('settings.btn_quiet_to', { time: qh.to }), 'set:quiet:to')
      .row()
      .text(ctx.t('common.back'), 'settings');

    await ctx.api.editMessageText(ctx.chat.id, state.msgId, menuText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    return 'handled';
  }

  return null;
}
