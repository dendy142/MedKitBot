import { webhookCallback } from 'grammy';
import { createBot } from '../src/bot.js';

// Create bot instance (reused across invocations in same container)
let bot;
let handleUpdate;

function getHandler() {
  if (!handleUpdate) {
    bot = createBot();
    handleUpdate = webhookCallback(bot, 'http');
  }
  return handleUpdate;
}

export default async function handler(req, res) {
  try {
    const h = getHandler();
    await h(req, res);
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).json({ ok: true });
  }
}
