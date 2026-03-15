import { InlineKeyboard } from 'grammy';

/** Back button */
export function backButton(callbackData) {
  return InlineKeyboard.text('◀️ Назад', callbackData);
}

/** Cancel button */
export function cancelButton() {
  return InlineKeyboard.text('❌ Отмена', 'cancel');
}

/** Back + Cancel row */
export function backCancelRow(backTo) {
  return new InlineKeyboard()
    .text('◀️ Назад', backTo)
    .text('❌ Отмена', 'cancel');
}

/** Yes/No confirmation */
export function confirmKeyboard(yesData, noData) {
  return new InlineKeyboard()
    .text('✅ Да', yesData)
    .text('❌ Нет', noData);
}

/** Skip button */
export function skipButton(callbackData = 'skip') {
  return InlineKeyboard.text('⏭ Пропустить', callbackData);
}
