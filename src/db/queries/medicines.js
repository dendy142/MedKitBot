import { supabase } from '../supabase.js';

/**
 * Create a new medicine
 */
export async function createMedicine(data) {
  const { data: medicine, error } = await supabase
    .from('medicines')
    .insert({
      medkit_id: data.medkitId,
      name: data.name,
      dosage: data.dosage || null,
      category: data.category || null,
      tags: data.tags || [],
      expiry_date: data.expiryDate || null,
      quantity: data.quantity || 0,
      quantity_unit: data.quantityUnit || 'шт',
      initial_quantity: data.quantity || 0,
      photo_file_ids: data.photoFileIds || [],
      notes: data.notes || null,
      is_favorite: false,
      is_archived: false,
      version: 1,
    })
    .select()
    .single();

  if (error) throw error;
  return medicine;
}

/**
 * Get medicines in a medkit (excluding archived by default)
 */
export async function getMedkitMedicines(medkitId, { includeArchived = false, sortBy = 'name' } = {}) {
  let query = supabase
    .from('medicines')
    .select('*')
    .eq('medkit_id', medkitId);

  if (!includeArchived) {
    query = query.eq('is_archived', false);
  }

  // Sort: favorites first, then by selected field
  switch (sortBy) {
    case 'expiry':
      query = query.order('is_favorite', { ascending: false }).order('expiry_date', { ascending: true, nullsFirst: false });
      break;
    case 'category':
      query = query.order('is_favorite', { ascending: false }).order('category', { ascending: true });
      break;
    case 'quantity':
      query = query.order('is_favorite', { ascending: false }).order('quantity', { ascending: true });
      break;
    case 'name':
    default:
      query = query.order('is_favorite', { ascending: false }).order('name', { ascending: true });
      break;
  }

  const { data } = await query;
  return data || [];
}

/**
 * Get a single medicine by ID
 */
export async function getMedicine(medicineId) {
  const { data } = await supabase
    .from('medicines')
    .select('*')
    .eq('id', medicineId)
    .single();
  return data;
}

/**
 * Update a medicine field
 */
export async function updateMedicine(medicineId, updates) {
  const { data, error } = await supabase
    .from('medicines')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', medicineId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Archive a medicine (soft-delete)
 */
export async function archiveMedicine(medicineId) {
  return updateMedicine(medicineId, { is_archived: true });
}

/**
 * Restore a medicine from archive
 */
export async function restoreMedicine(medicineId) {
  return updateMedicine(medicineId, { is_archived: false });
}

/**
 * Toggle favorite status
 */
export async function toggleFavorite(medicineId) {
  const medicine = await getMedicine(medicineId);
  if (!medicine) return null;
  return updateMedicine(medicineId, { is_favorite: !medicine.is_favorite });
}

/**
 * Search medicines across all user's medkits
 */
export async function searchMedicines(userId, query) {
  // Get user's medkit IDs
  const { data: memberships } = await supabase
    .from('medkit_members')
    .select('medkit_id')
    .eq('user_id', userId);

  if (!memberships || memberships.length === 0) return [];

  const medkitIds = memberships.map((m) => m.medkit_id);

  const { data } = await supabase
    .from('medicines')
    .select('*, medkits(name)')
    .in('medkit_id', medkitIds)
    .eq('is_archived', false)
    .ilike('name', `%${query}%`);

  return data || [];
}

/**
 * Get archived medicines in a medkit
 */
export async function getArchivedMedicines(medkitId) {
  const { data } = await supabase
    .from('medicines')
    .select('*')
    .eq('medkit_id', medkitId)
    .eq('is_archived', true)
    .order('updated_at', { ascending: false });
  return data || [];
}
