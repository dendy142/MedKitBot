import { InlineKeyboard } from 'grammy';
import { searchMedicines } from '../db/queries/medicines.js';
import { formatQuantity, medicineStatusEmoji, daysUntil } from '../utils/format.js';
import { CATEGORIES } from '../config.js';
import { supabase } from '../db/supabase.js';

/**
 * Callback: user pressed search
 */
export async function handleSearchCallback(ctx) {
  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard()
    .text(ctx.t('search.btn_by_category'), 'search:by_category')
    .row()
    .text(ctx.t('search.btn_by_expiry'), 'search:by_expiry')
    .row()
    .text(ctx.t('search.btn_by_status'), 'search:by_status')
    .row()
    .text(ctx.t('common.back'), 'main_menu');

  await ctx.editMessageText(
    ctx.t('search.prompt'),
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

/**
 * Get all user medicine IDs from medkit_members
 */
async function getUserMedkitIds(userId) {
  const { data: memberships } = await supabase
    .from('medkit_members')
    .select('medkit_id')
    .eq('user_id', userId);
  if (!memberships || memberships.length === 0) return [];
  return memberships.map((m) => m.medkit_id);
}

/**
 * Format search results grouped by medkit
 */
function formatResults(ctx, results, keyboard) {
  const grouped = {};
  for (const med of results) {
    const medkitName = med.medkits?.name || ctx.t('common.not_found');
    if (!grouped[medkitName]) grouped[medkitName] = [];
    grouped[medkitName].push(med);
  }

  let text = '';
  for (const [medkitName, meds] of Object.entries(grouped)) {
    text += ctx.t('search.medkit_header', { name: medkitName });
    for (const med of meds) {
      const emoji = medicineStatusEmoji(med);
      const qty = formatQuantity(med.quantity, med.quantity_unit);
      text += `${emoji} ${med.name}${med.dosage ? ' ' + med.dosage : ''} — ${qty}\n`;
      keyboard.text(`${med.name}`, `med:${med.id}`).row();
    }
    text += '\n';
  }
  return text;
}

/**
 * Fallback handler: user typed text => try to search
 */
export async function handleSearch(ctx) {
  const query = ctx.message.text.trim();
  if (!query || query.startsWith('/')) return;

  const results = await searchMedicines(ctx.dbUser.id, query);

  if (results.length === 0) {
    const keyboard = new InlineKeyboard()
      .text(ctx.t('menu.btn_medkits'), 'medkits')
      .text(ctx.t('search.btn_search_again'), 'search')
      .row()
      .text(ctx.t('common.main_menu'), 'main_menu');

    await ctx.reply(
      ctx.t('search.no_results', { query }),
      { reply_markup: keyboard }
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  let text = ctx.t('search.results_title', { query });
  text += formatResults(ctx, results, keyboard);

  keyboard.text(ctx.t('search.btn_search_again'), 'search').row();
  keyboard.text(ctx.t('common.main_menu'), 'main_menu');

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Register extended search handlers
 */
export function registerSearchHandlers(bot) {
  // #109 Search by category
  bot.callbackQuery('search:by_category', async (ctx) => {
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard();
    for (const cat of CATEGORIES) {
      keyboard.text(cat, `search:cat:${cat}`).row();
    }
    keyboard.text(ctx.t('common.back'), 'search');

    await ctx.editMessageText(ctx.t('search_category.title'), {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^search:cat:(.+)$/, async (ctx) => {
    const category = ctx.match[1];
    await ctx.answerCallbackQuery();

    const medkitIds = await getUserMedkitIds(ctx.dbUser.id);
    if (medkitIds.length === 0) {
      await ctx.editMessageText(ctx.t('search_category.empty', { category }), {
        reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'search:by_category'),
      });
      return;
    }

    const { data: results } = await supabase
      .from('medicines')
      .select('*, medkits(name)')
      .in('medkit_id', medkitIds)
      .eq('is_archived', false)
      .eq('category', category);

    if (!results || results.length === 0) {
      await ctx.editMessageText(ctx.t('search_category.empty', { category }), {
        reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'search:by_category'),
      });
      return;
    }

    const keyboard = new InlineKeyboard();
    let text = ctx.t('search_category.results', { category });
    text += formatResults(ctx, results, keyboard);
    keyboard.text(ctx.t('common.back'), 'search:by_category');

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  // #110 Search by expiry
  bot.callbackQuery('search:by_expiry', async (ctx) => {
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard()
      .text(ctx.t('search_expiry.btn_this_month'), 'search:expiry:this')
      .row()
      .text(ctx.t('search_expiry.btn_next_month'), 'search:expiry:next')
      .row()
      .text(ctx.t('common.back'), 'search');

    await ctx.editMessageText(ctx.t('search_expiry.title'), {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^search:expiry:(this|next)$/, async (ctx) => {
    const period = ctx.match[1];
    await ctx.answerCallbackQuery();

    const now = new Date();
    let startDate, endDate, periodLabel;

    if (period === 'this') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      periodLabel = ctx.t('search_expiry.btn_this_month');
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      periodLabel = ctx.t('search_expiry.btn_next_month');
    }

    const medkitIds = await getUserMedkitIds(ctx.dbUser.id);
    if (medkitIds.length === 0) {
      await ctx.editMessageText(ctx.t('search_expiry.empty'), {
        reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'search:by_expiry'),
      });
      return;
    }

    const { data: results } = await supabase
      .from('medicines')
      .select('*, medkits(name)')
      .in('medkit_id', medkitIds)
      .eq('is_archived', false)
      .gte('expiry_date', startDate.toISOString().split('T')[0])
      .lte('expiry_date', endDate.toISOString().split('T')[0])
      .order('expiry_date', { ascending: true });

    if (!results || results.length === 0) {
      await ctx.editMessageText(ctx.t('search_expiry.empty'), {
        reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'search:by_expiry'),
      });
      return;
    }

    const keyboard = new InlineKeyboard();
    let text = ctx.t('search_expiry.results', { period: periodLabel });
    text += formatResults(ctx, results, keyboard);
    keyboard.text(ctx.t('common.back'), 'search:by_expiry');

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  // #111 Search by status
  bot.callbackQuery('search:by_status', async (ctx) => {
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard()
      .text(ctx.t('search.status_expired'), 'search:status:expired')
      .row()
      .text(ctx.t('search.status_expiring'), 'search:status:expiring')
      .row()
      .text(ctx.t('search.status_low'), 'search:status:low')
      .row()
      .text(ctx.t('search.status_favorite'), 'search:status:favorite')
      .row()
      .text(ctx.t('search.status_archived'), 'search:status:archived')
      .row()
      .text(ctx.t('common.back'), 'search');

    await ctx.editMessageText(ctx.t('search_status.title'), {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery(/^search:status:(\w+)$/, async (ctx) => {
    const status = ctx.match[1];
    await ctx.answerCallbackQuery();

    const medkitIds = await getUserMedkitIds(ctx.dbUser.id);
    if (medkitIds.length === 0) {
      await ctx.editMessageText(ctx.t('search_status.empty'), {
        reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'search:by_status'),
      });
      return;
    }

    let query = supabase
      .from('medicines')
      .select('*, medkits(name)')
      .in('medkit_id', medkitIds);

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const statusLabels = {
      expired: ctx.t('search.status_expired'),
      expiring: ctx.t('search.status_expiring'),
      low: ctx.t('search.status_low'),
      favorite: ctx.t('search.status_favorite'),
      archived: ctx.t('search.status_archived'),
    };

    switch (status) {
      case 'expired':
        query = query.eq('is_archived', false).lt('expiry_date', todayStr).not('expiry_date', 'is', null);
        break;
      case 'expiring': {
        const thirtyDays = new Date(now);
        thirtyDays.setDate(thirtyDays.getDate() + 30);
        query = query.eq('is_archived', false).gte('expiry_date', todayStr).lte('expiry_date', thirtyDays.toISOString().split('T')[0]);
        break;
      }
      case 'low':
        query = query.eq('is_archived', false).lte('quantity', 5);
        break;
      case 'favorite':
        query = query.eq('is_archived', false).eq('is_favorite', true);
        break;
      case 'archived':
        query = query.eq('is_archived', true);
        break;
    }

    const { data: results } = await query;

    if (!results || results.length === 0) {
      await ctx.editMessageText(ctx.t('search_status.empty'), {
        reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'search:by_status'),
      });
      return;
    }

    const keyboard = new InlineKeyboard();
    let text = ctx.t('search_status.results', { status: statusLabels[status] || status });
    text += formatResults(ctx, results, keyboard);
    keyboard.text(ctx.t('common.back'), 'search:by_status');

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });
}
