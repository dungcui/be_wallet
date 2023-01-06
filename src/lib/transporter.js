const Promise = require("bluebird");
const _ = require("lodash");
const { keyEncrypDB } = require("./config");
const { signMessage, encrypt, decrypt } = require("../utils");
const keySignMessage = process.env.KEY_SIGN_MESSAGE;
const rabbitWalletInsufficientBalance = process.env.RABBIT_HOT_WALLET_INSUFFICIENT;

class Transporter {
    constructor({
        name,
        currency,
        api,
        error,
        addressRepository,
        tokenRepository,
        walletRepository,
        walletConfigRepository,
        walletThresholdRepository,
        withdrawRepository,
        fundingRepository,
        moveFundRepository,
        distributionRepository,
        interpreter,
        sleepTime,
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
        this.distributionRepository = distributionRepository;
        this.moveFundRepository = moveFundRepository;
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
            await this.distributeGasAndMoveFund(producer);
        }
    }

    async distributeGasAndMoveFund(producer) {
        try {
            let minimumDepositMap = await this.walletThresholdRepository.getMapMinimumDeposit({ service: this.name });
            const configWallet = await this.walletConfigRepository.getByService({ service: this.name });
            if (!configWallet) {
                // await this.notificationToAdmin({ type: this.notified_type.walletNotConfigured, producer, configWallet, walletNotConfigured: "Distribution, Withdraw, ColdWallet, Deposit " });
                console.log("wallet not yet configured!");
            } else {
                const withdrawWallet = await this.walletRepository.getById({ service: this.name, _id: configWallet.withdrawWalletId });
                let withdrawAddress = "";
                let coldAddress = "";
                if (withdrawWallet) {
                    withdrawAddress = decrypt(withdrawWallet.encryptedAddress, keyEncrypDB);
                }
                if (configWallet && configWallet.encryptedColdAddress) {
                    coldAddress = decrypt(configWallet.encryptedColdAddress, keyEncrypDB);
                }
                if (coldAddress && withdrawAddress) {
                    await this.forwardingFund(configWallet, coldAddress, withdrawAddress, minimumDepositMap, producer);
                } else {
                    // await this.notificationToAdmin({ type: this.notified_type.walletNotConfigured, producer, configWallet, walletNotConfigured: "Withdraw, ColdWallet " });
                    console.log("wallet not yet configured!");
                }
            }
            await Promise.delay(1000 * 60 * this.sleepTime);
        } catch (ex) {
            console.log(`${this.name}_transporter` + " Exception ", ex);
            this.canStop = true;
            await this.stop();
            await this.start();
        }
    }

    async notificationToAdmin({ type, producer, configWallet, address, toAddress, amount, walletNotConfigured, asset }) {
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
                await this.walletConfigRepository.updateIsNotified({ service: this.name, isNotified: true });
            } catch (ex) {
                console.log("ex ", ex);
                console.log("can't send to Rabbit ", data);
            }
        }
    }

}
module.exports = Transporter;
