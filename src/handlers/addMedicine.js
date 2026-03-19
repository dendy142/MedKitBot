import { InlineKeyboard } from 'grammy';
import { CATEGORIES, CATEGORY_KEYWORDS, DOSAGE_UNITS, QUANTITY_UNITS, MAX_PHOTOS } from '../config.js';
import { createMedicine } from '../db/queries/medicines.js';
import { getMedkit, getUserMedkits } from '../db/queries/medkits.js';
import { formatDate, formatQuantity, sanitize, validateQuantity } from '../utils/format.js';
import { logAction } from '../middleware/logging.js';
import { withRetry } from '../utils/retry.js';
import { supabase } from '../db/supabase.js';
import { checkAchievements } from './achievements.js';
import { showForWhomPicker } from './profiles.js';

async function getState(userId) {
  const { data } = await supabase
    .from('sessions')
    .select('value')
    .eq('key', `addmed:${userId}`)
    .single();
  return data?.value ?? null;
}

async function setState(userId, state) {
  await supabase
    .from('sessions')
    .upsert(
      { key: `addmed:${userId}`, value: state, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
}

async function clearState(userId) {
  await supabase
    .from('sessions')
    .delete()
    .eq('key', `addmed:${userId}`);
}

/**
 * Helper: edit the single bot message tracked in state.
 * If called from a callback query — use ctx.editMessageText.
 * If called after text input — use ctx.api.editMessageText with stored msgId.
 */
async function editBotMsg(ctx, state, text, keyboard) {
  const opts = { parse_mode: 'Markdown', reply_markup: keyboard };
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, opts);
  } else if (state.msgId) {
    await ctx.api.editMessageText(ctx.chat.id, state.msgId, text, opts);
  }
}

/**
 * Silently delete a user message (ignore errors if can't delete)
 */
async function deleteUserMsg(ctx) {
  try {
    await ctx.deleteMessage();
  } catch { /* ignore — might not have permission */ }
}

/**
 * Auto-detect category from medicine name using CATEGORY_KEYWORDS
 */
function detectCategory(name) {
  const lower = name.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return category;
  }
  return null;
}

// ============================================================
// START
// ============================================================

export async function startAddMedicine(ctx, medkitId, options = {}) {
  const medkit = await getMedkit(medkitId, ctx.dbUser.id);
  if (!medkit) {
    await ctx.answerCallbackQuery(ctx.t('addmed.medkit_not_found'));
    return;
  }

  const state = {
    step: 'name',
    medkitId,
    medkitName: medkit.name,
    fromOnboarding: options.fromOnboarding || false,
    msgId: null, // will be set to the bot message we keep editing
    data: {
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
    },
  };

  // Edit the current message (from callback) — this becomes our single bot message
  const startKb = new InlineKeyboard()
    .text(ctx.t('addmed.btn_from_templates'), `addmed:templates:${medkitId}`).row()
    .text(ctx.t('common.cancel'), 'addmed:cancel');
  await ctx.editMessageText(
    ctx.t('addmed.step1', { medkit: medkit.name }),
    {
      parse_mode: 'Markdown',
      reply_markup: startKb,
    }
  );
  // Store the message ID so we can edit it later from text handlers
  state.msgId = ctx.callbackQuery.message.message_id;
  await setState(ctx.dbUser.id, state);
}

// ============================================================
// TEXT INPUT HANDLER
// ============================================================

export async function handleAddMedicineText(ctx) {
  const state = await getState(ctx.dbUser.id);
  if (!state) return false;

  const text = ctx.message.text.trim();
  const { step } = state;

  // Delete the user's message immediately
  await deleteUserMsg(ctx);

  if (step === 'name') {
    // #69 Sanitize name input
    const sanitizedName = sanitize(text, 100);
    if (!sanitizedName) {
      await editBotMsg(ctx, state,
        ctx.t('addmed.invalid_name'),
        new InlineKeyboard()
          .text(ctx.t('addmed.btn_from_templates'), `addmed:templates:${state.medkitId}`).row()
          .text(ctx.t('common.cancel'), 'addmed:cancel')
      );
      return true;
    }
    state.data.name = sanitizedName;
    // #33 Auto-category detection from name
    const autoCategory = detectCategory(text);
    if (autoCategory) {
      state.data.category = autoCategory;
      state.autoCategory = true;
    }

    // #30 Duplicate medicine check
    if (!state.duplicateConfirmed) {
      const { data: duplicates } = await supabase
        .from('medicines')
        .select('id, name, dosage')
        .eq('medkit_id', state.medkitId)
        .eq('is_archived', false)
        .ilike('name', text.trim());

      if (duplicates && duplicates.length > 0) {
        state.step = 'name_duplicate';
        state.duplicateId = duplicates[0].id;
        await setState(ctx.dbUser.id, state);
        await editBotMsg(ctx, state,
          ctx.t('medicine.duplicate_found', { name: text }),
          new InlineKeyboard()
            .text(ctx.t('medicine.btn_add_anyway'), 'addmed:dup_add')
            .text(ctx.t('medicine.btn_go_existing'), `addmed:dup_go:${duplicates[0].id}`)
        );
        return true;
      }
    }

    // #31 Dosage hint from history — search for similar medicines across all user's medkits
    try {
      const userMedkits = await getUserMedkits(ctx.dbUser.id);
      const medkitIds = userMedkits.map(m => m.id);
      if (medkitIds.length > 0) {
        const { data: similar } = await supabase
          .from('medicines')
          .select('name, dosage, category, quantity_unit')
          .in('medkit_id', medkitIds)
          .ilike('name', `%${text.trim().split(' ')[0]}%`)
          .limit(1);
        if (similar && similar.length > 0) {
          const match = similar[0];
          state.hintMatch = match;
          state.step = 'hint_confirm';
          await setState(ctx.dbUser.id, state);
          const hintKb = new InlineKeyboard()
            .text(ctx.t('addmed.btn_use_hint'), 'addmed:hint_yes')
            .text(ctx.t('addmed.btn_enter_manual'), 'addmed:hint_no');
          await editBotMsg(ctx, state,
            ctx.t('addmed.hint_from_history', {
              name: `${match.name}${match.dosage ? ' ' + match.dosage : ''}`,
              category: match.category || '—',
            }),
            hintKb
          );
          return true;
        }
      }
    } catch { /* ignore hint errors, proceed normally */ }

    state.step = 'dosage_unit';
    await setState(ctx.dbUser.id, state);
    await sendDosageUnitPicker(ctx, state);
    return true;
  }

  if (step === 'dosage_value') {
    // #69 Sanitize dosage value
    const sanitizedDosage = sanitize(text, 100);
    if (!sanitizedDosage) return true;
    state.data.dosage = `${sanitizedDosage} ${state.dosageUnit}`;
    // #33 Skip category step if auto-detected
    if (state.autoCategory) {
      state.step = 'tags';
      await setState(ctx.dbUser.id, state);
      await sendTagsPrompt(ctx, state, true);
    } else {
      state.step = 'category';
      await setState(ctx.dbUser.id, state);
      await sendCategoryPicker(ctx, state);
    }
    return true;
  }

  if (step === 'dosage_custom') {
    // #69 Sanitize custom dosage
    const sanitizedCustomDosage = sanitize(text, 100);
    if (!sanitizedCustomDosage) return true;
    state.data.dosage = sanitizedCustomDosage;
    // #33 Skip category step if auto-detected
    if (state.autoCategory) {
      state.step = 'tags';
      await setState(ctx.dbUser.id, state);
      await sendTagsPrompt(ctx, state, true);
    } else {
      state.step = 'category';
      await setState(ctx.dbUser.id, state);
      await sendCategoryPicker(ctx, state);
    }
    return true;
  }

  if (step === 'category_custom') {
    // #69 Sanitize custom category
    const sanitizedCategory = sanitize(text, 100);
    if (!sanitizedCategory) return true;
    state.data.category = sanitizedCategory;
    // #15 Remember last category
    await supabase.from('sessions').upsert(
      { key: `lastCategory:${ctx.dbUser.id}`, value: text, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    state.step = 'tags';
    await setState(ctx.dbUser.id, state);
    await sendTagsPrompt(ctx, state);
    return true;
  }

  if (step === 'tags') {
    // #69 Sanitize each tag (max 50 per tag)
    state.data.tags = text.split(',').map(t => sanitize(t, 50)).filter(t => t !== null);
    state.step = 'expiry_year';
    await setState(ctx.dbUser.id, state);
    await sendExpiryYearPicker(ctx, state);
    return true;
  }

  if (step === 'quantity') {
    // #71 Quantity validation: positive, max 99999, comma→dot, max 1 decimal
    const num = validateQuantity(text);
    if (num !== null) {
      state.data.quantity = num;
      state.step = 'quantity_unit';
      await setState(ctx.dbUser.id, state);
      await sendQuantityUnitPicker(ctx, state);
    } else {
      // Show error in the bot message
      await editBotMsg(ctx, state,
        ctx.t('addmed.quantity_invalid'),
        new InlineKeyboard()
          .text(ctx.t('common.skip'), 'addmed:skip').row()
          .text(ctx.t('common.cancel'), 'addmed:cancel')
      );
    }
    return true;
  }

  if (step === 'notes') {
    // #69 Sanitize notes
    state.data.notes = sanitize(text, 500);
    // #47 "For whom?" step — show profile picker if user has profiles
    state.step = 'for_whom';
    await setState(ctx.dbUser.id, state);
    const shown = await showForWhomPicker(ctx, state);
    if (!shown) {
      // No profiles — skip to confirm
      state.step = 'confirm';
      await setState(ctx.dbUser.id, state);
      await sendConfirmation(ctx, state);
    }
    return true;
  }

  return false;
}

// ============================================================
// PHOTO INPUT HANDLER
// ============================================================

export async function handleAddMedicinePhoto(ctx) {
  const state = await getState(ctx.dbUser.id);
  if (!state || state.step !== 'photos') return false;

  const photo = ctx.message.photo;
  const fileId = photo[photo.length - 1].file_id;
  state.data.photoFileIds.push(fileId);
  await deleteUserMsg(ctx);

  if (state.data.photoFileIds.length < MAX_PHOTOS) {
    await setState(ctx.dbUser.id, state);
    await editBotMsg(ctx, state,
      ctx.t('addmed.step7_more', { count: state.data.photoFileIds.length, max: MAX_PHOTOS }),
      new InlineKeyboard()
        .text(ctx.t('common.done'), 'addmed:photos_done')
        .row()
        .text(ctx.t('common.cancel'), 'addmed:cancel')
    );
  } else {
    state.step = 'notes';
    await setState(ctx.dbUser.id, state);
    await sendNotesPrompt(ctx, state);
  }
  return true;
}

// ============================================================
// CALLBACK QUERY HANDLER
// ============================================================

export async function handleAddMedicineCallback(ctx, action) {
  // #39 Suggest schedule dismiss — handled after state is cleared
  if (action.startsWith('addmed:sched_dismiss:')) {
    const parts = action.replace('addmed:sched_dismiss:', '').split(':');
    const medId = parts[0];
    const medkitId = parts[1];
    await ctx.answerCallbackQuery();
    // Fetch medicine name for the success message
    const { data: med } = await supabase.from('medicines').select('name').eq('id', medId).single();
    const medName = med?.name || '—';
    await ctx.editMessageText(
      ctx.t('addmed.success', { name: medName }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('addmed.btn_open'), `med:${medId}`)
          .text(ctx.t('common.add_more'), `medkit:${medkitId}:add`)
          .row()
          .text(ctx.t('medkit.btn_to_medkit'), `medkit:${medkitId}`),
      }
    );
    return true;
  }

  const state = await getState(ctx.dbUser.id);
  if (!state) return false;

  // Update msgId from callback message (in case it wasn't set)
  if (ctx.callbackQuery.message) {
    state.msgId = ctx.callbackQuery.message.message_id;
  }

  if (action === 'addmed:cancel') {
    // #13 If data has been entered (name filled), show confirmation first
    if (state.data.name && !state.cancelConfirmed) {
      state.cancelConfirmed = false;
      await setState(ctx.dbUser.id, state);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        ctx.t('addmed.cancel_confirm'),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(ctx.t('common.yes'), 'addmed:cancel_yes')
            .text(ctx.t('addmed.btn_cancel_no'), 'addmed:cancel_no'),
        }
      );
      return true;
    }
    const fromOnboarding = state.fromOnboarding;
    const medkitId = state.medkitId;
    await clearState(ctx.dbUser.id);
    await ctx.answerCallbackQuery(ctx.t('common.cancelled'));
    if (fromOnboarding) {
      await ctx.editMessageText(
        ctx.t('addmed.skip_onboarding'),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(ctx.t('common.to_medkits'), 'medkits')
            .text(ctx.t('common.to_settings'), 'settings')
            .row()
            .text(ctx.t('common.to_help'), 'help')
            .text(ctx.t('common.main_menu'), 'main_menu'),
        }
      );
    } else {
      await ctx.editMessageText(ctx.t('addmed.cancel_done'), {
        reply_markup: new InlineKeyboard().text(ctx.t('medkit.btn_to_medkit'), `medkit:${medkitId}`),
      });
    }
    return true;
  }

  // #13 Cancel confirmation — yes
  if (action === 'addmed:cancel_yes') {
    const fromOnboarding = state.fromOnboarding;
    const medkitId = state.medkitId;
    await clearState(ctx.dbUser.id);
    await ctx.answerCallbackQuery(ctx.t('common.cancelled'));
    if (fromOnboarding) {
      await ctx.editMessageText(
        ctx.t('addmed.skip_onboarding'),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(ctx.t('common.to_medkits'), 'medkits')
            .text(ctx.t('common.to_settings'), 'settings')
            .row()
            .text(ctx.t('common.to_help'), 'help')
            .text(ctx.t('common.main_menu'), 'main_menu'),
        }
      );
    } else {
      await ctx.editMessageText(ctx.t('addmed.cancel_done'), {
        reply_markup: new InlineKeyboard().text(ctx.t('medkit.btn_to_medkit'), `medkit:${medkitId}`),
      });
    }
    return true;
  }

  // #13 Cancel confirmation — no, continue wizard
  if (action === 'addmed:cancel_no') {
    await ctx.answerCallbackQuery();
    // Re-show the current step
    await resendCurrentStep(ctx, state);
    return true;
  }

  if (action === 'addmed:skip') {
    await ctx.answerCallbackQuery();
    return await advanceStep(ctx, state);
  }

  // #30 Duplicate — user wants to add anyway
  if (action === 'addmed:dup_add') {
    await ctx.answerCallbackQuery();
    state.duplicateConfirmed = true;
    state.step = 'dosage_unit';
    delete state.duplicateId;
    await setState(ctx.dbUser.id, state);
    await sendDosageUnitPicker(ctx, state);
    return true;
  }

  // #30 Duplicate — go to existing medicine
  if (action.startsWith('addmed:dup_go:')) {
    const existingId = action.replace('addmed:dup_go:', '');
    await clearState(ctx.dbUser.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`💊 ${ctx.t('common.loading')}`, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text(ctx.t('medicine.btn_to_medicine'), `med:${existingId}`),
    });
    return true;
  }

  // #31 Hint from history — user accepts suggestion
  if (action === 'addmed:hint_yes') {
    await ctx.answerCallbackQuery();
    const match = state.hintMatch;
    if (match) {
      if (match.dosage) state.data.dosage = match.dosage;
      if (match.category) {
        state.data.category = match.category;
        state.autoCategory = true;
      }
      if (match.quantity_unit) state.data.quantityUnit = match.quantity_unit;
    }
    // Skip dosage, category steps — go to tags
    state.step = 'tags';
    delete state.hintMatch;
    await setState(ctx.dbUser.id, state);
    await sendTagsPrompt(ctx, state, !!state.autoCategory);
    return true;
  }

  // #31 Hint from history — user declines, proceed manually
  if (action === 'addmed:hint_no') {
    await ctx.answerCallbackQuery();
    delete state.hintMatch;
    state.step = 'dosage_unit';
    await setState(ctx.dbUser.id, state);
    await sendDosageUnitPicker(ctx, state);
    return true;
  }

  // #32 Templates — show list of user's existing medicines
  if (action.startsWith('addmed:templates:')) {
    await ctx.answerCallbackQuery();
    try {
      const userMedkits = await getUserMedkits(ctx.dbUser.id);
      const medkitIds = userMedkits.map(m => m.id);
      if (medkitIds.length > 0) {
        const { data: templates } = await supabase
          .from('medicines')
          .select('name, dosage, category, quantity_unit, tags, notes')
          .in('medkit_id', medkitIds)
          .eq('is_archived', false)
          .order('name');
        const unique = [...new Map((templates || []).map(m => [m.name.toLowerCase(), m])).values()];
        if (unique.length > 0) {
          state.templates = unique;
          state.step = 'template_pick';
          await setState(ctx.dbUser.id, state);
          const kb = new InlineKeyboard();
          unique.forEach((m, i) => {
            const label = m.dosage ? `${m.name} (${m.dosage})` : m.name;
            kb.text(label, `addmed:tpl:${i}`).row();
          });
          kb.text(ctx.t('common.cancel'), 'addmed:cancel');
          await ctx.editMessageText(
            ctx.t('addmed.templates_title'),
            { parse_mode: 'Markdown', reply_markup: kb }
          );
        } else {
          await ctx.editMessageText(
            ctx.t('addmed.templates_empty'),
            {
              parse_mode: 'Markdown',
              reply_markup: new InlineKeyboard().text(ctx.t('common.back'), `addmed:back_to_name`),
            }
          );
        }
      }
    } catch {
      // Fallback — go back to name step
      await resendCurrentStep(ctx, state);
    }
    return true;
  }

  // #32 Templates — user picks a template
  if (action.startsWith('addmed:tpl:')) {
    const idx = parseInt(action.replace('addmed:tpl:', ''));
    await ctx.answerCallbackQuery();
    const tpl = state.templates?.[idx];
    if (tpl) {
      state.data.name = tpl.name;
      if (tpl.dosage) state.data.dosage = tpl.dosage;
      if (tpl.category) {
        state.data.category = tpl.category;
        state.autoCategory = true;
      }
      if (tpl.quantity_unit) state.data.quantityUnit = tpl.quantity_unit;
      if (tpl.tags) state.data.tags = tpl.tags;
      if (tpl.notes) state.data.notes = tpl.notes;
      delete state.templates;
      // Skip to quantity step
      state.step = 'quantity';
      await setState(ctx.dbUser.id, state);
      await sendQuantityPrompt(ctx, state);
    }
    return true;
  }

  // #32 Back to name step from templates empty
  if (action === 'addmed:back_to_name') {
    await ctx.answerCallbackQuery();
    state.step = 'name';
    await setState(ctx.dbUser.id, state);
    await resendCurrentStep(ctx, state);
    return true;
  }

  // #34 Past expiry date warning — user confirms
  if (action === 'addmed:expiry_past_ok') {
    await ctx.answerCallbackQuery();
    state.expiryWarningShown = true;
    state.step = 'quantity';
    await setState(ctx.dbUser.id, state);
    await ctx.editMessageText(
      ctx.t('addmed.step6_quantity'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.skip'), 'addmed:skip').row()
          .text(ctx.t('common.cancel'), 'addmed:cancel'),
      }
    );
    return true;
  }

  // #34 Past expiry date warning — user wants to re-enter
  if (action === 'addmed:expiry_past_reenter') {
    await ctx.answerCallbackQuery();
    state.step = 'expiry_year';
    delete state.expiryYear;
    delete state.expiryMonth;
    state.data.expiryDate = null;
    await setState(ctx.dbUser.id, state);
    await sendExpiryYearPicker(ctx, state);
    return true;
  }

  // --- Dosage unit ---
  if (action.startsWith('addmed:dosunit:')) {
    const unit = action.replace('addmed:dosunit:', '');
    await ctx.answerCallbackQuery();
    if (unit === 'другое') {
      state.step = 'dosage_custom';
      await setState(ctx.dbUser.id, state);
      await ctx.editMessageText(
        ctx.t('addmed.step2_custom'),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(ctx.t('common.skip'), 'addmed:skip').row()
            .text(ctx.t('common.cancel'), 'addmed:cancel'),
        }
      );
    } else {
      state.dosageUnit = unit;
      state.step = 'dosage_value';
      await setState(ctx.dbUser.id, state);
      await ctx.editMessageText(
        ctx.t('addmed.step2_value', { unit }),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(ctx.t('common.skip'), 'addmed:skip').row()
            .text(ctx.t('common.cancel'), 'addmed:cancel'),
        }
      );
    }
    return true;
  }

  // --- Category ---
  if (action.startsWith('addmed:cat:')) {
    const category = action.replace('addmed:cat:', '');
    state.data.category = category;
    await ctx.answerCallbackQuery();
    // #15 Remember last category
    await supabase.from('sessions').upsert(
      { key: `lastCategory:${ctx.dbUser.id}`, value: category, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    state.step = 'tags';
    await setState(ctx.dbUser.id, state);
    await ctx.editMessageText(
      ctx.t('addmed.step4_tags'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.skip'), 'addmed:skip').row()
          .text(ctx.t('common.cancel'), 'addmed:cancel'),
      }
    );
    return true;
  }

  if (action === 'addmed:cat_custom') {
    await ctx.answerCallbackQuery();
    state.step = 'category_custom';
    await setState(ctx.dbUser.id, state);
    await ctx.editMessageText(
      ctx.t('addmed.step3_custom'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.skip'), 'addmed:skip').row()
          .text(ctx.t('common.cancel'), 'addmed:cancel'),
      }
    );
    return true;
  }

  // --- Expiry year ---
  if (action.startsWith('addmed:eyear:')) {
    const year = parseInt(action.replace('addmed:eyear:', ''));
    state.expiryYear = year;
    state.step = 'expiry_month';
    await ctx.answerCallbackQuery();
    await setState(ctx.dbUser.id, state);
    await sendExpiryMonthPicker(ctx, year);
    return true;
  }

  // --- Expiry month ---
  if (action.startsWith('addmed:emonth:')) {
    const month = parseInt(action.replace('addmed:emonth:', ''));
    state.expiryMonth = month;
    state.step = 'expiry_day';
    await ctx.answerCallbackQuery();
    await setState(ctx.dbUser.id, state);
    await sendExpiryDayPicker(ctx, state.expiryYear, month);
    return true;
  }

  // --- Expiry day ---
  if (action.startsWith('addmed:eday:')) {
    const day = parseInt(action.replace('addmed:eday:', ''));
    await ctx.answerCallbackQuery();
    const y = state.expiryYear;
    const m = String(state.expiryMonth).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    state.data.expiryDate = `${y}-${m}-${d}`;

    // #70 Date validation — not >10 years in future
    const parsed = new Date(`${y}-${m}-${d}`);
    const tenYears = new Date();
    tenYears.setFullYear(tenYears.getFullYear() + 10);
    if (parsed > tenYears) {
      state.data.expiryDate = null;
      state.step = 'expiry_year';
      await setState(ctx.dbUser.id, state);
      await ctx.editMessageText(
        ctx.t('addmed.date_too_far'),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(ctx.t('common.back'), 'addmed:expiry_past_reenter')
            .text(ctx.t('common.cancel'), 'addmed:cancel'),
        }
      );
      return true;
    }

    // #70 Warn if >5 years in future
    const fiveYears = new Date();
    fiveYears.setFullYear(fiveYears.getFullYear() + 5);
    if (parsed > fiveYears && !state.expiryFarFutureShown) {
      state.expiryFarFutureShown = true;
      state.step = 'expiry_far_future_confirm';
      await setState(ctx.dbUser.id, state);
      await ctx.editMessageText(
        ctx.t('medicine.expiry_far_future', { date: formatDate(state.data.expiryDate) }),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(ctx.t('medicine.btn_continue'), 'addmed:expiry_past_ok')
            .text(ctx.t('medicine.btn_enter_another'), 'addmed:expiry_past_reenter'),
        }
      );
      return true;
    }

    // #34 Past expiry date warning
    if (parsed < new Date() && !state.expiryWarningShown) {
      state.step = 'expiry_past_confirm';
      await setState(ctx.dbUser.id, state);
      await ctx.editMessageText(
        ctx.t('medicine.expiry_in_past'),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(ctx.t('medicine.btn_continue'), 'addmed:expiry_past_ok')
            .text(ctx.t('medicine.btn_enter_another'), 'addmed:expiry_past_reenter'),
        }
      );
      return true;
    }

    state.step = 'quantity';
    await setState(ctx.dbUser.id, state);
    await ctx.editMessageText(
      ctx.t('addmed.step6_quantity'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.skip'), 'addmed:skip').row()
          .text(ctx.t('common.cancel'), 'addmed:cancel'),
      }
    );
    return true;
  }

  if (action === 'addmed:emonth_only') {
    await ctx.answerCallbackQuery();
    const y = state.expiryYear;
    const m = String(state.expiryMonth).padStart(2, '0');
    const lastDay = new Date(y, state.expiryMonth, 0).getDate();
    state.data.expiryDate = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;

    // #34 Past expiry date warning
    const parsed = new Date(y, state.expiryMonth - 1, lastDay);
    if (parsed < new Date() && !state.expiryWarningShown) {
      state.step = 'expiry_past_confirm';
      await setState(ctx.dbUser.id, state);
      await ctx.editMessageText(
        ctx.t('medicine.expiry_in_past'),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(ctx.t('medicine.btn_continue'), 'addmed:expiry_past_ok')
            .text(ctx.t('medicine.btn_enter_another'), 'addmed:expiry_past_reenter'),
        }
      );
      return true;
    }

    state.step = 'quantity';
    await setState(ctx.dbUser.id, state);
    await ctx.editMessageText(
      ctx.t('addmed.step6_quantity'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.skip'), 'addmed:skip').row()
          .text(ctx.t('common.cancel'), 'addmed:cancel'),
      }
    );
    return true;
  }

  // --- Quantity unit ---
  if (action.startsWith('addmed:qunit:')) {
    state.data.quantityUnit = action.replace('addmed:qunit:', '');
    await ctx.answerCallbackQuery();
    state.step = 'photos';
    await setState(ctx.dbUser.id, state);
    await ctx.editMessageText(
      ctx.t('addmed.step7_photos', { max: MAX_PHOTOS }),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.skip'), 'addmed:skip').row()
          .text(ctx.t('common.cancel'), 'addmed:cancel'),
      }
    );
    return true;
  }

  // --- Photos ---
  if (action === 'addmed:photos_done') {
    await ctx.answerCallbackQuery();
    state.step = 'notes';
    await setState(ctx.dbUser.id, state);
    await ctx.editMessageText(
      ctx.t('addmed.step8_notes'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('common.skip'), 'addmed:skip').row()
          .text(ctx.t('common.cancel'), 'addmed:cancel'),
      }
    );
    return true;
  }

  if (action === 'addmed:photos_more') {
    await ctx.answerCallbackQuery(ctx.t('addmed.step7_send'));
    return true;
  }

  // --- "For whom?" profile selection (#47) ---
  if (action.startsWith('addmed:profile:')) {
    const profileId = action.replace('addmed:profile:', '');
    await ctx.answerCallbackQuery();
    state.data.profileId = profileId === 'none' ? null : profileId;
    state.step = 'confirm';
    await setState(ctx.dbUser.id, state);
    await sendConfirmation(ctx, state);
    return true;
  }

  // #12 Edit from preview — go back to step 1 (name), preserving all data
  if (action === 'addmed:edit') {
    await ctx.answerCallbackQuery();
    state.step = 'name';
    await setState(ctx.dbUser.id, state);
    await editBotMsg(ctx, state,
      ctx.t('addmed.step1', { medkit: state.medkitName }),
      new InlineKeyboard()
        .text(ctx.t('addmed.btn_from_templates'), `addmed:templates:${state.medkitId}`).row()
        .text(ctx.t('common.cancel'), 'addmed:cancel')
    );
    return true;
  }

  // --- Confirm / Reject ---
  if (action === 'addmed:confirm') {
    await ctx.answerCallbackQuery();
    // #15 Remember last category on save (covers auto-category case too)
    if (state.data.category) {
      await supabase.from('sessions').upsert(
        { key: `lastCategory:${ctx.dbUser.id}`, value: state.data.category, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    }
    // #67 Retry for critical medicine creation
    const medicine = await withRetry(() => createMedicine(state.data));
    await logAction(ctx.dbUser.id, 'create', 'medicine', medicine.id, { name: state.data.name });
    await checkAchievements(ctx, 'medicine_added');
    if (state.data.photoFileIds && state.data.photoFileIds.length > 0) {
      await checkAchievements(ctx, 'photo_added');
    }
    const fromOnboarding = state.fromOnboarding;
    const medkitId = state.medkitId;
    await clearState(ctx.dbUser.id);

    if (fromOnboarding) {
      await ctx.editMessageText(
        ctx.t('onboarding_success', { name: state.data.name }),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(ctx.t('common.to_medkits'), 'medkits')
            .text(ctx.t('common.to_settings'), 'settings')
            .row()
            .text(ctx.t('common.to_help'), 'help')
            .text(ctx.t('common.main_menu'), 'main_menu'),
        }
      );
    } else {
      // #39 Suggest schedule after adding medicine
      await ctx.editMessageText(
        ctx.t('addmed.success', { name: state.data.name }) + '\n\n' + ctx.t('medicine.suggest_schedule'),
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text(ctx.t('medicine.btn_yes_schedule'), `sched:${medicine.id}:create`)
            .text(ctx.t('medicine.btn_no_schedule'), `addmed:sched_dismiss:${medicine.id}:${medkitId}`)
            .row()
            .text(ctx.t('addmed.btn_open'), `med:${medicine.id}`)
            .text(ctx.t('common.add_more'), `medkit:${medkitId}:add`)
            .row()
            .text(ctx.t('medkit.btn_to_medkit'), `medkit:${medkitId}`),
        }
      );
    }
    return true;
  }

  if (action === 'addmed:reject') {
    const fromOnboarding = state.fromOnboarding;
    const medkitId = state.medkitId;
    await clearState(ctx.dbUser.id);
    await ctx.answerCallbackQuery(ctx.t('common.cancelled'));
    if (fromOnboarding) {
      await ctx.editMessageText(
        ctx.t('addmed.skip_onboarding_short'),
        {
          reply_markup: new InlineKeyboard()
            .text(ctx.t('common.to_medkits'), 'medkits')
            .text(ctx.t('common.to_settings'), 'settings')
            .row()
            .text(ctx.t('common.to_help'), 'help')
            .text(ctx.t('common.main_menu'), 'main_menu'),
        }
      );
    } else {
      await ctx.editMessageText(ctx.t('addmed.cancel_done'), {
        reply_markup: new InlineKeyboard().text(ctx.t('medkit.btn_to_medkit'), `medkit:${medkitId}`),
      });
    }
    return true;
  }

  return false;
}

// ============================================================
// STEP ADVANCE (skip)
// ============================================================

async function advanceStep(ctx, state) {
  const { step } = state;

  if (step === 'dosage_unit' || step === 'dosage_value' || step === 'dosage_custom') {
    // #33 Skip category step if auto-detected
    if (state.autoCategory) {
      state.step = 'tags';
      await setState(ctx.dbUser.id, state);
      await sendTagsPrompt(ctx, state, true);
    } else {
      state.step = 'category';
      await setState(ctx.dbUser.id, state);
      await sendCategoryPicker(ctx, state);
    }
  } else if (step === 'category' || step === 'category_custom') {
    state.step = 'tags';
    await setState(ctx.dbUser.id, state);
    await sendTagsPrompt(ctx, state);
  } else if (step === 'tags') {
    state.step = 'expiry_year';
    await setState(ctx.dbUser.id, state);
    await sendExpiryYearPicker(ctx, state);
  } else if (step.startsWith('expiry')) {
    state.step = 'quantity';
    await setState(ctx.dbUser.id, state);
    await sendQuantityPrompt(ctx, state);
  } else if (step === 'quantity' || step === 'quantity_unit') {
    state.step = 'photos';
    await setState(ctx.dbUser.id, state);
    await sendPhotosPrompt(ctx, state);
  } else if (step === 'photos') {
    state.step = 'notes';
    await setState(ctx.dbUser.id, state);
    await sendNotesPrompt(ctx, state);
  } else if (step === 'notes') {
    // #47 "For whom?" step before confirm
    state.step = 'for_whom';
    await setState(ctx.dbUser.id, state);
    const shown = await showForWhomPicker(ctx, state);
    if (!shown) {
      state.step = 'confirm';
      await setState(ctx.dbUser.id, state);
      await sendConfirmation(ctx, state);
    }
  } else if (step === 'for_whom') {
    // Skip profile selection — go to confirm
    state.step = 'confirm';
    await setState(ctx.dbUser.id, state);
    await sendConfirmation(ctx, state);
  }
  return true;
}

/**
 * #13 Re-show the current wizard step after cancel was declined
 */
async function resendCurrentStep(ctx, state) {
  const { step } = state;
  const cancelKb = new InlineKeyboard()
    .text(ctx.t('common.skip'), 'addmed:skip').row()
    .text(ctx.t('common.cancel'), 'addmed:cancel');

  if (step === 'name' || step === 'name_duplicate') {
    const nameKb = new InlineKeyboard()
      .text(ctx.t('addmed.btn_from_templates'), `addmed:templates:${state.medkitId}`).row()
      .text(ctx.t('common.cancel'), 'addmed:cancel');
    await ctx.editMessageText(
      ctx.t('addmed.step1', { medkit: state.medkitName }),
      { parse_mode: 'Markdown', reply_markup: nameKb }
    );
  } else if (step === 'hint_confirm') {
    // Re-show hint from history
    const match = state.hintMatch;
    if (match) {
      const hintKb = new InlineKeyboard()
        .text(ctx.t('addmed.btn_use_hint'), 'addmed:hint_yes')
        .text(ctx.t('addmed.btn_enter_manual'), 'addmed:hint_no');
      await ctx.editMessageText(
        ctx.t('addmed.hint_from_history', {
          name: `${match.name}${match.dosage ? ' ' + match.dosage : ''}`,
          category: match.category || '—',
        }),
        { parse_mode: 'Markdown', reply_markup: hintKb }
      );
    } else {
      // Fallback to dosage step
      await sendDosageUnitPicker(ctx, state);
    }
  } else if (step === 'template_pick') {
    // Re-trigger templates listing
    state.step = 'name';
    await setState(ctx.dbUser.id, state);
    const nameKb = new InlineKeyboard()
      .text(ctx.t('addmed.btn_from_templates'), `addmed:templates:${state.medkitId}`).row()
      .text(ctx.t('common.cancel'), 'addmed:cancel');
    await ctx.editMessageText(
      ctx.t('addmed.step1', { medkit: state.medkitName }),
      { parse_mode: 'Markdown', reply_markup: nameKb }
    );
  } else if (step === 'expiry_past_confirm') {
    await ctx.editMessageText(
      ctx.t('medicine.expiry_in_past'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text(ctx.t('medicine.btn_continue'), 'addmed:expiry_past_ok')
          .text(ctx.t('medicine.btn_enter_another'), 'addmed:expiry_past_reenter'),
      }
    );
  } else if (step === 'dosage_unit') {
    await sendDosageUnitPicker(ctx, state);
  } else if (step === 'dosage_value') {
    await ctx.editMessageText(
      ctx.t('addmed.step2_value', { unit: state.dosageUnit }),
      { parse_mode: 'Markdown', reply_markup: cancelKb }
    );
  } else if (step === 'dosage_custom') {
    await ctx.editMessageText(
      ctx.t('addmed.step2_custom'),
      { parse_mode: 'Markdown', reply_markup: cancelKb }
    );
  } else if (step === 'category') {
    await sendCategoryPicker(ctx, state);
  } else if (step === 'category_custom') {
    await ctx.editMessageText(
      ctx.t('addmed.step3_custom'),
      { parse_mode: 'Markdown', reply_markup: cancelKb }
    );
  } else if (step === 'tags') {
    await sendTagsPrompt(ctx, state);
  } else if (step === 'expiry_year') {
    await sendExpiryYearPicker(ctx, state);
  } else if (step === 'expiry_month') {
    await sendExpiryMonthPicker(ctx, state.expiryYear);
  } else if (step === 'expiry_day') {
    await sendExpiryDayPicker(ctx, state.expiryYear, state.expiryMonth);
  } else if (step === 'quantity') {
    await sendQuantityPrompt(ctx, state);
  } else if (step === 'quantity_unit') {
    await sendQuantityUnitPicker(ctx, state);
  } else if (step === 'photos') {
    await sendPhotosPrompt(ctx, state);
  } else if (step === 'notes') {
    await sendNotesPrompt(ctx, state);
  } else if (step === 'for_whom') {
    const shown = await showForWhomPicker(ctx, state);
    if (!shown) {
      state.step = 'confirm';
      await setState(ctx.dbUser.id, state);
      await sendConfirmation(ctx, state);
    }
  } else if (step === 'confirm') {
    await sendConfirmation(ctx, state);
  }
}

// ============================================================
// PROMPT SENDERS — all edit the single bot message
// ============================================================

async function sendDosageUnitPicker(ctx, state) {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < DOSAGE_UNITS.length; i += 3) {
    keyboard.text(DOSAGE_UNITS[i].label, `addmed:dosunit:${DOSAGE_UNITS[i].value}`);
    if (DOSAGE_UNITS[i + 1]) keyboard.text(DOSAGE_UNITS[i + 1].label, `addmed:dosunit:${DOSAGE_UNITS[i + 1].value}`);
    if (DOSAGE_UNITS[i + 2]) keyboard.text(DOSAGE_UNITS[i + 2].label, `addmed:dosunit:${DOSAGE_UNITS[i + 2].value}`);
    keyboard.row();
  }
  keyboard.text(ctx.t('common.skip'), 'addmed:skip').row();
  keyboard.text(ctx.t('common.cancel'), 'addmed:cancel');
  await editBotMsg(ctx, state, ctx.t('addmed.step2_unit'), keyboard);
}

async function sendCategoryPicker(ctx, state) {
  // #15 Fetch last used category and reorder list
  const { data: lastCatData } = await supabase
    .from('sessions')
    .select('value')
    .eq('key', `lastCategory:${ctx.dbUser.id}`)
    .single();
  const lastCat = lastCatData?.value;

  let categories = [...CATEGORIES];
  if (lastCat && categories.includes(lastCat)) {
    categories = [lastCat, ...categories.filter(c => c !== lastCat)];
  }

  const keyboard = new InlineKeyboard();
  for (let i = 0; i < categories.length; i += 2) {
    const label1 = (categories[i] === lastCat)
      ? `${categories[i]} ${ctx.t('addmed.last_category')}`
      : categories[i];
    keyboard.text(label1, `addmed:cat:${categories[i]}`);
    if (categories[i + 1]) {
      const label2 = (categories[i + 1] === lastCat)
        ? `${categories[i + 1]} ${ctx.t('addmed.last_category')}`
        : categories[i + 1];
      keyboard.text(label2, `addmed:cat:${categories[i + 1]}`);
    }
    keyboard.row();
  }
  keyboard.text(ctx.t('addmed.btn_custom_category'), 'addmed:cat_custom').row();
  keyboard.text(ctx.t('common.skip'), 'addmed:skip').row();
  keyboard.text(ctx.t('common.cancel'), 'addmed:cancel');
  await editBotMsg(ctx, state, ctx.t('addmed.step3_category'), keyboard);
}

async function sendTagsPrompt(ctx, state, showAutoCategory = false) {
  let text = '';
  if (showAutoCategory && state.autoCategory && state.data.category) {
    text += ctx.t('addmed.auto_category', { category: state.data.category }) + '\n\n';
  }
  text += ctx.t('addmed.step4_tags');
  const kb = new InlineKeyboard()
    .text(ctx.t('common.skip'), 'addmed:skip').row()
    .text(ctx.t('common.cancel'), 'addmed:cancel');
  await editBotMsg(ctx, state, text, kb);
}

async function sendExpiryYearPicker(ctx, state) {
  const currentYear = new Date().getFullYear();
  const keyboard = new InlineKeyboard();
  for (let y = currentYear; y <= currentYear + 7; y += 2) {
    keyboard.text(String(y), `addmed:eyear:${y}`);
    if (y + 1 <= currentYear + 7) keyboard.text(String(y + 1), `addmed:eyear:${y + 1}`);
    keyboard.row();
  }
  keyboard.text(ctx.t('common.skip'), 'addmed:skip').row();
  keyboard.text(ctx.t('common.cancel'), 'addmed:cancel');
  await editBotMsg(ctx, state, ctx.t('addmed.step5_year'), keyboard);
}

async function sendExpiryMonthPicker(ctx, year) {
  const months = ctx.t('addmed.months_short');
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < 12; i += 4) {
    for (let j = i; j < i + 4 && j < 12; j++) {
      keyboard.text(months[j], `addmed:emonth:${j + 1}`);
    }
    keyboard.row();
  }
  keyboard.text(ctx.t('common.skip'), 'addmed:skip').row();
  keyboard.text(ctx.t('common.cancel'), 'addmed:cancel');
  await ctx.editMessageText(ctx.t('addmed.step5_month', { year }), {
    parse_mode: 'Markdown', reply_markup: keyboard,
  });
}

async function sendExpiryDayPicker(ctx, year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const months = ctx.t('addmed.months_short');
  const monthName = months[month - 1];
  const keyboard = new InlineKeyboard();
  keyboard.text(ctx.t('addmed.step5_month_only', { month: monthName, year }), 'addmed:emonth_only').row();
  for (let d = 1; d <= daysInMonth; d += 7) {
    for (let j = d; j < d + 7 && j <= daysInMonth; j++) {
      keyboard.text(String(j), `addmed:eday:${j}`);
    }
    keyboard.row();
  }
  keyboard.text(ctx.t('common.cancel'), 'addmed:cancel');
  await ctx.editMessageText(ctx.t('addmed.step5_day', { month: monthName, year }), {
    parse_mode: 'Markdown', reply_markup: keyboard,
  });
}

async function sendQuantityPrompt(ctx, state) {
  const kb = new InlineKeyboard()
    .text(ctx.t('common.skip'), 'addmed:skip').row()
    .text(ctx.t('common.cancel'), 'addmed:cancel');
  await editBotMsg(ctx, state, ctx.t('addmed.step6_quantity'), kb);
}

async function sendQuantityUnitPicker(ctx, state) {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < QUANTITY_UNITS.length; i += 3) {
    keyboard.text(QUANTITY_UNITS[i].label, `addmed:qunit:${QUANTITY_UNITS[i].value}`);
    if (QUANTITY_UNITS[i + 1]) keyboard.text(QUANTITY_UNITS[i + 1].label, `addmed:qunit:${QUANTITY_UNITS[i + 1].value}`);
    if (QUANTITY_UNITS[i + 2]) keyboard.text(QUANTITY_UNITS[i + 2].label, `addmed:qunit:${QUANTITY_UNITS[i + 2].value}`);
    keyboard.row();
  }
  await editBotMsg(ctx, state, ctx.t('addmed.step6_unit'), keyboard);
}

async function sendPhotosPrompt(ctx, state) {
  const kb = new InlineKeyboard()
    .text(ctx.t('common.skip'), 'addmed:skip').row()
    .text(ctx.t('common.cancel'), 'addmed:cancel');
  await editBotMsg(ctx, state, ctx.t('addmed.step7_photos', { max: MAX_PHOTOS }), kb);
}

async function sendNotesPrompt(ctx, state) {
  const kb = new InlineKeyboard()
    .text(ctx.t('common.skip'), 'addmed:skip').row()
    .text(ctx.t('common.cancel'), 'addmed:cancel');
  await editBotMsg(ctx, state, ctx.t('addmed.step8_notes'), kb);
}

async function sendConfirmation(ctx, state) {
  const d = state.data;
  let s = ctx.t('addmed.confirm_title') + '\n\n';
  s += ctx.t('addmed.confirm_name', { value: d.name }) + '\n';
  if (d.dosage) s += ctx.t('addmed.confirm_dosage', { value: d.dosage }) + '\n';
  if (d.category) s += ctx.t('addmed.confirm_category', { value: d.category }) + '\n';
  if (d.tags.length > 0) s += ctx.t('addmed.confirm_tags', { value: d.tags.join(', ') }) + '\n';
  if (d.expiryDate) s += ctx.t('addmed.confirm_expiry', { value: formatDate(d.expiryDate) }) + '\n';
  s += ctx.t('addmed.confirm_quantity', { value: formatQuantity(d.quantity, d.quantityUnit) }) + '\n';
  if (d.photoFileIds.length > 0) s += ctx.t('addmed.confirm_photos', { value: ctx.t('addmed.photos_count', { count: d.photoFileIds.length }) }) + '\n';
  if (d.notes) s += ctx.t('addmed.confirm_notes', { value: d.notes }) + '\n';

  const kb = new InlineKeyboard()
    .text(ctx.t('common.save'), 'addmed:confirm')
    .text(ctx.t('addmed.btn_edit'), 'addmed:edit')
    .text(ctx.t('common.cancel'), 'addmed:reject');
  await editBotMsg(ctx, state, s, kb);
}
