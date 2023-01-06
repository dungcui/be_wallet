const Promise = require("bluebird");
const _ = require("lodash");
const { keyEncrypDB } = require("../config");
const { signMessage, decrypt } = require("../../utils");
const Payment = require("../payment");
const constants = require("./bnb_constants");
const { BnbHdWallet } = require("./bnb_hdwallet");
const BnbereumTx = require("ethereumjs-tx").Transaction;
const { Decimal } = require("decimal.js");
const fetch = require("node-fetch");
const { addHexPrefix } = require("ethereumjs-util");


class BnbPayment extends Payment {
    constructor({
        addressRepository,
        tokenRepository,
        walletRepository,
        walletConfigRepository,
        withdrawRepository,
        fundingRepository,
        bnbPaymentSleepTime: sleepTime,
        walletThresholdRepository,
        bnbRpc,
        bnbGasPrice,
    }) {
        super({
            name: constants.NAME,
            currency: constants.CURRENCY,
            api: bnbRpc,
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
        this.bnbGasPrice = bnbGasPrice;
    }

    async ProcessWithdraw(producer) {
        try {
            console.log("process withdraw ");
            const configWallet = await this.walletConfigRepository.getByService({ service: constants.NAME });
            if (!configWallet || !configWallet.withdrawWalletId) {
                // await this.notificationToAdmin({ type: notified_type.walletNotConfigured, configWallet, producer, walletNotConfigured: "Withdraw " });
                console.log("wallet not yet configurated");
            } else {
                const withdrawWallet = await this.walletRepository.getById({ service: constants.NAME, _id: configWallet.withdrawWalletId });
                const masterKey = decrypt(withdrawWallet.encryptedKey, keyEncrypDB);
                const hdkey = new BnbHdWallet(masterKey);
                const path = constants.bip44Prefix + '0';
                const privateKey = hdkey.getPrivateKeyByPath(path);
                const withdrawAddress = decrypt(withdrawWallet.encryptedAddress, keyEncrypDB);
                var balanceMaps = await this.fundingRepository.getMapBalanceAddressWallet({ service: constants.NAME, walletId: configWallet.withdrawWalletId, to: withdrawAddress })
                console.log("balanceMaps ", balanceMaps);
                const pendingWithdraw = await this.withdrawRepository.getPendingWithdraw({ service: constants.NAME });
                const gasPrice = await this.getCurrentGasPrice();

                const filtedWithdraw = await Promise.filter(pendingWithdraw, async withdraw => {
                    const enoughBalance = await this.enoughBalanceFilter(withdraw, balanceMaps, gasPrice, withdrawAddress, producer);
                    return enoughBalance;
                }, { concurrency: 1 });
                console.log("filtedWithdraw ", filtedWithdraw);

                const nonce = await this.api.getNonce(withdrawAddress);
                const transferedWithdraw = await Promise.map(filtedWithdraw.slice(0,30), async (request, index) => {
                    const req = { currency: request.service, withdrawalId: request.withdrawalId, address: request.address, tag: request.tag, amount: request.amount, asset: request.asset };
                    const signatureData = signMessage(JSON.stringify(req), keyEncrypDB);
                    let hash = "";
                    let transactionHash = "";
                    let error = "";
                    if (request.signature === (signatureData)) {
                        if (request.asset !== constants.CURRENCY) {
                            hash = await this.transferBEP20(request, withdrawAddress, nonce, index, privateKey, gasPrice, producer);
                        } else {
                            hash = await this.transferBNB(request, withdrawAddress, nonce, index, privateKey, gasPrice, producer);
                        }
                    } else {
                        error = " signature not match ";
                    }
                    if (!_.isEmpty(hash)) {
                        transactionHash = await this.api.getTransactionHashFromRawHash(hash);
                        await Promise.delay(200);
                        const response = await this.api.broadcast(hash);
                        if (response) {
                            await this.withdrawRepository.updateTransactionHash({ service: constants.NAME, withdrawalId: request.withdrawalId, transactionHash, outputIndex: 0, status: this.withdrawRepository.status.TRANSFERED, errorMsg: error });
                            return {
                                id: request.withdrawalId,
                                transactionHash: transactionHash,
                                status: this.withdrawRepository.status.TRANSFERED,
                            }
                        } else {
                            return {
                                id: request.withdrawalId,
                                transactionHash: transactionHash,
                                status: this.withdrawRepository.status.INQUEUE,
                            }
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

    async transferBEP20(request, withdrawAddress, nonce, index, privateKey, gasPrice, producer) {
        const token = await this.tokenRepository.findByServiceAndSymbol({ service: constants.NAME, symbol: request.asset });
        const encodeData = this.api.getEncodeData(request.address, withdrawAddress, request.amount, token);
        const gasLimit = await this.api.getEstimateGas(withdrawAddress, token, encodeData);
        const tx = {
            privateKey: privateKey, encodeData: encodeData, toAddress: token.contractAddress, nonce: nonce + index, value: 0, gas_price: gasPrice, gas_limit: gasLimit
        }
        const hash = await this.signTx(tx);
        return hash;
    }

    async enoughBalanceFilter(request, balanceMaps, gasPrice, withdrawAddress, producer) {
        const tokenBalance = balanceMaps.get(request.asset);
        const bnbBalance = balanceMaps.get(constants.CURRENCY);
        if (request.asset !== constants.CURRENCY) {
            const token = await this.tokenRepository.findByServiceAndSymbol({ service: constants.NAME, symbol: request.asset });
            const encodeData = this.api.getEncodeData(request.address, withdrawAddress, request.amount, token);
            if (tokenBalance && bnbBalance && new Decimal(tokenBalance).gte(request.amount)) {
                const gasLimit = await this.api.getEstimateGas(withdrawAddress, token, encodeData);
                const grossFee = new Decimal(gasLimit).mul(gasPrice).div(constants.ETH_TO_GWEI);
                if (new Decimal(bnbBalance).gte(grossFee)) {
                    balanceMaps.set(request.asset, new Decimal(tokenBalance).sub(request.amount));
                    balanceMaps.set(constants.CURRENCY, new Decimal(bnbBalance).sub(grossFee));
                    return true;
                } else {
                    if (!request.isNotified) {
                        console.log(`hot wallet ${withdrawAddress} not enough BNB for fee`);
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
            const grossFee = new Decimal(constants.GROSS_GAS_LIMIT).mul(gasPrice).div(constants.BNB_TO_GWEI);
            if (bnbBalance && new Decimal(bnbBalance).gte(grossFee.add(request.amount))) {
                balanceMaps.set(constants.CURRENCY, new Decimal(bnbBalance).sub(grossFee.add(request.amount)));
                return true;
            } else {
                if (!request.isNotified) {
                    console.log(`hot wallet ${withdrawAddress} not enough BNB for transfer`);
                    await this.notificationForProcessWithdrawRequest({ producer, request, withdrawAddress, currency: constants.CURRENCY });
                    await this.withdrawRepository.updateIsNotified({ service: constants.NAME, withdrawalId: request.withdrawalId, isNotified: true });
                }
                return false;
            }
        }
    }

    async transferBNB(request, withdrawAddress, nonce, index, privateKey, gasPrice, producer) {
        const tx = {
            privateKey: privateKey, encodeData: null, toAddress: request.address, nonce: nonce + index, value: request.amount, gas_price: gasPrice, gas_limit: constants.GROSS_GAS_LIMIT
        }
        const hash = await this.signTx(tx);
        return hash;
    }


    async signTx({ privateKey, encodeData, toAddress, nonce, value, gas_price, gas_limit }) {
        const pk = Buffer.from(privateKey, "hex");
        const gasPrice = this.api.convertToWei(gas_price, "gwei");
        const gasLimit = this.api.convertToBN(gas_limit);
        let amount = '0x0';
        if (!encodeData) {
            amount = this.api.convertToWei(new Decimal(value).mul(constants.ETH_TO_GWEI), "gwei");
        }


        const rawTx = {
            to: toAddress,
            nonce,
            gasPrice,
            gas : gasLimit,
            value: amount,
            data: encodeData
        }
          
        const tx = await this.api.signTx(rawTx,privateKey);
        return tx.rawTransaction;
    }


    async getCurrentGasPrice() {
        // const { estimateGasPrice } = await this.walletConfigRepository.getByService({ service: this.name });
        try {
            const mbnbod = "GET";
            const headers = {
                "Content-Type": "application/json"
            };
            // const options = { mbnbod, headers };
            // const raw = await fetch(this.estimateGasUrl, options);
            // const result = await raw.json();
            const gasPrice = new Decimal(this.bnbGasPrice).round().toFixed();
            // await this.walletConfigRepository.updateEstimateGasPrice({ service: this.name, estimateGasPrice: gasPrice })
            return gasPrice;
        } catch (ex) {
            // return new Decimal(estimateGasPrice);
        }
    }
}

module.exports = BnbPayment;
