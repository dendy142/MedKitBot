import 'dotenv/config';
import { createBot } from './bot.js';

const bot = createBot();

// Start in long polling mode (for local development)
bot.start({
  onStart: (botInfo) => {
    console.log(`Bot @${botInfo.username} started in polling mode`);
  },
});
