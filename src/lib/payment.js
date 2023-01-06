const Promise = require("bluebird");
const _ = require("lodash");
const { keyEncrypDB } = require("./config");
const { signMessage, encrypt, decrypt } = require("../utils");
const rabbitWalletInsufficientBalance = process.env.RABBIT_HOT_WALLET_INSUFFICIENT;
const keySignMessage = process.env.KEY_SIGN_MESSAGE;

class Payment {
  constructor({
    name,
    currency,
    api,
    error,
    addressRepository,
    tokenRepository,
    walletRepository,
    walletConfigRepository,
    withdrawRepository,
    fundingRepository,
    walletThresholdRepository,
    interpreter,
    sleepTime
  }) {
    // Components
    this.name = name;
    this.currency = currency;
    this.api = api;
    this.error = {
      ...error,
    }
    this.addressRepository = addressRepository;
    this.tokenRepository = tokenRepository;
    this.walletRepository = walletRepository;
    this.withdrawRepository = withdrawRepository;
    this.walletConfigRepository = walletConfigRepository;
    this.walletThresholdRepository = walletThresholdRepository;
    this.fundingRepository = fundingRepository;
    this.interpreter = interpreter;
    this.sleepTime = sleepTime;
    this.notified_type = {
      withdrawWalletBalance: "withdrawInsufficientBalance",
      distributionWalletBalance: "distributionInsufficientBalance",
      walletNotConfigured: "walletIsNotConfigured",
      walletBalanceLowerThreshold: "walletBlalanceLowerThreshold",
    }
  }
  async start(producer) {
    this.isRunning = true;
    this.canStop = false;
    await this.run(producer);
    this.canStop = true;
  }

  async stop() {
    this.isRunning = false;
    console.log("Attempt to stop...");
    if (this.canStop) {
      console.log("Stopped.");
      return;
    }
    await Promise.delay(1000 * this.sleepTime);
    await this.stop();
  }

  async run(producer) {
    while (this.isRunning) {
      await this.ProcessWithdraw(producer);
    }
  }

  async notificationForProcessWithdrawRequest({ producer, request, withdrawAddress, currency }) {
    if (!request.isNotified) {
      const json = {
        type: this.notified_type.withdrawWalletBalance,
        address: withdrawAddress,
        toAddress: request.address,
        amount: request.amount,
        asset: currency
      }
      const signature = signMessage(JSON.stringify(json), keySignMessage);
      const data = {
        signature: signature, message: json
      }
      try {
        producer.sendToQueue(rabbitWalletInsufficientBalance, Buffer.from(JSON.stringify(data)), { persistent: true });
      } catch (ex) {
        console.log("ex ", ex);
        console.log("can't send to Rabbit ", data);
      }
    }
  }

  async notificationToAdmin({ type, producer, configWallet, address, toAddress, amount, asset, walletNotConfigured }) {
    if (!configWallet || !configWallet.isNotified) {
      const json = {
        type: type,
        walletNotConfigured: walletNotConfigured,
        address: address,
        toAddress: toAddress,
        amount: amount,
        asset: asset
      }
      const signature = signMessage(JSON.stringify(json), keySignMessage);
      const data = {
        signature: signature, message: json
      }
      try {
        producer.sendToQueue(rabbitWalletInsufficientBalance, Buffer.from(JSON.stringify(data)), { persistent: true });
        await this.walletConfigRepository.updateIsNotified({ service: constants.NAME, isNotified: true });
      } catch (ex) {
        console.log("ex ", ex);
        console.log("can't send to Rabbit ", data);
      }
    }
  }
}
module.exports = Payment;
