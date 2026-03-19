import { supabase } from '../db/supabase.js';
import { DEFAULT_SETTINGS } from '../config.js';
import { createT } from '../locales/index.js';
import { log } from '../utils/logger.js';

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
        log('error', { action: 'create_user', error: error.message });
        return next();
      }

      user = newUser;
      ctx.isNewUser = true;
    } else {
      // Run independent queries in parallel for performance
      const updates = { last_active_at: new Date().toISOString() };
      if (user.username !== ctx.from.username) updates.username = ctx.from.username || null;
      if (user.first_name !== ctx.from.first_name) updates.first_name = ctx.from.first_name || null;

      const promises = [
        // Check if user completed onboarding (has at least one medkit)
        supabase
          .from('medkit_members')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id),
        // Update username/first_name/last_active_at (#89)
        supabase
          .from('users')
          .update(updates)
          .eq('id', user.id),
      ];
      // #66 Session cleanup — run probabilistically (~5% of requests) to avoid unnecessary DB call
      if (Math.random() < 0.05) {
        promises.push(cleanExpiredSessions(user.id));
      }
      const [memberResult] = await Promise.all(promises);
      ctx.isNewUser = memberResult.count === 0;
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
