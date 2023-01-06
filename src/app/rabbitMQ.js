var amqp = require('amqplib');
var rabbitUrl = process.env.RABBIT_HOSTNAME;
var rabbitExchange = process.env.RABBIT_EXCHANGE;
var rabbitDepositQueue = process.env.RABBIT_DEPOSIT_QUEUE;
var rabbitConfirmQueue = process.env.RABBIT_CONFIRM_QUEUE;
var rabbitUser = process.env.RABBIT_USER;
var rabbitPassword = process.env.RABBIT_PASSWORD;

// if the connection is closed or fails to be established at all, we will reconnect
var isConnecting = false;
async function createProducer(queue) {
    if (isConnecting) return;
    isConnecting = true;
    const EXCHANGE_TYPE = 'direct';
    const EXCHANGE_OPTION = {
        durable: true,
    };
    const conn = await amqp.connect("amqp://" + rabbitUser + ":" + rabbitPassword + "@" + rabbitUrl);
    conn.on("close", function () {
        console.error("[AMQP] reconnecting");
        return setTimeout(createProducer, 1000);
    });
    console.log("[AMQP] connected");
    const ch = await conn.createChannel(rabbitExchange, EXCHANGE_TYPE, EXCHANGE_OPTION);
    await ch.assertQueue(queue, {
        durable: true,
    })
    return ch;
}

module.exports = { createProducer, rabbitDepositQueue, rabbitConfirmQueue };