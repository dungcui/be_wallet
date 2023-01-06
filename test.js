const { Telegraf } =  require('telegraf');

const bot = new Telegraf("1868525543:AAHKd2O2y2hZRBS_hQs9vtBi9Ewr-vM-hgg");


bot.telegram.sendMessage("-543116744","test send message");
bot.launch();