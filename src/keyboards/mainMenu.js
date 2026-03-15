import { InlineKeyboard } from 'grammy';

export function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text('📦 Аптечки', 'medkits')
    .text('💊 Приём', 'intake_today')
    .row()
    .text('🛒 Покупки', 'shopping')
    .text('🔍 Поиск', 'search')
    .row()
    .text('📊 Статистика', 'stats')
    .text('⚙️ Настройки', 'settings');
}
