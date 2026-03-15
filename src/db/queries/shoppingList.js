import { supabase } from '../supabase.js';

/**
 * Add item to shopping list
 */
export async function addToShoppingList(userId, name, medicineId = null, medkitId = null) {
  const { data, error } = await supabase
    .from('shopping_list')
    .insert({
      user_id: userId,
      medicine_id: medicineId,
      medkit_id: medkitId,
      name,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get user's shopping list
 */
export async function getShoppingList(userId, medkitId = null) {
  let query = supabase
    .from('shopping_list')
    .select('*, medkits(name)')
    .eq('user_id', userId)
    .eq('is_bought', false)
    .order('created_at', { ascending: false });

  if (medkitId) {
    query = query.eq('medkit_id', medkitId);
  }

  const { data } = await query;
  return data || [];
}

/**
 * Mark item as bought
 */
export async function markAsBought(itemId) {
  const { data, error } = await supabase
    .from('shopping_list')
    .update({ is_bought: true })
    .eq('id', itemId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Remove item from shopping list
 */
export async function removeFromShoppingList(itemId) {
  const { error } = await supabase
    .from('shopping_list')
    .delete()
    .eq('id', itemId);
  if (error) throw error;
}

/**
 * Count unbought items
 */
export async function countShoppingItems(userId) {
  const { count } = await supabase
    .from('shopping_list')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_bought', false);
  return count || 0;
}
