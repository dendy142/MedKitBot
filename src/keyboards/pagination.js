import { InlineKeyboard } from 'grammy';
import { PAGE_SIZE } from '../config.js';

/**
 * Add pagination buttons to a keyboard
 * @param {InlineKeyboard} keyboard - existing keyboard to add pagination to
 * @param {number} currentPage - current page (0-based)
 * @param {number} totalItems - total number of items
 * @param {string} prefix - callback data prefix (e.g. 'medkit_list')
 * @returns {InlineKeyboard}
 */
export function addPagination(keyboard, currentPage, totalItems, prefix) {
  const totalPages = Math.ceil(totalItems / PAGE_SIZE);

  if (totalPages <= 1) return keyboard;

  keyboard.row();

  if (currentPage > 0) {
    keyboard.text('◀️', `${prefix}:page:${currentPage - 1}`);
  }

  keyboard.text(`${currentPage + 1}/${totalPages}`, 'noop');

  if (currentPage < totalPages - 1) {
    keyboard.text('▶️', `${prefix}:page:${currentPage + 1}`);
  }

  return keyboard;
}

/**
 * Get paginated slice of items
 */
export function paginateItems(items, page) {
  const start = page * PAGE_SIZE;
  return items.slice(start, start + PAGE_SIZE);
}
