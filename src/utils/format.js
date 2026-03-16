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
 * Format expiry info for display.
 * Only shows "осталось N дн." when within threshold (default 30 days).
 */
export function formatExpiry(expiryDate, dateFormat, thresholdDays = 30) {
  if (!expiryDate) return 'не указан';
  const days = daysUntil(expiryDate);
  const formatted = formatDate(expiryDate, dateFormat);

  if (days <= 0) return `${formatted} (ПРОСРОЧЕНО)`;
  if (days <= thresholdDays) return `${formatted} (осталось ${days} дн.)`;
  return formatted;
}

/**
 * Visual progress bar using block characters.
 * @param {number} current - current value
 * @param {number} total - total value
 * @param {number} width - bar width in characters (default 10)
 * @returns {string} e.g. "██████░░░░"
 */
export function formatProgressBar(current, total, width = 10) {
  if (total <= 0) return '░'.repeat(width);
  const ratio = Math.max(0, Math.min(1, current / total));
  const filled = Math.round(ratio * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
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
