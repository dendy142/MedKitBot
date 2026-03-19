import { InlineKeyboard } from 'grammy';

export function mainMenuKeyboard(t) {
  return new InlineKeyboard()
    .text(t('menu.btn_intake_today'), 'intake_today')
    .text(t('menu.btn_add_medicine'), 'addmed:choose_medkit')
    .row()
    .text(t('menu.btn_medkits'), 'medkits')
    .text(t('menu.btn_intake'), 'intake_today')
    .row()
    .text(t('menu.btn_shopping'), 'shopping')
    .text(t('menu.btn_search'), 'search')
    .row()
    .text(t('menu.btn_stats'), 'stats')
    .text(t('menu.btn_settings'), 'settings');
}
