import { InlineKeyboard } from 'grammy';
import { getUserMedkits } from '../db/queries/medkits.js';
import { countShoppingItems } from '../db/queries/shoppingList.js';
import { getTodayIntakeLogs } from '../db/queries/intakeLogs.js';
import { formatProgressBar, formatQuantity, daysUntil, getDaysWord } from '../utils/format.js';
import { supabase } from '../db/supabase.js';

/**
 * Build dashboard text and dynamic keyboard for main menu
 * P1.3: Interactive dashboard with quick action buttons
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

    // Fetch expiring medicines with IDs (up to 4 for display)
    const { data: expMeds } = await supabase
      .from('medicines')
      .select('id, name, expiry_date, quantity_unit')
      .in('medkit_id', medkitIds)
      .eq('is_archived', false)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', thresholdDate.toISOString().split('T')[0])
      .order('expiry_date', { ascending: true })
      .limit(4);
    expiringMeds = expMeds || [];

    // Fetch low-stock medicines with IDs (up to 4 for display)
    const { data: lowMeds } = await supabase
      .from('medicines')
      .select('id, name, quantity, quantity_unit')
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
  const pendingIntakes = intakeLogs.filter(l => l.status === 'pending' || l.status === 'snoozed').length;

  let text = `🏠 *Меню*\n\n`;

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
        text += `  • ${med.name} — ❌ просрочено\n`;
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
    text += `\n✨ Всё в порядке — ваши аптечки под контролем!`;
  }

  // P3.2: Always show search hint
  text += `\n\n💡 _Напишите название для поиска_`;

  // P1.3: Build dynamic keyboard with quick actions
  const keyboard = new InlineKeyboard();

  // Row 0: Quick intake action if pending
  if (pendingIntakes > 0) {
    keyboard.text(`💊 Отметить приём (${pendingIntakes})`, 'intake_today').row();
  }

  // Quick-action buttons for expiring meds (up to 3)
  if (expiringMeds.length > 0) {
    const displayCount = Math.min(expiringMeds.length, 3);
    for (let i = 0; i < displayCount; i++) {
      const name = expiringMeds[i].name.length > 20 ? expiringMeds[i].name.slice(0, 18) + '…' : expiringMeds[i].name;
      keyboard.text(`⚠️ ${name}`, `med:${expiringMeds[i].id}`);
      if ((i + 1) % 2 === 0 || i === displayCount - 1) keyboard.row();
    }
  }

  // Quick-action buttons for low-stock meds (up to 3)
  if (lowStockMeds.length > 0) {
    const displayCount = Math.min(lowStockMeds.length, 3);
    for (let i = 0; i < displayCount; i++) {
      const name = lowStockMeds[i].name.length > 20 ? lowStockMeds[i].name.slice(0, 18) + '…' : lowStockMeds[i].name;
      keyboard.text(`📉 ${name}`, `med:${lowStockMeds[i].id}`);
      if ((i + 1) % 2 === 0 || i === displayCount - 1) keyboard.row();
    }
  }

  // P3.1: Single medkit shortcut
  // Standard menu buttons
  keyboard.text('📦 Аптечки', medkitCount === 1 ? `medkit:${medkits[0].id}` : 'medkits');
  keyboard.text('💊 Приём', 'intake_today');
  keyboard.row();
  keyboard.text('🛒 Покупки', 'shopping');
  keyboard.text('🔍 Поиск', 'search');
  keyboard.row();
  keyboard.text('📊 Статистика', 'stats');
  keyboard.text('⚙️ Настройки', 'settings');
  keyboard.row();
  keyboard.text('📖 Помощь', 'help');

  return { text, keyboard };
}

/**
 * Send main menu (new message)
 */
export async function handleMainMenu(ctx) {
  const { text, keyboard } = await buildDashboard(ctx.dbUser.id, ctx.dbUser.settings);
  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Show main menu via callback query (edit message)
 */
export async function handleMainMenuCallback(ctx) {
  await ctx.answerCallbackQuery();
  const { text, keyboard } = await buildDashboard(ctx.dbUser.id, ctx.dbUser.settings);
  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}
