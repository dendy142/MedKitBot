import { supabase } from './supabase.js';

/**
 * Supabase-backed storage for grammY conversations plugin v2.
 * Implements VersionedStateStorage<string, S> interface.
 * Persists conversation state across serverless invocations.
 */
export function supabaseConversationStorage() {
  return {
    async read(key) {
      const { data } = await supabase
        .from('sessions')
        .select('value')
        .eq('key', `conv:${key}`)
        .single();
      return data?.value ?? undefined;
    },

    async write(key, value) {
      await supabase
        .from('sessions')
        .upsert(
          { key: `conv:${key}`, value, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
    },

    async delete(key) {
      await supabase
        .from('sessions')
        .delete()
        .eq('key', `conv:${key}`);
    },
  };
}

/**
 * Supabase-backed session storage for grammY session middleware.
 */
export function supabaseSessionStorage() {
  return {
    async read(key) {
      const { data } = await supabase
        .from('sessions')
        .select('value')
        .eq('key', `sess:${key}`)
        .single();
      return data?.value ?? undefined;
    },

    async write(key, value) {
      await supabase
        .from('sessions')
        .upsert(
          { key: `sess:${key}`, value, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
    },

    async delete(key) {
      await supabase
        .from('sessions')
        .delete()
        .eq('key', `sess:${key}`);
    },
  };
}
