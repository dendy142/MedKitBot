import { supabase } from '../db/supabase.js';
import { DEFAULT_SETTINGS } from '../config.js';
import { createT } from '../locales/index.js';

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

      // Update username/first_name if changed
      if (user.username !== ctx.from.username || user.first_name !== ctx.from.first_name) {
        await supabase
          .from('users')
          .update({
            username: ctx.from.username || null,
            first_name: ctx.from.first_name || null,
          })
          .eq('id', user.id);
      }
    }

    ctx.dbUser = user;
    ctx.t = createT(user.language || 'ru');
    return next();
  };
}
