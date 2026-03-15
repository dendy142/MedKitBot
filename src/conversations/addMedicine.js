import { InlineKeyboard } from 'grammy';
import { CATEGORIES, QUANTITY_UNITS, MAX_PHOTOS } from '../config.js';
import { createMedicine } from '../db/queries/medicines.js';
import { getMedkit } from '../db/queries/medkits.js';
import { parseDate, formatDate, formatQuantity } from '../utils/format.js';
import { logAction } from '../middleware/logging.js';

/**
 * Add medicine conversation
 * Steps: name → dosage → category → tags → expiry → quantity → photos → notes → confirm
 */
export async function addMedicineConversation(conversation, ctx) {
  const medkitId = ctx.session.currentMedkitId;
  if (!medkitId) {
    await ctx.reply('❌ Ошибка: аптечка не выбрана.');
    return;
  }

  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit) {
    await ctx.reply('❌ Аптечка не найдена.');
    return;
  }

  const data = {
    medkitId,
    name: null,
    dosage: null,
    category: null,
    tags: [],
    expiryDate: null,
    quantity: 0,
    quantityUnit: 'шт',
    photoFileIds: [],
    notes: null,
  };

  // Step 1: Name
  await ctx.reply(
    `💊 *Добавление в «${medkit.name}»*\n\n` +
    `Шаг 1/8: Введите *название* лекарства:`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('❌ Отмена', 'cancel'),
    }
  );

  const nameMsg = await conversation.waitFor('message:text');
  data.name = nameMsg.message.text.trim();

  // Step 2: Dosage
  await ctx.reply(
    `Шаг 2/8: Введите *дозировку* (напр. 500мг, 10мл):`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('⏭ Пропустить', 'skip_dosage')
        .row()
        .text('❌ Отмена', 'cancel'),
    }
  );

  const dosageResponse = await conversation.wait();
  if (dosageResponse.callbackQuery?.data === 'skip_dosage') {
    await dosageResponse.answerCallbackQuery();
  } else if (dosageResponse.message?.text) {
    data.dosage = dosageResponse.message.text.trim();
  }

  // Step 3: Category
  const catKeyboard = new InlineKeyboard();
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    catKeyboard.text(CATEGORIES[i], `cat:${CATEGORIES[i]}`);
    if (CATEGORIES[i + 1]) catKeyboard.text(CATEGORIES[i + 1], `cat:${CATEGORIES[i + 1]}`);
    catKeyboard.row();
  }
  catKeyboard.text('⏭ Пропустить', 'skip_category').row();
  catKeyboard.text('❌ Отмена', 'cancel');

  await ctx.reply('Шаг 3/8: Выберите *категорию*:', {
    parse_mode: 'Markdown',
    reply_markup: catKeyboard,
  });

  const catResponse = await conversation.wait();
  if (catResponse.callbackQuery?.data === 'skip_category') {
    await catResponse.answerCallbackQuery();
  } else if (catResponse.callbackQuery?.data?.startsWith('cat:')) {
    data.category = catResponse.callbackQuery.data.replace('cat:', '');
    await catResponse.answerCallbackQuery();
  } else if (catResponse.message?.text) {
    data.category = catResponse.message.text.trim();
  }

  // Step 4: Tags
  await ctx.reply(
    'Шаг 4/8: Введите *теги* через запятую (напр. «для детей, рецептурное»):',
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('⏭ Пропустить', 'skip_tags')
        .row()
        .text('❌ Отмена', 'cancel'),
    }
  );

  const tagsResponse = await conversation.wait();
  if (tagsResponse.callbackQuery?.data === 'skip_tags') {
    await tagsResponse.answerCallbackQuery();
  } else if (tagsResponse.message?.text) {
    data.tags = tagsResponse.message.text
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);
  }

  // Step 5: Expiry date
  await ctx.reply(
    'Шаг 5/8: Введите *срок годности* (ММ.ГГГГ или ДД.ММ.ГГГГ):',
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('⏭ Пропустить', 'skip_expiry')
        .row()
        .text('❌ Отмена', 'cancel'),
    }
  );

  const expiryResponse = await conversation.wait();
  if (expiryResponse.callbackQuery?.data === 'skip_expiry') {
    await expiryResponse.answerCallbackQuery();
  } else if (expiryResponse.message?.text) {
    const parsed = parseDate(expiryResponse.message.text);
    if (parsed) {
      data.expiryDate = parsed.toISOString().split('T')[0];
    } else {
      await ctx.reply('⚠️ Не удалось распознать дату. Пропускаю.');
    }
  }

  // Step 6: Quantity + unit
  await ctx.reply('Шаг 6/8: Введите *количество* (число):', {
    parse_mode: 'Markdown',
    reply_markup: new InlineKeyboard()
      .text('⏭ Пропустить', 'skip_quantity')
      .row()
      .text('❌ Отмена', 'cancel'),
  });

  const qtyResponse = await conversation.wait();
  if (qtyResponse.callbackQuery?.data === 'skip_quantity') {
    await qtyResponse.answerCallbackQuery();
  } else if (qtyResponse.message?.text) {
    const num = parseFloat(qtyResponse.message.text.trim());
    if (!isNaN(num) && num >= 0) {
      data.quantity = num;

      // Ask unit
      const unitKeyboard = new InlineKeyboard();
      for (let i = 0; i < QUANTITY_UNITS.length; i += 3) {
        unitKeyboard.text(QUANTITY_UNITS[i].label, `unit:${QUANTITY_UNITS[i].value}`);
        if (QUANTITY_UNITS[i + 1]) unitKeyboard.text(QUANTITY_UNITS[i + 1].label, `unit:${QUANTITY_UNITS[i + 1].value}`);
        if (QUANTITY_UNITS[i + 2]) unitKeyboard.text(QUANTITY_UNITS[i + 2].label, `unit:${QUANTITY_UNITS[i + 2].value}`);
        unitKeyboard.row();
      }

      await ctx.reply('Выберите *единицу измерения*:', {
        parse_mode: 'Markdown',
        reply_markup: unitKeyboard,
      });

      const unitResponse = await conversation.waitForCallbackQuery(/^unit:/);
      data.quantityUnit = unitResponse.match.replace('unit:', '');
      await unitResponse.answerCallbackQuery();
    } else {
      await ctx.reply('⚠️ Некорректное число. Пропускаю.');
    }
  }

  // Step 7: Photos
  await ctx.reply(
    `Шаг 7/8: Отправьте *фото* лекарства (до ${MAX_PHOTOS} шт.):`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('⏭ Пропустить', 'skip_photos')
        .row()
        .text('❌ Отмена', 'cancel'),
    }
  );

  let collectingPhotos = true;
  while (collectingPhotos && data.photoFileIds.length < MAX_PHOTOS) {
    const photoResponse = await conversation.wait();

    if (photoResponse.callbackQuery?.data === 'skip_photos' || photoResponse.callbackQuery?.data === 'done_photos') {
      if (photoResponse.callbackQuery) await photoResponse.answerCallbackQuery();
      collectingPhotos = false;
    } else if (photoResponse.message?.photo) {
      const photo = photoResponse.message.photo;
      const fileId = photo[photo.length - 1].file_id; // largest size
      data.photoFileIds.push(fileId);

      if (data.photoFileIds.length < MAX_PHOTOS) {
        await ctx.reply(
          `📷 Фото добавлено (${data.photoFileIds.length}/${MAX_PHOTOS}). Ещё?`,
          {
            reply_markup: new InlineKeyboard()
              .text('✅ Готово', 'done_photos')
              .text('📷 Ещё', 'more_photos'),
          }
        );
      } else {
        collectingPhotos = false;
      }
    } else {
      collectingPhotos = false;
    }
  }

  // Step 8: Notes
  await ctx.reply(
    'Шаг 8/8: Добавьте *заметки* (напр. «принимать после еды»):',
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('⏭ Пропустить', 'skip_notes')
        .row()
        .text('❌ Отмена', 'cancel'),
    }
  );

  const notesResponse = await conversation.wait();
  if (notesResponse.callbackQuery?.data === 'skip_notes') {
    await notesResponse.answerCallbackQuery();
  } else if (notesResponse.message?.text) {
    data.notes = notesResponse.message.text.trim();
  }

  // Confirmation
  let summary = `📋 *Проверьте данные:*\n\n`;
  summary += `💊 *Название:* ${data.name}\n`;
  if (data.dosage) summary += `💉 *Дозировка:* ${data.dosage}\n`;
  if (data.category) summary += `🏷 *Категория:* ${data.category}\n`;
  if (data.tags.length > 0) summary += `🏷 *Теги:* ${data.tags.join(', ')}\n`;
  if (data.expiryDate) summary += `📅 *Срок годности:* ${formatDate(data.expiryDate)}\n`;
  summary += `📏 *Количество:* ${formatQuantity(data.quantity, data.quantityUnit)}\n`;
  if (data.photoFileIds.length > 0) summary += `📷 *Фото:* ${data.photoFileIds.length} шт.\n`;
  if (data.notes) summary += `📝 *Заметки:* ${data.notes}\n`;

  await ctx.reply(summary, {
    parse_mode: 'Markdown',
    reply_markup: new InlineKeyboard()
      .text('✅ Сохранить', 'confirm_save')
      .text('❌ Отмена', 'confirm_cancel'),
  });

  const confirmResponse = await conversation.waitForCallbackQuery(/^confirm_/);
  await confirmResponse.answerCallbackQuery();

  if (confirmResponse.match === 'confirm_save') {
    const medicine = await createMedicine(data);
    await logAction(ctx.dbUser.id, 'create', 'medicine', medicine.id, { name: data.name });

    await ctx.reply(
      `✅ Лекарство *«${data.name}»* добавлено!`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('💊 Открыть', `med:${medicine.id}`)
          .text('➕ Ещё', `medkit:${medkitId}:add`)
          .row()
          .text('◀️ К аптечке', `medkit:${medkitId}`),
      }
    );
  } else {
    await ctx.reply('❌ Добавление отменено.', {
      reply_markup: new InlineKeyboard().text('◀️ К аптечке', `medkit:${medkitId}`),
    });
  }
}
