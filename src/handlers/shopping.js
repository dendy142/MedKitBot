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
      .text(ctx.t('shopping.btn_add'), 'shop:add')
      .row()
      .text(ctx.t('common.back'), 'main_menu');

    const text = ctx.t('shopping.empty');
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
    return;
  }

  const pageItems = paginateItems(items, page);
  let text = ctx.t('shopping.title', { count: items.length });

  for (const item of pageItems) {
    const medkit = item.medkits?.name ? ` (${item.medkits.name})` : '';
    text += `☐ ${item.name}${medkit}\n`;
  }

  const keyboard = new InlineKeyboard();
  for (const item of pageItems) {
    keyboard.text(`✅ ${item.name}`, `shop:bought:${item.id}`).row();
  }

  addPagination(keyboard, page, items.length, 'shop');
  keyboard.row();
  keyboard.text(ctx.t('shopping.btn_add'), 'shop:add');
  keyboard.text(ctx.t('shopping.btn_clear'), 'shop:clear');
  keyboard.row();
  keyboard.text(ctx.t('shopping.btn_share'), 'shop:share');
  keyboard.row();
  keyboard.text(ctx.t('common.back'), 'main_menu');

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
    await ctx.answerCallbackQuery();
    const items = await getShoppingList(ctx.dbUser.id);
    if (items.length === 0) {
      await ctx.answerCallbackQuery(ctx.t('shopping.empty_short'));
      return;
    }
    let text = ctx.t('shopping.share_header');
    for (const item of items) {
      text += `• ${item.name}\n`;
    }
    // Send as new message (can be forwarded)
    await ctx.reply(text);
  });

  // Mark as bought
  bot.callbackQuery(/^shop:bought:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery(ctx.t('shopping.bought_toast'));
    const item = await markAsBought(ctx.match[1]);
    // If linked to a medicine, offer to restock
    if (item?.medicine_id) {
      const med = await getMedicine(item.medicine_id);
      if (med) {
        await ctx.editMessageText(
          ctx.t('shopping.bought', { name: item.name }),
          {
            parse_mode: 'Markdown',
            reply_markup: new InlineKeyboard()
              .text(ctx.t('shopping.btn_restock'), `med:${med.id}:restock`)
              .text(ctx.t('shopping.btn_no_restock'), 'shopping'),
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
      ctx.t('shopping.add_prompt'),
      {
        reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), 'shopping'),
      }
    );
  });

  // Clear all
  bot.callbackQuery('shop:clear', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      ctx.t('shopping.clear_confirm'),
      {
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.yes'), 'shop:clear:confirm')
          .text(ctx.t('common.no'), 'shopping'),
      }
    );
  });

  bot.callbackQuery('shop:clear:confirm', async (ctx) => {
    await ctx.answerCallbackQuery(ctx.t('shopping.clear_toast'));
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
    await ctx.answerCallbackQuery(ctx.t('medicine.added_to_shop_toast'));
    const med = await getMedicine(ctx.match[1]);
    if (!med) return;
    await addToShoppingList(ctx.dbUser.id, med.name, med.id, med.medkit_id);
    // Stay on medicine card
    await ctx.editMessageText(
      ctx.t('medicine.added_to_shop', { name: med.name }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('medicine.btn_to_shop'), 'shopping')
          .text(ctx.t('common.back'), `med:${med.id}`),
      }
    );
  });
}
