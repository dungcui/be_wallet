const Promise = require("bluebird");
const _ = require("lodash");
const { keyEncrypDB } = require("../config");
const { signMessage, decrypt } = require("../../utils");
const Payment = require("../payment");
const constants = require("./trx_constants");
const { Decimal } = require("decimal.js");
const fetch = require("node-fetch");
const bitcore = require('bitcore-lib');
const bch = require('bitcore-lib-cash');

class TrxPayment extends Payment {
    constructor({
        addressRepository,
        tokenRepository,
        walletRepository,
        walletConfigRepository,
        withdrawRepository,
        fundingRepository,
        trxPaymentSleepTime: sleepTime,
        walletThresholdRepository,
        trxApi,
    }) {
        super({
            name: constants.NAME,
            currency: constants.CURRENCY,
            api: trxApi,
            error: {
            },
            tokenRepository,
            addressRepository,
            walletRepository,
            walletConfigRepository,
            withdrawRepository,
            fundingRepository,
            walletThresholdRepository,
            sleepTime,
        })
    }

    async ProcessWithdraw(producer) {
        try {
            console.log("process withdraw ");
            const configWallet = await this.walletConfigRepository.getByService({ service: constants.NAME });
            if (!configWallet || !configWallet.withdrawWalletId) {
                // await this.notificationToAdmin({ type: notified_type.walletNotConfigured, producer, configWallet, walletNotConfigured: "Withdraw " });
                console.log("wallet not yet configurated");
            } else {
                const withdrawWallet = await this.walletRepository.getById({ service: constants.NAME, _id: configWallet.withdrawWalletId });
                const masterKey = decrypt(withdrawWallet.encryptedKey, keyEncrypDB);
                const hdkey = new bitcore.HDPrivateKey(masterKey);
                const path = constants.bip44Prefix + '0';
                const privateKey = hdkey.derive(path).privateKey.toString();
                const withdrawAddress = decrypt(withdrawWallet.encryptedAddress, keyEncrypDB);
                var balanceMaps = await this.fundingRepository.getMapBalanceAddressWallet({ service: constants.NAME, walletId: configWallet.withdrawWalletId, to: withdrawAddress })
                console.log("balanceMaps ", balanceMaps);
                const pendingWithdraw = await this.withdrawRepository.getPendingWithdraw({ service: constants.NAME });
                const filtedWithdraw = await Promise.filter(pendingWithdraw, async withdraw => {
                    const enoughBalance = await this.enoughBalanceFilter(withdraw, balanceMaps, withdrawAddress, producer);
                    return enoughBalance;
                }, { concurrency: 1 });
                console.log("filtedWithdraw ", filtedWithdraw);
                const transferedWithdraw = await Promise.map(filtedWithdraw, async (request) => {
                    const req = { currency: request.service, withdrawalId: request.withdrawalId, address: request.address, tag: request.tag, amount: request.amount, asset: request.asset };
                    const signatureData = signMessage(JSON.stringify(req), keyEncrypDB);
                    let hash = "";
                    let transactionHash = "";
                    let error = "";
                    if (request.signature === (signatureData)) {
                        if (request.asset !== constants.CURRENCY) {
                            hash = await this.transferTRC20(request, privateKey);
                        } else {
                            hash = await this.transferTRX(request, privateKey);
                        }
                    } else {
                        error = " signature not match ";
                    }
                    if (!_.isEmpty(hash)) {
                        await this.withdrawRepository.updateTransactionHash({ service: constants.NAME, withdrawalId: request.withdrawalId, transactionHash: hash, outputIndex: 0, status: this.withdrawRepository.status.TRANSFERED, errorMsg: error });
                        return {
                            id: request.withdrawalId,
                            transactionHash: hash,
                            status: this.withdrawRepository.status.TRANSFERED,
                        }
                    } else {
                        return {
                            id: request.withdrawalId,
                            transactionHash: transactionHash,
                            status: this.withdrawRepository.status.INQUEUE,
                        }
                    }
                });
                // if (transferedWithdraw.length) {
                //     const jsonData = JSON.stringify(transferedWithdraw);
                //     const signature = utils.signMessage(jsonData, keySignMessage);
                //     const data = {
                //         signature: signature, message: transferedWithdraw
                //     }
                //     try {
                //         producer.sendToQueue(rabbitWithdrawalQueue, new Buffer.from(JSON.stringify(data)), { persistent: true });
                //     } catch {
                //     }
                // }
                // console.log("this.sleepTime", this.sleepTime);
                console.log("transferedWithdraw ", transferedWithdraw);
            }

            await Promise.delay(1000 * 60 * this.sleepTime);
        } catch (ex) {
            console.log(`${this.name}_payment` + " Exception ", ex);
            this.canStop = true;
            await this.stop();
            await this.start();
        }
    }



    async enoughBalanceFilter(request, balanceMaps, withdrawAddress, producer) {
        const tokenBalance = balanceMaps.get(request.asset);
        const trxBalance = balanceMaps.get(constants.CURRENCY);
        if (request.asset !== constants.CURRENCY) {
            const token = await this.tokenRepository.findByServiceAndSymbol({ service: constants.NAME, symbol: request.asset });
            if (tokenBalance && trxBalance && new Decimal(tokenBalance).gte(request.amount)) {
                if (new Decimal(trxBalance).gte(constants.FEE_LIMIT)) {
                    balanceMaps.set(request.asset, new Decimal(tokenBalance).sub(request.amount));
                    balanceMaps.set(constants.CURRENCY, new Decimal(trxBalance).sub(constants.FEE_LIMIT));
                    return true;
                } else {
                    if (!request.isNotified) {
                        console.log(`hot wallet ${withdrawAddress} not enough TRX for fee`);
                        const feeRequest = {
                            address: request.address,
                            amount: grossFee,
                        }
                        await this.notificationForProcessWithdrawRequest({ producer, feeRequest, withdrawAddress, currency: constants.CURRENCY });
                        await this.withdrawRepository.updateIsNotified({ service: constants.NAME, withdrawalId: request.withdrawalId, isNotified: true });
                    }
                    return false;
                }
            } else {
                if (!request.isNotified) {
                    console.log(`hot wallet ${withdrawAddress} not enough balance`);
                    await this.notificationForProcessWithdrawRequest({ producer, request, withdrawAddress, currency: token.symbol });
                    await this.withdrawRepository.updateIsNotified({ service: constants.NAME, withdrawalId: request.withdrawalId, isNotified: true });
                }
                return false;
            }
        } else {
            if (trxBalance && new Decimal(trxBalance).gte(new Decimal(constants.BASE_TRX_BURN).add(request.amount))) {
                balanceMaps.set(constants.CURRENCY, new Decimal(trxBalance).sub(new Decimal(constants.BASE_TRX_BURN).add(request.amount)));
                return true;
            } else {
                if (!request.isNotified) {
                    console.log(`hot wallet ${withdrawAddress} not enough ETH for transfer`);
                    await this.notificationForProcessWithdrawRequest({ producer, request, withdrawAddress, currency: constants.CURRENCY });
                    await this.withdrawRepository.updateIsNotified({ service: constants.NAME, withdrawalId: request.withdrawalId, isNotified: true });
                }
                return false;
            }
        }
    }

    async transferTRC20(request, privateKey) {
        const token = await this.tokenRepository.findByServiceAndSymbol({ service: constants.NAME, symbol: request.asset });
        const hash = await this.api.sendToken(request.address, request.amount, token, privateKey, constants.FEE_LIMIT);
        return hash;
    }

    async transferTRX(request, privateKey) {
        const hash = await this.api.sendTrx(request.address, request.amount, privateKey);
        return hash;
    }
}

module.exports = TrxPayment;
