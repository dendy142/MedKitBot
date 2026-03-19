import { InlineKeyboard } from 'grammy';

/** Back button */
export function backButton(callbackData, t) {
  return InlineKeyboard.text(t ? t('common.back') : '◀️ Назад', callbackData);
}

/** Cancel button */
export function cancelButton(t) {
  return InlineKeyboard.text(t ? t('common.cancel') : '❌ Отмена', 'cancel');
}

/** Back + Cancel row */
export function backCancelRow(backTo, t) {
  return new InlineKeyboard()
    .text(t ? t('common.back') : '◀️ Назад', backTo)
    .text(t ? t('common.cancel') : '❌ Отмена', 'cancel');
}

/** Yes/No confirmation */
export function confirmKeyboard(yesData, noData, t) {
  return new InlineKeyboard()
    .text(t ? t('common.yes') : '✅ Да', yesData)
    .text(t ? t('common.no') : '❌ Нет', noData);
}

/** Skip button */
export function skipButton(callbackData = 'skip', t) {
  return InlineKeyboard.text(t ? t('common.skip') : '⏭ Пропустить', callbackData);
}
