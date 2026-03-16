import { mainMenuKeyboard } from '../keyboards/mainMenu.js';
import { getUserMedkits } from '../db/queries/medkits.js';
import { countShoppingItems } from '../db/queries/shoppingList.js';
import { getTodayIntakeLogs } from '../db/queries/intakeLogs.js';
import { supabase } from '../db/supabase.js';

/**
 * Build dashboard text for main menu
 */
async function buildDashboard(userId, settings) {
  const medkits = await getUserMedkits(userId);
  const medkitCount = medkits.length;
  const shopCount = await countShoppingItems(userId);

  // Count expiring and low-stock medicines
  const thresholds = settings?.thresholds || { expiry_days: 30, low_stock_count: 5 };
  let expiringCount = 0;
  let lowStockCount = 0;

  if (medkitCount > 0) {
    const medkitIds = medkits.map(m => m.id);
    const now = new Date();
    const thresholdDate = new Date(now.getTime() + thresholds.expiry_days * 86400000);

    const { count: expCount } = await supabase
      .from('medicines')
      .select('*', { count: 'exact', head: true })
      .in('medkit_id', medkitIds)
      .eq('is_archived', false)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', thresholdDate.toISOString().split('T')[0]);
    expiringCount = expCount || 0;

    const { count: lowCount } = await supabase
      .from('medicines')
      .select('*', { count: 'exact', head: true })
      .in('medkit_id', medkitIds)
      .eq('is_archived', false)
      .lte('quantity', thresholds.low_stock_count)
      .gt('quantity', 0);
    lowStockCount = lowCount || 0;
  }

  // Intake stats for today
  const intakeLogs = await getTodayIntakeLogs(userId, settings?.timezone || 'Europe/Moscow');
  const totalIntakes = intakeLogs.length;
  const doneIntakes = intakeLogs.filter(l => l.status === 'taken').length;

  let text = `🏠 *Главное меню*\n\n`;

  if (medkitCount === 0) {
    text += `📦 У вас пока нет аптечек — создайте первую!\n`;
  } else {
    text += `📦 Аптечек: ${medkitCount}\n`;
  }

  if (totalIntakes > 0) {
    const pending = totalIntakes - doneIntakes;
    if (pending > 0) {
      text += `💊 Приём: ${doneIntakes}/${totalIntakes} выполнено, *${pending} ожидает*\n`;
    } else {
      text += `💊 Приём: всё выполнено ✅ (${totalIntakes})\n`;
    }
  }

  if (expiringCount > 0) text += `⚠️ Истекает скоро: ${expiringCount}\n`;
  if (lowStockCount > 0) text += `📉 Заканчивается: ${lowStockCount}\n`;
  if (shopCount > 0) text += `🛒 В списке покупок: ${shopCount}\n`;

  if (medkitCount > 0 && expiringCount === 0 && lowStockCount === 0 && totalIntakes === 0 && shopCount === 0) {
    text += `\n✨ Всё в порядке!`;
  }

  return text;
}

/**
 * Send main menu (new message)
 */
export async function handleMainMenu(ctx) {
  const text = await buildDashboard(ctx.dbUser.id, ctx.dbUser.settings);
  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: mainMenuKeyboard(),
  });
}

/**
 * Show main menu via callback query (edit message)
 */
export async function handleMainMenuCallback(ctx) {
  await ctx.answerCallbackQuery();
  const text = await buildDashboard(ctx.dbUser.id, ctx.dbUser.settings);
  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: mainMenuKeyboard(),
  });
}
