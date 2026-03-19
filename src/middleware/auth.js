import { supabase } from '../db/supabase.js';
import { DEFAULT_SETTINGS } from '../config.js';
import { createT } from '../locales/index.js';

const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Middleware: ensures user exists in DB, attaches user data to ctx.dbUser
 */
export function authMiddleware() {
  return async (ctx, next) => {
    if (!ctx.from) return next();

    const telegramId = ctx.from.id;

    // Try to find existing user
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (!user) {
      // Create new user
      const { data: newUser, error } = await supabase
        .from('users')
        .insert({
          telegram_id: telegramId,
          username: ctx.from.username || null,
          first_name: ctx.from.first_name || null,
          timezone: 'Europe/Moscow',
          settings: DEFAULT_SETTINGS,
          last_active_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating user:', error);
        return next();
      }

      user = newUser;
      ctx.isNewUser = true;
    } else {
      // Check if user completed onboarding (has at least one medkit)
      const { count } = await supabase
        .from('medkit_members')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);
      ctx.isNewUser = count === 0;

      // Update username/first_name if changed + always update last_active_at (#89)
      const updates = { last_active_at: new Date().toISOString() };
      if (user.username !== ctx.from.username) updates.username = ctx.from.username || null;
      if (user.first_name !== ctx.from.first_name) updates.first_name = ctx.from.first_name || null;
      await supabase
        .from('users')
        .update(updates)
        .eq('id', user.id);

      // #66 Session timeout — check and clean expired sessions
      await cleanExpiredSessions(user.id);
    }

    ctx.dbUser = user;
    ctx.t = createT(user.language || 'ru');
    return next();
  };
}

/**
 * #66 Delete sessions older than 24 hours for this user.
 */
async function cleanExpiredSessions(userId) {
  try {
    const cutoff = new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString();
    await supabase
      .from('sessions')
      .delete()
      .in('key', [`addmed:${userId}`, `state:${userId}`])
      .lt('updated_at', cutoff);
  } catch { /* ignore cleanup errors */ }
}
