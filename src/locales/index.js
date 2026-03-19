// i18n infrastructure — locale loader and t() function

import ru from './ru.js';

const locales = { ru };

/**
 * Translate a key to the given language.
 * Supports nested keys: 'menu.title', 'medicine.add_prompt'
 * Supports parameter substitution: t('intake.taken_count', 'ru', { count: 5 })
 * Falls back to key itself if not found.
 *
 * @param {string} key - Dot-separated key path
 * @param {string} [lang='ru'] - Language code
 * @param {object} [params={}] - Substitution parameters
 * @returns {string}
 */
export function t(key, lang = 'ru', params = {}) {
  const locale = locales[lang] || locales.ru;
  const keys = key.split('.');
  let val = locale;
  for (const k of keys) {
    val = val?.[k];
    if (val === undefined) break;
  }
  if (typeof val !== 'string') return key; // fallback — show the key
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) {
      val = val.replaceAll(`{${k}}`, String(v));
    }
  }
  return val;
}

/**
 * Create a bound translate function for a specific language.
 * Used in middleware: ctx.t = createT('ru')
 *
 * @param {string} lang
 * @returns {(key: string, params?: object) => string}
 */
export function createT(lang = 'ru') {
  return (key, params) => t(key, lang, params);
}

/**
 * Get list of available language codes.
 * @returns {string[]}
 */
export function getAvailableLanguages() {
  return Object.keys(locales);
}
