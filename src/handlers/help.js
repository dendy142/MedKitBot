import { InlineKeyboard } from 'grammy';

function buildHelpKeyboard(ctx) {
  return new InlineKeyboard()
    .text(ctx.t('help.btn_medkits'), 'medkits')
    .text(ctx.t('help.btn_intake'), 'intake_today')
    .row()
    .text(ctx.t('help.btn_shopping'), 'shopping')
    .text(ctx.t('help.btn_stats'), 'stats')
    .row()
    .text(ctx.t('common.main_menu'), 'main_menu');
}

export async function handleHelp(ctx) {
  const text = ctx.t('help.text');
  const keyboard = buildHelpKeyboard(ctx);
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}

export async function handleHelpCallback(ctx) {
  await ctx.answerCallbackQuery();
  await handleHelp(ctx);
}
