import { mainMenuKeyboard } from '../keyboards/mainMenu.js';
import { getUserMedkits } from '../db/queries/medkits.js';
import { countShoppingItems } from '../db/queries/shoppingList.js';
import { getTodayIntakeLogs } from '../db/queries/intakeLogs.js';
import { formatProgressBar, formatQuantity, daysUntil } from '../utils/format.js';
import { supabase } from '../db/supabase.js';

/**
 * Proper Russian declension for "день"
 */
function getDaysWord(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 19) return 'дней';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дня';
  return 'дней';
}

/**
 * Build dashboard text for main menu
 */
async function buildDashboard(userId, settings) {
  const medkits = await getUserMedkits(userId);
  const medkitCount = medkits.length;
  const shopCount = await countShoppingItems(userId);

  const thresholds = settings?.thresholds || { expiry_days: 30, low_stock_count: 5 };
  let expiringMeds = [];
  let lowStockMeds = [];

  if (medkitCount > 0) {
    const medkitIds = medkits.map(m => m.id);
    const now = new Date();
    const thresholdDate = new Date(now.getTime() + thresholds.expiry_days * 86400000);

    // Fetch expiring medicines with names (up to 4 for display)
    const { data: expMeds } = await supabase
      .from('medicines')
      .select('name, expiry_date, quantity_unit')
      .in('medkit_id', medkitIds)
      .eq('is_archived', false)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', thresholdDate.toISOString().split('T')[0])
      .order('expiry_date', { ascending: true })
      .limit(4);
    expiringMeds = expMeds || [];

    // Fetch low-stock medicines with names (up to 4 for display)
    const { data: lowMeds } = await supabase
      .from('medicines')
      .select('name, quantity, quantity_unit')
      .in('medkit_id', medkitIds)
      .eq('is_archived', false)
      .lte('quantity', thresholds.low_stock_count)
      .gt('quantity', 0)
      .order('quantity', { ascending: true })
      .limit(4);
    lowStockMeds = lowMeds || [];
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
    const bar = formatProgressBar(doneIntakes, totalIntakes);
    if (doneIntakes < totalIntakes) {
      text += `💊 Приём: ${bar} ${doneIntakes}/${totalIntakes}\n`;
    } else {
      text += `💊 Приём: всё выполнено ✅ (${totalIntakes})\n`;
    }
  }

  // Show expiring medicines with names
  if (expiringMeds.length > 0) {
    text += `\n⚠️ *Истекает скоро:*\n`;
    const displayCount = Math.min(expiringMeds.length, 3);
    for (let i = 0; i < displayCount; i++) {
      const med = expiringMeds[i];
      const days = daysUntil(med.expiry_date);
      if (days <= 0) {
        text += `  • ${med.name} — ПРОСРОЧЕНО\n`;
      } else {
        text += `  • ${med.name} (через ${days} ${getDaysWord(days)})\n`;
      }
    }
    if (expiringMeds.length > 3) {
      text += `  _и ещё ${expiringMeds.length - 3}..._\n`;
    }
  }

  // Show low-stock medicines with names
  if (lowStockMeds.length > 0) {
    text += `\n📉 *Заканчивается:*\n`;
    const displayCount = Math.min(lowStockMeds.length, 3);
    for (let i = 0; i < displayCount; i++) {
      const med = lowStockMeds[i];
      text += `  • ${med.name} — ${formatQuantity(med.quantity, med.quantity_unit)}\n`;
    }
    if (lowStockMeds.length > 3) {
      text += `  _и ещё ${lowStockMeds.length - 3}..._\n`;
    }
  }

  if (shopCount > 0) text += `\n🛒 В списке покупок: ${shopCount}\n`;

  const hasIssues = expiringMeds.length > 0 || lowStockMeds.length > 0 || totalIntakes > 0 || shopCount > 0;
  if (medkitCount > 0 && !hasIssues) {
    text += `\n✨ Всё в порядке!`;
  }

  text += `\n💡 _Напишите название лекарства для быстрого поиска_`;

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
