import { InlineKeyboard } from 'grammy';
import { getShoppingList, addToShoppingList, markAsBought, removeFromShoppingList } from '../db/queries/shoppingList.js';
import { getMedicine, updateMedicine } from '../db/queries/medicines.js';
import { supabase } from '../db/supabase.js';
import { paginateItems, addPagination } from '../keyboards/pagination.js';
import { formatQuantity } from '../utils/format.js';

/**
 * #105 Show shopping list with categories
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

  // #105 Group items: from medkit vs manual
  const fromMedkit = items.filter(i => i.medicine_id);
  const manual = items.filter(i => !i.medicine_id);

  let text = ctx.t('shopping.title', { count: items.length });

  if (fromMedkit.length > 0) {
    text += `\n${ctx.t('shopping_cat.from_medkit')}\n`;
    for (const item of fromMedkit) {
      const medkit = item.medkits?.name ? ` (${item.medkits.name})` : '';
      // #106 Quantity display
      const qty = item.quantity && item.quantity > 1 ? ` × ${item.quantity} уп.` : '';
      text += `  ☐ ${item.name}${qty}${medkit}\n`;
    }
  }

  if (manual.length > 0) {
    text += `\n${ctx.t('shopping_cat.manual')}\n`;
    for (const item of manual) {
      const qty = item.quantity && item.quantity > 1 ? ` × ${item.quantity} уп.` : '';
      text += `  ☐ ${item.name}${qty}\n`;
    }
  }

  const pageItems = paginateItems(items, page);
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
 * #107 Check for recurring purchases
 */
async function checkRecurringPurchase(ctx, medicineId, medicineName) {
  try {
    const { count } = await supabase
      .from('shopping_list')
      .select('*', { count: 'exact', head: true })
      .eq('medicine_id', medicineId)
      .eq('user_id', ctx.dbUser.id);

    if (count && count >= 3) {
      const settings = ctx.dbUser?.settings || {};
      if (!settings.autoShoppingList) {
        try {
          await ctx.api.sendMessage(ctx.chat.id,
            ctx.t('recurring.suggest', { name: medicineName }),
            {
              reply_markup: new InlineKeyboard()
                .text(ctx.t('recurring.btn_enable'), 'set:auto_shop:toggle')
                .text(ctx.t('recurring.btn_dismiss'), 'noop'),
            }
          );
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

/**
 * Register shopping list handlers
 */
export function registerShoppingHandlers(bot) {
  bot.callbackQuery('shopping', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showShoppingList(ctx);
  });

  bot.callbackQuery(/^shop:page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showShoppingList(ctx, parseInt(ctx.match[1]));
  });

  bot.callbackQuery('shop:share', async (ctx) => {
    await ctx.answerCallbackQuery();
    const items = await getShoppingList(ctx.dbUser.id);
    if (items.length === 0) {
      await ctx.answerCallbackQuery(ctx.t('shopping.empty_short'));
      return;
    }
    let text = ctx.t('shopping.share_header');
    for (const item of items) {
      const qty = item.quantity && item.quantity > 1 ? ` × ${item.quantity}` : '';
      text += `• ${item.name}${qty}\n`;
    }
    text += ctx.t('shopping.share_footer');
    await ctx.reply(text);
  });

  // #108 Mark as bought — with restock offer for medkit items
  bot.callbackQuery(/^shop:bought:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery(ctx.t('shopping.bought_toast'));
    const item = await markAsBought(ctx.match[1]);

    if (item?.medicine_id) {
      const med = await getMedicine(item.medicine_id);
      if (med) {
        // #107 Check recurring
        await checkRecurringPurchase(ctx, item.medicine_id, item.name);

        // #108 Offer restock with quick buttons
        await ctx.editMessageText(
          ctx.t('bought_restock.prompt', { name: item.name }),
          {
            parse_mode: 'Markdown',
            reply_markup: new InlineKeyboard()
              .text(ctx.t('bought_restock.btn_restock_10'), `shop:restock:${med.id}:10`)
              .text(ctx.t('bought_restock.btn_restock_20'), `shop:restock:${med.id}:20`)
              .text(ctx.t('bought_restock.btn_restock_30'), `shop:restock:${med.id}:30`)
              .row()
              .text(ctx.t('bought_restock.btn_restock_custom'), `med:${med.id}:restock`)
              .text(ctx.t('bought_restock.btn_no'), 'shopping'),
          }
        );
        return;
      }
    }
    await showShoppingList(ctx);
  });

  // #108 Quick restock from shopping
  bot.callbackQuery(/^shop:restock:([0-9a-f-]+):(\d+)$/, async (ctx) => {
    const medId = ctx.match[1];
    const qty = parseInt(ctx.match[2], 10);
    await ctx.answerCallbackQuery();

    const med = await getMedicine(medId);
    if (med) {
      const newQty = med.quantity + qty;
      await updateMedicine(medId, { quantity: newQty });

      // Check if paused schedules should be resumed
      if (med.quantity <= 0 && newQty > 0) {
        const { data: pausedScheds } = await supabase
          .from('schedules')
          .select('id')
          .eq('medicine_id', medId)
          .eq('status', 'paused');
        if (pausedScheds && pausedScheds.length > 0) {
          await supabase.from('schedules').update({ status: 'active' }).in('id', pausedScheds.map(s => s.id));
        }
      }
    }

    await ctx.editMessageText(
      ctx.t('bought_restock.done', { qty }),
      {
        reply_markup: new InlineKeyboard()
          .text(ctx.t('shopping.btn_to_list'), 'shopping')
          .text(ctx.t('common.main_menu'), 'main_menu'),
      }
    );
  });

  // #106 Add from medicine card with quantity selection
  bot.callbackQuery(/^med:([0-9a-f-]+):shop$/, async (ctx) => {
    const medId = ctx.match[1];
    const med = await getMedicine(medId);
    if (!med) return;
    await ctx.answerCallbackQuery();

    // Show quantity selection
    await ctx.editMessageText(
      ctx.t('shopping_qty.prompt', { name: med.name }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('1', `shop:addmed:${med.id}:1`)
          .text('2', `shop:addmed:${med.id}:2`)
          .text('3', `shop:addmed:${med.id}:3`)
          .row()
          .text(ctx.t('shopping.btn_qty_custom'), `shop:addmed_custom:${med.id}`)
          .row()
          .text(ctx.t('common.back'), `med:${med.id}`),
      }
    );
  });

  // #106 Confirm add with quantity
  bot.callbackQuery(/^shop:addmed:([0-9a-f-]+):(\d+)$/, async (ctx) => {
    const medId = ctx.match[1];
    const qty = parseInt(ctx.match[2], 10);
    const med = await getMedicine(medId);
    if (!med) return;
    await ctx.answerCallbackQuery(ctx.t('shopping.added_toast'));

    // Add with quantity
    const { data, error } = await supabase
      .from('shopping_list')
      .insert({
        user_id: ctx.dbUser.id,
        medicine_id: med.id,
        medkit_id: med.medkit_id,
        name: med.name,
        quantity: qty,
      })
      .select()
      .single();

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

  // #106 Custom quantity — set state
  bot.callbackQuery(/^shop:addmed_custom:([0-9a-f-]+)$/, async (ctx) => {
    const medId = ctx.match[1];
    await ctx.answerCallbackQuery();

    await supabase.from('sessions').upsert(
      {
        key: `state:${ctx.dbUser.id}`,
        value: {
          action: 'shop_add_qty',
          medId,
          msgId: ctx.callbackQuery.message.message_id,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );

    await ctx.editMessageText(
      ctx.t('shopping.quantity_prompt'),
      {
        reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), `med:${medId}`),
      }
    );
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
      { reply_markup: new InlineKeyboard().text(ctx.t('common.cancel'), 'shopping') }
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
    await supabase
      .from('shopping_list')
      .delete()
      .eq('user_id', ctx.dbUser.id)
      .eq('is_bought', false);
    await showShoppingList(ctx);
  });
}
