import { Bot } from 'grammy';
import { BOT_TOKEN } from './config.js';
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

export function createBot() {
  const bot = new Bot(BOT_TOKEN);

  // Auth middleware — ensures user in DB, attaches ctx.dbUser
  bot.use(authMiddleware());

  // Commands
  bot.command('start', handleStart);
  bot.command('help', handleHelp);
  bot.command('cancel', async (ctx) => {
    await handleMainMenu(ctx);
  });

  // Callback: main menu
  bot.callbackQuery('main_menu', handleMainMenuCallback);

  // Callback: noop (for pagination info display)
  bot.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());

  // Help callback
  bot.callbackQuery('help', handleHelpCallback);

  // Intake placeholder
  bot.callbackQuery('intake_today', async (ctx) => {
    await ctx.answerCallbackQuery('Скоро! Функция в разработке.');
  });

  // Onboarding callbacks (timezone selection, etc.)
  registerOnboardingHandlers(bot);

  // Add medicine callbacks
  bot.callbackQuery(/^addmed:/, async (ctx) => {
    const action = ctx.callbackQuery.data;
    const handled = await handleAddMedicineCallback(ctx, action);
    if (!handled) await ctx.answerCallbackQuery();
  });

  // Register handler groups
  registerMedkitHandlers(bot);
  registerMedicineHandlers(bot);
  registerSettingsHandlers(bot);
  registerShoppingHandlers(bot);

  // Search
  bot.callbackQuery('search', handleSearchCallback);

  // Photo handler (for add medicine)
  bot.on('message:photo', async (ctx) => {
    await handleAddMedicinePhoto(ctx);
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

  // Error handler
  bot.catch((err) => {
    console.error('Bot error:', err);
  });

  return bot;
}
