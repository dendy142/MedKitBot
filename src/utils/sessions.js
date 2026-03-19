/**
 * #77 Clear all active sessions for a user.
 * Called on /start, /help, /cancel, main_menu to prevent dangling wizards.
 */

import { supabase } from '../db/supabase.js';

export async function clearUserSessions(userId) {
  if (!userId) return;
  try {
    await supabase
      .from('sessions')
      .delete()
      .in('key', [`addmed:${userId}`, `state:${userId}`]);
  } catch { /* ignore errors during cleanup */ }
}
