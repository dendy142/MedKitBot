import { Bot, InlineKeyboard } from 'grammy';
import { BOT_TOKEN, CATEGORY_KEYWORDS } from './config.js';
import { authMiddleware } from './middleware/auth.js';
import { handleStart } from './handlers/start.js';
import { handleMainMenu, handleMainMenuCallback } from './handlers/menu.js';
import { registerOnboardingHandlers } from './handlers/onboarding.js';
import { registerMedkitHandlers } from './handlers/medkits.js';
import { registerMedicineHandlers } from './handlers/medicines.js';
import { registerSettingsHandlers } from './handlers/settings.js';
import { registerShoppingHandlers } from './handlers/shopping.js';
import { handleHelp, handleHelpCallback } from './handlers/help.js';
import { handleSearch, handleSearchCallback } from './handlers/search.js';
import { handleAddMedicineText, handleAddMedicinePhoto, handleAddMedicineCallback } from './handlers/addMedicine.js';
import { handleTextState } from './handlers/textState.js';
import { registerIntakeHandlers } from './handlers/intake.js';
import { registerScheduleHandlers } from './handlers/schedules.js';
import { registerSharingHandlers } from './handlers/sharing.js';
import { registerExportHandlers } from './handlers/export.js';
import { registerImportHandlers, handleImportDocument, handlePhotoImportOffer } from './handlers/import.js';
import { registerStatsHandlers } from './handlers/stats.js';
import { registerCourseHandlers } from './handlers/courses.js';
import { registerSearchHandlers } from './handlers/search.js';
import { registerAchievementHandlers, checkAchievements } from './handlers/achievements.js';
import { registerProfileHandlers } from './handlers/profiles.js';
import { clearUserSessions } from './utils/sessions.js';
import { log } from './utils/logger.js';
import { createMedicine } from './db/queries/medicines.js';
import { getUserMedkits } from './db/queries/medkits.js';
import { logAction } from './middleware/logging.js';
import { supabase } from './db/supabase.js';

/**
 * Auto-detect category from medicine name
 */
function detectCategory(name) {
  const lower = name.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return category;
  }
  return 'Прочее';
}

export function createBot() {
  const bot = new Bot(BOT_TOKEN);

  // Auth middleware — ensures user in DB, attaches ctx.dbUser
  bot.use(authMiddleware());

  // #95 Set bot commands on startup
  bot.api.setMyCommands([
    { command: 'start', description: 'Главное меню' },
    { command: 'menu', description: 'Мои аптечки' },
    { command: 'today', description: 'Приёмы сегодня' },
    { command: 'quick', description: 'Быстрое добавление' },
    { command: 'search', description: 'Поиск лекарства' },
    { command: 'help', description: 'Помощь' },
    { command: 'settings', description: 'Настройки' },
  ]).catch(e => console.error('Failed to set bot commands:', e));

  // #77 Commands clear active sessions before handling
  bot.command('start', async (ctx) => {
    await clearUserSessions(ctx.dbUser?.id);
    await handleStart(ctx);
  });
  bot.command('help', async (ctx) => {
    await clearUserSessions(ctx.dbUser?.id);
    await handleHelp(ctx);
  });
  bot.command('cancel', async (ctx) => {
    await clearUserSessions(ctx.dbUser?.id);
    await handleMainMenu(ctx);
  });

  // #95 /menu command
  bot.command('menu', async (ctx) => {
    await clearUserSessions(ctx.dbUser?.id);
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await handleMainMenu(ctx);
  });

  // #96 /today command — direct access to today's intakes
  bot.command('today', async (ctx) => {
    await clearUserSessions(ctx.dbUser?.id);
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    const msg = await ctx.reply(ctx.t('common.loading'), {
      reply_markup: new InlineKeyboard().text(ctx.t('menu.btn_intake_today'), 'intake_today'),
    });
  });

  // #94 /quick command — fast medicine addition
  bot.command('quick', async (ctx) => {
    await clearUserSessions(ctx.dbUser?.id);
    try { await ctx.deleteMessage(); } catch { /* ignore */ }

    const input = ctx.match?.trim();

    // Get user's first medkit
    const medkits = await getUserMedkits(ctx.dbUser.id);
    if (medkits.length === 0) {
      await ctx.reply(ctx.t('quick.no_medkit'));
      return;
    }
    const medkitId = medkits[0].id;

    if (!input) {
      await ctx.reply(ctx.t('quick.usage'), { parse_mode: 'Markdown' });
      return;
    }

    // Parse: Name [Dosage] [Quantity]
    let name = '';
    let dosage = '';
    let quantity = 0;

    const parts = input.split(/\s+/);
    const nameParts = [];
    let foundNum = false;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const numMatch = part.match(/^(\d+(?:[.,]\d+)?)\s*(мг|г|мл|мкг|МЕ|шт)?$/);
      if (numMatch && !foundNum) {
        if (numMatch[2] && numMatch[2] !== 'шт') {
          dosage = part;
          foundNum = true;
        } else {
          quantity = parseFloat(numMatch[1].replace(',', '.'));
          foundNum = true;
        }
      } else if (numMatch && foundNum) {
        quantity = parseFloat(numMatch[1].replace(',', '.'));
      } else {
        nameParts.push(part);
      }
    }

    name = nameParts.join(' ').trim();
    if (!name) {
      name = input;
      dosage = '';
      quantity = 0;
    }

    const category = detectCategory(name);

    const medicine = await createMedicine({
      medkitId,
      name,
      dosage: dosage || null,
      category,
      quantity: quantity || 0,
      quantityUnit: 'шт',
    });

    await logAction(ctx.dbUser.id, 'create', 'medicine', medicine.id, { name });
    await checkAchievements(ctx, 'medicine_added');

    const details = [];
    if (dosage) details.push(ctx.t('quick.detail_dosage', { value: dosage }));
    if (quantity) details.push(ctx.t('quick.detail_quantity', { value: quantity }));
    if (category) details.push(ctx.t('quick.detail_category', { value: category }));

    await ctx.reply(
      ctx.t('quick.added', { name, details: details.join('\n') }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('quick.btn_open'), `med:${medicine.id}`)
          .text(ctx.t('quick.btn_edit'), `med:${medicine.id}:edit`)
          .row()
          .text(ctx.t('common.main_menu'), 'main_menu'),
      }
    );
  });

  // #95 /search command
  bot.command('search', async (ctx) => {
    await clearUserSessions(ctx.dbUser?.id);
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await ctx.reply(ctx.t('search.prompt'), {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text(ctx.t('common.back'), 'main_menu'),
    });
  });

  // #95 /settings command
  bot.command('settings', async (ctx) => {
    await clearUserSessions(ctx.dbUser?.id);
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await ctx.reply(ctx.t('common.loading'), {
      reply_markup: new InlineKeyboard().text(ctx.t('menu.btn_settings'), 'settings'),
    });
  });

  // Also clear sessions when going to main menu via callback
  bot.callbackQuery('main_menu', async (ctx) => {
    await clearUserSessions(ctx.dbUser?.id);
    await handleMainMenuCallback(ctx);
  });

  // Callback: noop (for pagination info display)
  bot.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());

  // Help callback
  bot.callbackQuery('help', handleHelpCallback);

  // Intake and schedule handlers
  registerIntakeHandlers(bot);
  registerScheduleHandlers(bot);

  // Onboarding callbacks (timezone selection, etc.)
  registerOnboardingHandlers(bot);

  // Quick start quantity skip callback (#82)
  bot.callbackQuery(/^quickstart_qty_skip:([0-9a-f-]+)$/, async (ctx) => {
    const medkitId = ctx.match[1];
    await ctx.answerCallbackQuery();
    const { data: session } = await supabase
      .from('sessions')
      .select('value')
      .eq('key', `state:${ctx.dbUser.id}`)
      .single();
    if (session?.value?.action === 'quick_start_qty') {
      const state = session.value;
      const medicine = await createMedicine({
        medkitId: state.medkitId,
        name: state.name,
        category: state.category,
        quantity: 0,
        quantityUnit: 'шт',
      });
      await logAction(ctx.dbUser.id, 'create', 'medicine', medicine.id, { name: state.name });
      await supabase.from('sessions').delete().eq('key', `state:${ctx.dbUser.id}`);
      await checkAchievements(ctx, 'medicine_added');
      await ctx.editMessageText(
        ctx.t('quick_start.success', { name: state.name }),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(ctx.t('addmed.btn_open'), `med:${medicine.id}`)
            .text(ctx.t('common.main_menu'), 'main_menu'),
        }
      );
    }
  });

  // Profile handlers (Wave 3: Family Profiles) — before addmed: since that regex is broad
  registerProfileHandlers(bot);

  // Add medicine callbacks
  bot.callbackQuery(/^addmed:/, async (ctx) => {
    const action = ctx.callbackQuery.data;
    const handled = await handleAddMedicineCallback(ctx, action);
    if (!handled) await ctx.answerCallbackQuery();
  });

  // Achievement handlers (#90)
  registerAchievementHandlers(bot);

  // Register handler groups
  registerSharingHandlers(bot);
  registerMedkitHandlers(bot);
  registerMedicineHandlers(bot);
  registerSettingsHandlers(bot);
  registerExportHandlers(bot);
  registerImportHandlers(bot);
  registerShoppingHandlers(bot);
  registerStatsHandlers(bot);
  registerCourseHandlers(bot);

  // Search
  bot.callbackQuery('search', handleSearchCallback);
  registerSearchHandlers(bot);

  // Document handler (for CSV import)
  bot.on('message:document', async (ctx) => {
    const handled = await handleImportDocument(ctx);
    if (!handled) await ctx.answerCallbackQuery?.();
  });

  // Photo handler (for add medicine, then #98 photo import offer)
  bot.on('message:photo', async (ctx) => {
    const handled = await handleAddMedicinePhoto(ctx);
    if (!handled) {
      await handlePhotoImportOffer(ctx);
    }
  });

  // Text handler: check active states, then fallback to search
  bot.on('message:text', async (ctx) => {
    // Check add-medicine flow first
    const addMedHandled = await handleAddMedicineText(ctx);
    if (addMedHandled) return;
    // Check other text states (create medkit, rename, restock, edit)
    const stateHandled = await handleTextState(ctx);
    if (stateHandled) return;
    // Fallback: search
    await handleSearch(ctx);
  });

  // #64 Improved error handler with structured logging & friendly user message
  // #68 Telegram rate limit handling with actual sleep+retry
  bot.catch(async (err) => {
    const errObj = err.error ?? err;
    const userId = err.ctx?.from?.id;

    // #68 Detect Telegram 429 rate limit — sleep and retry the friendly message
    if (errObj?.error_code === 429) {
      const retryAfter = errObj?.parameters?.retry_after ?? errObj?.retry_after ?? 5;
      log('warn', {
        action: 'telegram_rate_limit',
        userId,
        retryAfter,
        error: errObj.description || errObj.message,
      });
      // Sleep for the required duration then retry sending the friendly message
      await new Promise((r) => setTimeout(r, (typeof retryAfter === 'number' ? retryAfter : 5) * 1000));
      err.ctx?.reply(err.ctx?.t?.('common.error_generic_msg') || '\u26a0\ufe0f Error').catch(() => {});
    } else {
      // #64 Structured error log
      log('error', {
        action: 'bot_error',
        userId,
        error: errObj?.message || String(errObj),
        stack: errObj?.stack,
      });
      // #64 Send friendly message to user, never raw errors
      err.ctx?.reply(err.ctx?.t?.('common.error_generic_msg') || '\u26a0\ufe0f Error').catch(() => {});
    }
  });

  return bot;
}
