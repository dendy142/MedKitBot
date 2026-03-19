// Environment variables and constants

export const BOT_TOKEN = process.env.BOT_TOKEN;
export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
export const CRON_SECRET = process.env.CRON_SECRET;

// Default settings for new users
export const DEFAULT_SETTINGS = {
  day_periods: {
    morning: '08:00',
    afternoon: '13:00',
    evening: '19:00',
    night: '22:00',
  },
  notifications: {
    intake_reminders: true,
    expiry_alerts: true,
    low_stock_alerts: true,
    shared_medkit_changes: true,
  },
  thresholds: {
    expiry_days: 30,
    low_stock_count: 5,
    low_stock_percent: 20,
  },
  digest: {
    enabled: false,
    time: '08:00',
    type: 'morning',
    include: ['intakes', 'expiry', 'low_stock'],
    days: 'daily',
  },
  quiet_hours: {
    enabled: false,
    from: '23:00',
    to: '07:00',
  },
  autoShoppingList: false,
  weeklyReport: false,
  showTips: true,
  inactivityReminder: true,
  display: {
    default_sort: 'name',
    date_format: 'DD.MM.YYYY',
  },
  menuLayout: 'default',
};

// Preset medicine categories
export const CATEGORIES = [
  'Обезболивающие',
  'Жаропонижающие',
  'Антибиотики',
  'Антигистаминные',
  'Витамины и БАДы',
  'Желудочно-кишечные',
  'Сердечно-сосудистые',
  'Наружные средства',
  'Прочее',
];

// Dosage units
export const DOSAGE_UNITS = [
  { value: 'мг', label: 'мг' },
  { value: 'г', label: 'г' },
  { value: 'мл', label: 'мл' },
  { value: 'мкг', label: 'мкг' },
  { value: 'МЕ', label: 'МЕ' },
  { value: '%', label: '%' },
  { value: 'капли', label: 'Капли' },
  { value: 'впрыскивания', label: 'Впрыскивания' },
  { value: 'пластыри', label: 'Пластыри' },
  { value: 'пакетики', label: 'Пакетики' },
  { value: 'мерные ложки', label: 'Мерные ложки' },
  { value: 'суппозитории', label: 'Суппозитории' },
  { value: 'другое', label: 'Другое' },
];

// Quantity units
export const QUANTITY_UNITS = [
  { value: 'таблетки', label: 'Таблетки' },
  { value: 'капсулы', label: 'Капсулы' },
  { value: 'мл', label: 'мл' },
  { value: 'капли', label: 'Капли' },
  { value: 'ампулы', label: 'Ампулы' },
  { value: 'пакетики', label: 'Пакетики' },
  { value: 'шт', label: 'Штуки' },
];

// Timezones (CIS region: UTC+2 to UTC+12)
export const TIMEZONES = [
  { value: 'Etc/GMT-2', label: 'UTC+2' },
  { value: 'Etc/GMT-3', label: 'UTC+3' },
  { value: 'Etc/GMT-4', label: 'UTC+4' },
  { value: 'Etc/GMT-5', label: 'UTC+5' },
  { value: 'Etc/GMT-6', label: 'UTC+6' },
  { value: 'Etc/GMT-7', label: 'UTC+7' },
  { value: 'Etc/GMT-8', label: 'UTC+8' },
  { value: 'Etc/GMT-9', label: 'UTC+9' },
  { value: 'Etc/GMT-10', label: 'UTC+10' },
  { value: 'Etc/GMT-11', label: 'UTC+11' },
  { value: 'Etc/GMT-12', label: 'UTC+12' },
];

// Emoji mapping for categories and statuses
export const EMOJI = {
  // Category emojis
  'Обезболивающие': '💊',
  'Жаропонижающие': '🌡️',
  'Антибиотики': '🦠',
  'Антигистаминные': '🤧',
  'Витамины и БАДы': '🍊',
  'Желудочно-кишечные': '🫄',
  'Сердечно-сосудистые': '❤️',
  'Наружные средства': '🧴',
  'Прочее': '📦',
  // Status emojis
  ok: '✅',
  warning: '⚠️',
  expired: '❌',
  low_stock: '📉',
  // Navigation
  back: '◀️',
  forward: '▶️',
  home: '🏠',
  settings: '⚙️',
  add: '➕',
  delete: '🗑️',
  edit: '✏️',
  search: '🔍',
  // Medkit
  medkit: '🧰',
  shared: '👥',
  // Other
  bell: '🔔',
  calendar: '📅',
  chart: '📊',
  shopping: '🛒',
  export: '📤',
  import: '📥',
  help: '❓',
  pin: '📌',
  star: '⭐',
  clock: '🕐',
  check: '☑️',
  uncheck: '⬜',
  arrow_right: '➡️',
  pill: '💊',
  photo: '📷',
};

// Keywords for auto-detecting medicine category
export const CATEGORY_KEYWORDS = {
  'Обезболивающие': [
    'ибупрофен', 'анальгин', 'нурофен', 'кетонал', 'кеторол',
    'найз', 'нимесулид', 'диклофенак', 'парацетамол', 'аспирин',
    'цитрамон', 'пенталгин', 'спазмалгон', 'но-шпа', 'дротаверин',
    'баралгин', 'темпалгин',
  ],
  'Жаропонижающие': [
    'парацетамол', 'ибупрофен', 'нурофен', 'панадол', 'эффералган',
    'колдрекс', 'терафлю', 'фервекс', 'антигриппин', 'ринза',
  ],
  'Антибиотики': [
    'амоксициллин', 'азитромицин', 'сумамед', 'аугментин', 'флемоксин',
    'цефтриаксон', 'ципрофлоксацин', 'левофлоксацин', 'доксициклин',
    'метронидазол', 'амоксиклав', 'кларитромицин',
  ],
  'Антигистаминные': [
    'супрастин', 'цетрин', 'зиртек', 'лоратадин', 'кларитин',
    'зодак', 'эриус', 'тавегил', 'фенистил', 'дезлоратадин',
    'цетиризин', 'левоцетиризин',
  ],
  'Витамины и БАДы': [
    'витамин', 'компливит', 'алфавит', 'супрадин', 'центрум',
    'омега', 'рыбий жир', 'кальций', 'магний', 'железо',
    'фолиевая', 'аскорбинка', 'аскорбиновая', 'д3', 'b12',
  ],
  'Желудочно-кишечные': [
    'мезим', 'панкреатин', 'фестал', 'смекта', 'энтеросгель',
    'активированный уголь', 'лоперамид', 'имодиум', 'мотилиум',
    'омепразол', 'омез', 'ранитидин', 'маалокс', 'фосфалюгель',
    'линекс', 'бифидумбактерин', 'хилак', 'эспумизан', 'гастал',
    'де-нол', 'креон',
  ],
  'Сердечно-сосудистые': [
    'валидол', 'корвалол', 'нитроглицерин', 'каптоприл', 'эналаприл',
    'лозартан', 'амлодипин', 'бисопролол', 'метопролол', 'аспирин кардио',
    'кардиомагнил', 'валокордин', 'валосердин', 'верапамил',
  ],
  'Наружные средства': [
    'йод', 'зеленка', 'перекись', 'хлоргексидин', 'мирамистин',
    'бинт', 'пластырь', 'вата', 'мазь', 'гель', 'крем',
    'левомеколь', 'спасатель', 'бепантен', 'пантенол', 'финалгон',
    'вольтарен', 'фастум', 'троксевазин',
  ],
};

// Achievement definitions (#90)
export const ACHIEVEMENTS = {
  first_medicine: { key: 'first_medicine' },
  streak_7: { key: 'streak_7' },
  streak_30: { key: 'streak_30' },
  medicines_10: { key: 'medicines_10' },
  shared_medkit: { key: 'shared_medkit' },
  month_with_bot: { key: 'month_with_bot' },
  all_taken_day: { key: 'all_taken_day' },
  first_profile: { key: 'first_profile' },
  photo_added: { key: 'photo_added' },
  full_week: { key: 'full_week' },
};

// Feature tips (#83) — tip keys for first 7 days
export const TIPS = ['tip_1', 'tip_2', 'tip_3', 'tip_4', 'tip_5', 'tip_6', 'tip_7'];

// Pagination
export const PAGE_SIZE = 8;

// Max photos per medicine
export const MAX_PHOTOS = 5;

// Max snooze reminders
export const MAX_SNOOZE = 2;
