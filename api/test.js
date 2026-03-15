import { createBot } from '../src/bot.js';

export default async function handler(req, res) {
  try {
    const bot = createBot();
    // Try to send a test message
    const me = await bot.api.getMe();
    res.json({ ok: true, bot: me });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
      stack: error.stack
    });
  }
}
