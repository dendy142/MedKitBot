import { InlineKeyboard } from 'grammy';
import { getShoppingList, addToShoppingList, markAsBought, removeFromShoppingList } from '../db/queries/shoppingList.js';
import { getMedicine, updateMedicine } from '../db/queries/medicines.js';
import { supabase } from '../db/supabase.js';
import { paginateItems, addPagination } from '../keyboards/pagination.js';

/**
 * Show shopping list
 */
async function showShoppingList(ctx, page = 0) {
  const items = await getShoppingList(ctx.dbUser.id);

  if (items.length === 0) {
    const keyboard = new InlineKeyboard()
      .text('➕ Добавить', 'shop:add')
      .row()
      .text('◀️ Назад', 'main_menu');

    const text = '🛒 *Список покупок*\n\nСписок пуст.';
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
    return;
  }

  const pageItems = paginateItems(items, page);
  let text = `🛒 *Список покупок* (${items.length})\n\n`;

  // P3.3: Group display by medkit
  const grouped = {};
  for (const item of pageItems) {
    const mkName = item.medkits?.name || 'Другое';
    if (!grouped[mkName]) grouped[mkName] = [];
    grouped[mkName].push(item);
  }
  const groupKeys = Object.keys(grouped);
  const hasGroups = groupKeys.length > 1 || (groupKeys.length === 1 && groupKeys[0] !== 'Другое');
  for (const [mkName, gItems] of Object.entries(grouped)) {
    if (hasGroups) text += `📦 *${mkName}*\n`;
    for (const item of gItems) {
      text += `☐ ${item.name}\n`;
    }
    if (hasGroups) text += '\n';
  }

  const keyboard = new InlineKeyboard();
  for (const item of pageItems) {
    keyboard
      .text(`✅ ${item.name}`, `shop:bought:${item.id}`)
      .text('🗑', `shop:del:${item.id}`)
      .row();
  }

  addPagination(keyboard, page, items.length, 'shop');
  keyboard.row();
  keyboard.text('➕ Добавить', 'shop:add');
  keyboard.text('🗑 Очистить', 'shop:clear');
  keyboard.row();
  keyboard.text('📤 Поделиться', 'shop:share');
  keyboard.row();
  keyboard.text('◀️ Назад', 'main_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

/**
 * Register shopping list handlers
 */
export function registerShoppingHandlers(bot) {
  // Show shopping list
  bot.callbackQuery('shopping', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showShoppingList(ctx);
  });

  // Pagination
  bot.callbackQuery(/^shop:page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showShoppingList(ctx, parseInt(ctx.match[1]));
  });

  // Share shopping list as plain text message
  bot.callbackQuery('shop:share', async (ctx) => {
    const items = await getShoppingList(ctx.dbUser.id);
    if (items.length === 0) {
      await ctx.answerCallbackQuery('Список пуст');
      return;
    }
    await ctx.answerCallbackQuery('Список отправлен ниже');
    let text = '🛒 *Список покупок:*\n\n';
    for (let i = 0; i < items.length; i++) {
      const medkit = items[i].medkits?.name ? ` _(${items[i].medkits.name})_` : '';
      text += `☐ ${items[i].name}${medkit}\n`;
    }
    // Send as new message (can be forwarded)
    await ctx.reply(text, { parse_mode: 'Markdown' });
  });

  // Delete individual item
  bot.callbackQuery(/^shop:del:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery('Удалено');
    await removeFromShoppingList(ctx.match[1]);
    await showShoppingList(ctx);
  });

  // Mark as bought
  bot.callbackQuery(/^shop:bought:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery('Куплено!');
    const item = await markAsBought(ctx.match[1]);
    // If linked to a medicine, offer to restock
    if (item?.medicine_id) {
      const med = await getMedicine(item.medicine_id);
      if (med) {
        await ctx.editMessageText(
          `✅ *${item.name}* — куплено!\n\nПополнить остаток в аптечке?`,
          {
            parse_mode: 'Markdown',
            reply_markup: new InlineKeyboard()
              .text('➕ Пополнить', `med:${med.id}:restock`)
              .text('⏭ Нет', 'shopping'),
          }
        );
        return;
      }
    }
    await showShoppingList(ctx);
  });

  // Add item — ask name
  bot.callbackQuery('shop:add', async (ctx) => {
    await ctx.answerCallbackQuery();
    await supabase.from('sessions').upsert(
      { key: `state:${ctx.dbUser.id}`, value: { action: 'shop_add', msgId: ctx.callbackQuery.message.message_id }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    await ctx.editMessageText(
      '🛒 Введите название товара для списка покупок:',
      {
        reply_markup: new InlineKeyboard().text('❌ Отмена', 'shopping'),
      }
    );
  });

  // Clear all
  bot.callbackQuery('shop:clear', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      '🗑 Очистить весь список покупок?',
      {
        reply_markup: new InlineKeyboard()
          .text('✅ Да', 'shop:clear:confirm')
          .text('❌ Нет', 'shopping'),
      }
    );
  });

  bot.callbackQuery('shop:clear:confirm', async (ctx) => {
    await ctx.answerCallbackQuery('Список очищен');
    // Delete all unbought items for user
    await supabase
      .from('shopping_list')
      .delete()
      .eq('user_id', ctx.dbUser.id)
      .eq('is_bought', false);
    await showShoppingList(ctx);
  });

  // Add from medicine card
  bot.callbackQuery(/^med:([0-9a-f-]+):shop$/, async (ctx) => {
    await ctx.answerCallbackQuery('Добавлено в список покупок');
    const med = await getMedicine(ctx.match[1]);
    if (!med) return;
    await addToShoppingList(ctx.dbUser.id, med.name, med.id, med.medkit_id);
    // Stay on medicine card
    await ctx.editMessageText(
      `✅ *${med.name}* добавлен в список покупок!`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('🛒 К списку', 'shopping')
          .text('◀️ Назад', `med:${med.id}`),
      }
    );
  });
}
