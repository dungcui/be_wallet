const Promise = require("bluebird");
const _ = require("lodash");
const { keyEncrypDB } = require("../config");
const { decrypt } = require("../../utils");
const Payment = require("../payment");
const constants = require("./btc_constants");
const { Decimal } = require("decimal.js");
const bitcore = require('bitcore-lib');
const bch = require('bitcore-lib-cash');
const NODE_ENV = process.env.NODE_ENV;

class BtcPayment extends Payment {
    constructor({
        addressRepository,
        tokenRepository,
        walletRepository,
        walletConfigRepository,
        withdrawRepository,
        fundingRepository,
        btcPaymentSleepTime: sleepTime,
        walletThresholdRepository,
        btcRpc,
        btcInterpreter: interpreter,
    }) {
        super({
            name: constants.NAME,
            currency: constants.CURRENCY,
            api: btcRpc,
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
            interpreter
        })
    }

    async ProcessWithdraw(producer) {
        try {
            console.log("process withdraw ");
            const configWallet = await this.walletConfigRepository.getByService({ service: this.name });
            if (!configWallet || !configWallet.withdrawWalletId) {
                await this.notificationToAdmin({ type: this.notified_type.walletNotConfigured, configWallet, producer, walletNotConfigured: "Withdraw " });
                this.logger.warn("wallet not yet configurated");
            } else {
                const wallet = await this.walletRepository.getById({ service: this.name, _id: configWallet.withdrawWalletId });
                const settlementAddress = decrypt(wallet.encryptedAddress, keyEncrypDB);
                const pendingWithdraw = await this.withdrawRepository.getPendingWithdraw({ service: this.name });
                const fundings = await this.fundingRepository.getAllUnspentInputByWallet({ service: this.name, walletId: wallet._id.toString() });
                const meta = await this.getMeta(pendingWithdraw, fundings, settlementAddress, producer);
                console.log("inputs ", meta.inputs);
                console.log("outputs ", meta.outputs);

                if (meta.outputs.length && meta.inputs.length) {
                    const hash = this.signTx(meta.inputs, meta.outputs, meta.fee, wallet, settlementAddress);
                    if (hash) {
                        const transaction = await this.interpreter.deserializeTx(hash);
                        const result = await this.api.broadcast(hash);
                        if (result) {
                            await Promise.each(meta.inputs, async input => {
                                await this.fundingRepository.updateIsUsed({ service: this.name, _id: input._id });
                            });
                            const avgFee = new Decimal(meta.fee).div(meta.outputs.length);
                            await Promise.each(meta.outputs, async (output, index) => {
                                await this.withdrawRepository.updateTransactionHash({ service: this.name, withdrawalId: output.withdrawalId, transactionHash: transaction.transactionHash, outputIndex: index, status: this.withdrawRepository.status.TRANSFERED, minerFee: avgFee, errorMsg: "" });
                            });
                            this.logger.info(`completed process withdraw as ${transaction.transactionHash}`);
                        }
                    }
                    this.logger.info("transferedWithdraw ", meta.outputs);
                }
            }
            await Promise.delay(1000 * 60 * this.sleepTime);
        } catch (ex) {
            this.logger.error(`${this.name}_payment` + " Exception ", ex);
            this.canStop = true;
            await this.stop();
            await this.start();
        }
    }

    async getMeta(pendingWithdraw, fundings, settlementAddress, producer) {
        const balance = fundings.reduce((total, funding) => {
            total = total.add(funding.amount);
            return total;
        }, new Decimal(0));
        const totalAmountRequest = pendingWithdraw.reduce((total, request) => {
            total = total.add(request.amount);
            return total;
        }, new Decimal(0));
        const feePerByte = await this.api.getSmartFee(4);
        const maximumFee = new Decimal(new Decimal(148).mul(fundings.length)).add(new Decimal(34).mul(pendingWithdraw.length + 1)).add(10).mul(feePerByte);
        let inputs = [];
        let outputs = [];
        let totalInput = new Decimal(0);
        let sumAmountWithdraw = new Decimal(0);
        if (balance.sub(maximumFee).gt(totalAmountRequest)) {
            await Promise.each(fundings, async funding => {
                const address = await this.addressRepository.findById({ service: this.name, _id: funding.addressId });
                if (totalInput.sub(maximumFee).lt(totalAmountRequest)) {
                    inputs.push({
                        _id: funding._id.toString(),
                        transactionHash: funding.transactionHash,
                        outputIndex: funding.outputIndex,
                        amount: funding.amount,
                        path: address.path,
                        script: funding.script,
                    })
                    totalInput = totalInput.add(funding.amount);
                }
            });
            await Promise.each(pendingWithdraw, async request => {
                sumAmountWithdraw = sumAmountWithdraw.add(request.amount);
                outputs.push({
                    address: request.address,
                    amount: request.amount,
                    withdrawalId: request.withdrawalId,
                });
            });
        } else if (totalAmountRequest.gt(balance.sub(maximumFee))) {
            await Promise.each(pendingWithdraw, async request => {
                if (sumAmountWithdraw.add(request.amount).lt(balance.sub(maximumFee))) {
                    sumAmountWithdraw = sumAmountWithdraw.add(request.amount);
                    outputs.push({
                        address: request.address,
                        amount: request.amount,
                        withdrawalId: request.withdrawalId,
                    });
                } else {
                    this.logger.warn(`hot wallet not enough BTC for transfer`);
                    await this.notificationForProcessWithdrawRequest({ producer, request, withdrawAddress: settlementAddress, currency: constants.CURRENCY });
                    await this.withdrawRepository.updateIsNotified({ service: this.name, withdrawalId: request.withdrawalId, isNotified: true });
                }
            });
            if (outputs.length) {
                inputs = await Promise.map(fundings, async (funding) => {
                    const address = await this.addressRepository.findById({ service: this.name, _id: funding.addressId });
                    return {
                        _id: funding._id.toString(),
                        transactionHash: funding.transactionHash,
                        outputIndex: funding.outputIndex,
                        amount: funding.amount,
                        path: address.path,
                        script: funding.script,
                    }
                });
            }
        }
        const fee = new Decimal(new Decimal(148).mul(inputs.length)).add(new Decimal(34).mul(outputs.length + 1)).add(10).mul(feePerByte);

        const meta = {
            inputs,
            outputs,
            fee,
            amount: sumAmountWithdraw,
        }
        return meta;
    }

    signTx(inputs, outputs, fee, wallet, _changeAddress) {
        var multiSigTx = new bitcore.Transaction();
        let network;
        if (NODE_ENV == "development") {
            network = bitcore.Networks.testnet;
        } else if (NODE_ENV == "production") {
            network = bitcore.Networks.mainnet;
        }
        const changeAddress = new bitcore.Address(
            _changeAddress,
            network
        ).toString();
        _.each(inputs, function (i) {
            var input = new bitcore.Transaction.Input.PublicKeyHash({
                output: new bitcore.Transaction.Output({
                    script: i.script,
                    satoshis: new Decimal(i.amount).mul(constants.BTC_TO_SATOSHI).toFixed()
                }),
                prevTxId: i.transactionHash,
                outputIndex: Number(i.outputIndex),
                script: bitcore.Script.empty()
            });
            multiSigTx.addInput(input);
        });
        _.each(outputs, function (output) {
            multiSigTx.addOutput(
                new bitcore.Transaction.Output({
                    script: bitcore.Script(new bitcore.Address(output.address, network)),
                    satoshis: new Decimal(output.amount).mul(constants.BTC_TO_SATOSHI).toFixed()
                })
            );
        });
        // console.log("multiSigTx ", multiSigTx);
        // console.log("feePerbyte", new Decimal(feePerByte).mul(constants.BTC_TO_SATOSHI).mul(1024).toNumber());
        //convert feePerByte To KB
        multiSigTx.fee(new Decimal(fee).mul(constants.BTC_TO_SATOSHI).toNumber());
        multiSigTx.change(changeAddress);
        var estimatefee = multiSigTx._getUnspentValue();
        console.log("Est fee is " + multiSigTx.getFee());
        console.log("Actual fee is " + multiSigTx._getUnspentValue());
        if (estimatefee < multiSigTx.getFee()) {
            throw "Insufficient fee";
        } else if (estimatefee > 10000000) {
            throw "Fee is too high";
        }
        const hdPaths = Array.from(new Set(inputs.map(input => input.path)));
        const extendprivKey = decrypt(wallet.encryptedKey, keyEncrypDB);
        hdPaths.forEach(hdPath => {
            const path = constants.bip44Prefix + hdPath;
            const privateKey = bitcore.HDPrivateKey(extendprivKey).derive(path)
                .privateKey;
            multiSigTx.sign(privateKey);
        });

        if (multiSigTx.isFullySigned()) {
            console.log("isFullySigned ", multiSigTx.isFullySigned());
            return multiSigTx.serialize();
        } else {
            console.log("isFullySigned ", multiSigTx.isFullySigned());
            return null;
        }
    }
}

module.exports = BtcPayment;
