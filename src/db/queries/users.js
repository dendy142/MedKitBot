import { supabase } from '../supabase.js';

export async function getUserById(id) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single();
  return data;
}

export async function getUserByTelegramId(telegramId) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .single();
  return data;
}

export async function updateUserSettings(userId, settings) {
  const { data } = await supabase
    .from('users')
    .update({ settings })
    .eq('id', userId)
    .select()
    .single();
  return data;
}

export async function updateUserTimezone(userId, timezone) {
  const { data } = await supabase
    .from('users')
    .update({ timezone })
    .eq('id', userId)
    .select()
    .single();
  return data;
}
