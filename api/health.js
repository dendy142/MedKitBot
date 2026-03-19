/**
 * #80 Health check endpoint.
 * GET /api/health → { status: 'ok', db: 'connected', timestamp }
 */

import { supabase } from '../src/db/supabase.js';

export default async function handler(req, res) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .limit(1);

    if (error) {
      return res.status(503).json({
        status: 'error',
        db: 'disconnected',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(200).json({
      status: 'ok',
      db: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(503).json({
      status: 'error',
      db: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
}
