import { InlineKeyboard } from 'grammy';
import { getUserMedkits, getMedkit, createMedkit, renameMedkit, deleteMedkit, countMedkitMedicines } from '../db/queries/medkits.js';
import { getMedkitMedicines } from '../db/queries/medicines.js';
import { addPagination, paginateItems } from '../keyboards/pagination.js';
import { medicineStatusEmoji, formatQuantity, formatExpiry } from '../utils/format.js';
import { logAction } from '../middleware/logging.js';
import { startAddMedicine } from './addMedicine.js';
import { supabase } from '../db/supabase.js';

/**
 * Show list of user's medkits
 */
async function showMedkitList(ctx, page = 0) {
  const medkits = await getUserMedkits(ctx.dbUser.id);

  if (medkits.length === 0) {
    const keyboard = new InlineKeyboard()
      .text('➕ Создать аптечку', 'medkit:create')
      .row()
      .text('◀️ Назад', 'main_menu');

    const text = '📦 *Мои аптечки*\n\nУ вас пока нет аптечек. Создайте первую!';
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
    return;
  }

  const pageItems = paginateItems(medkits, page);
  let text = '📦 *Мои аптечки*\n\n';

  const keyboard = new InlineKeyboard();

  for (const mk of pageItems) {
    const count = await countMedkitMedicines(mk.id);
    const shared = mk.isShared ? ' 👥' : '';
    keyboard.text(`${mk.name} (${count})${shared}`, `medkit:${mk.id}`).row();
  }

  addPagination(keyboard, page, medkits.length, 'medkits');
  keyboard.row();
  keyboard.text('➕ Создать аптечку', 'medkit:create').row();
  keyboard.text('◀️ Назад', 'main_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

/**
 * Show single medkit screen with medicines
 */
async function showMedkit(ctx, medkitId, page = 0) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit) {
    await ctx.answerCallbackQuery('Аптечка не найдена');
    return;
  }

  const settings = ctx.dbUser.settings || {};
  const sortBy = settings.display?.default_sort || 'name';
  const medicines = await getMedkitMedicines(medkitId, { sortBy });
  const pageItems = paginateItems(medicines, page);

  let text = `📦 *${medkit.name}* (${medicines.length})\n\n`;

  for (const med of pageItems) {
    const emoji = medicineStatusEmoji(med, settings.thresholds);
    const qty = formatQuantity(med.quantity, med.quantity_unit);
    const expiry = med.expiry_date ? formatExpiry(med.expiry_date, settings.display?.date_format) : '';
    text += `${emoji} *${med.name}*${med.dosage ? ' ' + med.dosage : ''}\n`;
    text += `   Остаток: ${qty}${expiry ? ' | До: ' + expiry : ''}\n`;
  }

  if (medicines.length === 0) {
    text += '_Аптечка пуста. Добавьте первое лекарство!_\n';
  }

  const keyboard = new InlineKeyboard();

  // Medicine buttons (2 per row)
  for (let i = 0; i < pageItems.length; i += 2) {
    keyboard.text(pageItems[i].name, `med:${pageItems[i].id}`);
    if (pageItems[i + 1]) {
      keyboard.text(pageItems[i + 1].name, `med:${pageItems[i + 1].id}`);
    }
    keyboard.row();
  }

  addPagination(keyboard, page, medicines.length, `mk:${medkitId}`);

  keyboard.row();
  keyboard.text('➕ Добавить', `medkit:${medkitId}:add`);
  keyboard.text('🔀 Сортировка', `medkit:${medkitId}:sort`);
  keyboard.row();
  keyboard.text('👥 Поделиться', `medkit:${medkitId}:share`);
  keyboard.text('✏️ Редакт.', `medkit:${medkitId}:rename`);
  keyboard.text('🗑 Удалить', `medkit:${medkitId}:delete`);
  keyboard.row();
  keyboard.text('📂 Архив', `medkit:${medkitId}:archive`);
  keyboard.text('◀️ Назад', 'medkits');

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

/**
 * Register all medkit-related callback handlers
 */
export function registerMedkitHandlers(bot) {
  // List medkits
  bot.callbackQuery('medkits', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMedkitList(ctx);
  });

  // Medkit list pagination
  bot.callbackQuery(/^medkits:page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMedkitList(ctx, parseInt(ctx.match[1]));
  });

  // Create medkit — ask name
  bot.callbackQuery('medkit:create', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      '📦 *Новая аптечка*\n\nВведите название:',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('❌ Отмена', 'medkits'),
      }
    );
    await supabase.from('sessions').upsert(
      { key: `state:${ctx.dbUser.id}`, value: { action: 'create_medkit', msgId: ctx.callbackQuery.message.message_id }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
  });

  // View single medkit
  bot.callbackQuery(/^medkit:([0-9a-f-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMedkit(ctx, ctx.match[1]);
  });

  // Medkit medicine pagination
  bot.callbackQuery(/^mk:([0-9a-f-]+):page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMedkit(ctx, ctx.match[1], parseInt(ctx.match[2]));
  });

  // Add medicine to medkit
  bot.callbackQuery(/^medkit:([0-9a-f-]+):add$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await startAddMedicine(ctx, ctx.match[1]);
  });

  // Add medicine from onboarding
  bot.callbackQuery(/^medkit:([0-9a-f-]+):add:onboard$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await startAddMedicine(ctx, ctx.match[1], { fromOnboarding: true });
  });

  // Rename medkit — ask new name
  bot.callbackQuery(/^medkit:([0-9a-f-]+):rename$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await supabase.from('sessions').upsert(
      { key: `state:${ctx.dbUser.id}`, value: { action: 'rename_medkit', medkitId: ctx.match[1], msgId: ctx.callbackQuery.message.message_id }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    await ctx.editMessageText(
      '✏️ Введите новое название аптечки:',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('❌ Отмена', `medkit:${ctx.match[1]}`),
      }
    );
  });

  // Delete medkit — confirm
  bot.callbackQuery(/^medkit:([0-9a-f-]+):delete$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkit = await getMedkit(ctx.match[1], ctx.dbUser.id);
    if (!medkit) return;

    await ctx.editMessageText(
      `🗑 Вы уверены, что хотите удалить аптечку «${medkit.name}»?\n\n⚠️ Все лекарства в ней будут удалены!`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('✅ Да, удалить', `medkit:${ctx.match[1]}:delete:confirm`)
          .text('❌ Нет', `medkit:${ctx.match[1]}`),
      }
    );
  });

  // Delete medkit — confirmed
  bot.callbackQuery(/^medkit:([0-9a-f-]+):delete:confirm$/, async (ctx) => {
    await ctx.answerCallbackQuery('Аптечка удалена');
    await deleteMedkit(ctx.match[1]);
    await logAction(ctx.dbUser.id, 'delete', 'medkit', ctx.match[1]);
    await showMedkitList(ctx);
  });

  // Sort menu
  bot.callbackQuery(/^medkit:([0-9a-f-]+):sort$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];
    await ctx.editMessageText(
      '🔀 *Сортировка*\n\nВыберите порядок:',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('По названию', `medkit:${medkitId}:sort:name`)
          .text('По сроку', `medkit:${medkitId}:sort:expiry`)
          .row()
          .text('По категории', `medkit:${medkitId}:sort:category`)
          .text('По остатку', `medkit:${medkitId}:sort:quantity`)
          .row()
          .text('◀️ Назад', `medkit:${medkitId}`),
      }
    );
  });

  // Apply sort (temporary — changes display sort for this view)
  bot.callbackQuery(/^medkit:([0-9a-f-]+):sort:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const medkitId = ctx.match[1];
    const sortBy = ctx.match[2];
    // Show medkit with selected sort
    const medkit = await getMedkit(medkitId, ctx.dbUser.id);
    if (!medkit) return;

    const medicines = await getMedkitMedicines(medkitId, { sortBy });
    const settings = ctx.dbUser.settings || {};
    const pageItems = paginateItems(medicines, 0);

    let text = `📦 *${medkit.name}* (${medicines.length})\n\n`;
    for (const med of pageItems) {
      const emoji = medicineStatusEmoji(med, settings.thresholds);
      const qty = formatQuantity(med.quantity, med.quantity_unit);
      const expiry = med.expiry_date ? formatExpiry(med.expiry_date, settings.display?.date_format) : '';
      text += `${emoji} *${med.name}*${med.dosage ? ' ' + med.dosage : ''}\n`;
      text += `   Остаток: ${qty}${expiry ? ' | До: ' + expiry : ''}\n`;
    }

    const keyboard = new InlineKeyboard();
    for (let i = 0; i < pageItems.length; i += 2) {
      keyboard.text(pageItems[i].name, `med:${pageItems[i].id}`);
      if (pageItems[i + 1]) keyboard.text(pageItems[i + 1].name, `med:${pageItems[i + 1].id}`);
      keyboard.row();
    }
    addPagination(keyboard, 0, medicines.length, `mk:${medkitId}`);
    keyboard.row();
    keyboard.text('➕ Добавить', `medkit:${medkitId}:add`);
    keyboard.text('🔀 Сортировка', `medkit:${medkitId}:sort`);
    keyboard.row();
    keyboard.text('◀️ Назад', 'medkits');

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  });

  // Share, archive — placeholders
  bot.callbackQuery(/^medkit:([0-9a-f-]+):share$/, async (ctx) => {
    await ctx.answerCallbackQuery('Скоро! Функция в разработке.');
  });

  bot.callbackQuery(/^medkit:([0-9a-f-]+):archive$/, async (ctx) => {
    await ctx.answerCallbackQuery('Скоро! Функция в разработке.');
  });
}
