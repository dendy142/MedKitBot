/**
 * Format a date for display based on user settings
 */
export function formatDate(date, format = 'DD.MM.YYYY') {
  if (!date) return '—';
  const d = new Date(date);

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();

  const months = [
    'янв.', 'фев.', 'мар.', 'апр.', 'мая', 'июн.',
    'июл.', 'авг.', 'сен.', 'окт.', 'ноя.', 'дек.',
  ];

  switch (format) {
    case 'MM.YYYY':
      return `${month}.${year}`;
    case 'DD мес. YYYY':
      return `${day} ${months[d.getMonth()]} ${year}`;
    case 'DD.MM.YYYY':
    default:
      return `${day}.${month}.${year}`;
  }
}

/**
 * Calculate days until a date (positive = in the future)
 */
export function daysUntil(date) {
  if (!date) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

/**
 * Get status emoji for a medicine based on expiry and quantity
 */
export function medicineStatusEmoji(medicine, thresholds) {
  const days = daysUntil(medicine.expiry_date);

  // Expired
  if (days !== null && days <= 0) return '❌';

  // Expiring soon
  if (days !== null && days <= (thresholds?.expiry_days || 30)) return '⚠️';

  // Low stock
  const lowCount = thresholds?.low_stock_count || 5;
  const lowPercent = thresholds?.low_stock_percent || 20;
  if (medicine.quantity <= lowCount) return '📉';
  if (medicine.initial_quantity > 0 && (medicine.quantity / medicine.initial_quantity) * 100 <= lowPercent) return '📉';

  return '✅';
}

/**
 * Format quantity with unit
 */
export function formatQuantity(quantity, unit) {
  // Short unit labels
  const unitMap = {
    'таблетки': 'табл.',
    'капсулы': 'капс.',
    'мл': 'мл',
    'капли': 'кап.',
    'ампулы': 'амп.',
    'пакетики': 'пак.',
    'шт': 'шт.',
  };
  return `${quantity} ${unitMap[unit] || unit}`;
}

/**
 * Format expiry info for display
 */
export function formatExpiry(expiryDate, dateFormat) {
  if (!expiryDate) return 'не указан';
  const days = daysUntil(expiryDate);
  const formatted = formatDate(expiryDate, dateFormat);

  if (days <= 0) return `${formatted} (ПРОСРОЧЕНО)`;
  if (days <= 30) return `${formatted} (осталось ${days} дн.)`;
  return `${formatted} (осталось ${days} дн.)`;
}

/**
 * Build a breadcrumb string: "🏠 Аптечка › Лекарство"
 */
export function breadcrumb(...parts) {
  return parts.filter(Boolean).join(' › ');
}

/**
 * Russian pluralization.
 * pluralize(5, 'таблетка', 'таблетки', 'таблеток') → 'таблеток'
 */
export function pluralize(n, one, few, many) {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Relative date string: "сегодня", "вчера", "3 дня назад", "через 5 дней"
 */
export function relativeDate(date) {
  if (!date) return '—';
  const days = daysUntil(date);
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  if (days === -1) return 'вчера';
  if (days > 1) return `через ${days} ${pluralize(days, 'день', 'дня', 'дней')}`;
  const absDays = Math.abs(days);
  return `${absDays} ${pluralize(absDays, 'день', 'дня', 'дней')} назад`;
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str, maxLen = 30) {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen - 1) + '…';
}

/**
 * Progress bar: ████░░░░░░ 40%
 */
export function progressBar(current, total, width = 10) {
  if (!total || total <= 0) return '';
  const ratio = Math.min(current / total, 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const percent = Math.round(ratio * 100);
  return '█'.repeat(filled) + '░'.repeat(empty) + ` ${percent}%`;
}

/**
 * Parse date from user input (supports MM.YYYY and DD.MM.YYYY)
 * Returns Date or null
 */
export function parseDate(input) {
  if (!input) return null;
  const trimmed = input.trim();

  // DD.MM.YYYY
  const full = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (full) {
    const [, day, month, year] = full;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    if (!isNaN(d.getTime())) return d;
  }

  // MM.YYYY
  const short = trimmed.match(/^(\d{1,2})\.(\d{4})$/);
  if (short) {
    const [, month, year] = short;
    // Last day of the month
    const d = new Date(Number(year), Number(month), 0);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}
