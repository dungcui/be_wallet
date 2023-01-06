"use strict";
const Promise = require("bluebird");
const _ = require("lodash");
const { keyEncrypDB } = require("../config");
const { signMessage, decrypt } = require("../../utils");
const constants = require("./btc_constants.js");
const { Decimal } = require("decimal.js");
const Transporter = require("../transporter");
const bitcore = require('bitcore-lib');
const bch = require('bitcore-lib-cash');
const NODE_ENV = process.env.NODE_ENV;

class BtcTransporter extends Transporter {
    constructor({
        addressRepository,
        tokenRepository,
        walletRepository,
        walletConfigRepository,
        withdrawRepository,
        distributionRepository,
        fundingRepository,
        walletThresholdRepository,
        btcTransporterSleepTime,
        btcRpc,
        moveFundRepository,
        btcInterpreter: interpreter
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
            distributionRepository,
            walletThresholdRepository,
            sleepTime: btcTransporterSleepTime,
            moveFundRepository,
            btcRpc,
            interpreter
        });
    }

    async forwardingFund(configWallet, coldAddress, withdrawAddress, minimumDepositMap, producer) {
        const forwardingThreshHold = await this.walletThresholdRepository.getForwardingThreshHoldByServiceToken({ service: this.name, token: constants.CURRENCY });
        const notificationThreshHold = await this.walletThresholdRepository.getNotificationThreshHoldByServiceToken({ service: this.name, token: constants.CURRENCY })
        const walletHaveFund = await this.fundingRepository.getAllWalletIdHaveFunding({ service: this.name });
        if (walletHaveFund) {
            Promise.each(walletHaveFund, async walletFunding => {
                const fundings = await this.fundingRepository.getAllUnspentInputByWallet({ service: this.name, walletId: walletFunding.walletId });
                const wallet = await this.walletRepository.getById({ service: this.name, _id: walletFunding.walletId });
                const meta = await this.buildMeta(configWallet, wallet, fundings, forwardingThreshHold, notificationThreshHold, withdrawAddress, coldAddress, producer);
                console.log("inputs :", meta.inputs);
                console.log("outputs :", meta.outputs);
                if (meta.inputs.length && meta.outputs.length) {
                    const hash = this.signTx(meta.inputs, meta.outputs, meta.fee, wallet, coldAddress);
                    console.log("hash ", hash);
                    if (hash) {
                        const transaction = await this.interpreter.deserializeTx(hash);
                        const result = await this.api.broadcast(hash);
                        if (result) {
                            await Promise.each(meta.inputs, async input => {
                                await this.fundingRepository.updateIsUsed({ service: this.name, _id: input._id });
                            });
                            await this.moveFundRepository.create({ service: this.name, currency: this.currency, address: coldAddress, amount: meta.amount, minerFee: meta.fee, feeCurrency: constants.FEE_CURRENCY, retries: 0, status: this.fundingRepository.status.TRANSFERED, errorMsg: "", transactionHash: transaction.transactionHash });
                            this.logger.info(`completed forwarding to cold wallet ${coldAddress} amount ${meta.amount}`);
                        }
                    }
                }
            });
        }
    }

    async buildMeta(configWallet, wallet, fundings, forwardingThreshHold, notificationThreshHold, withdrawAddress, coldAddress, producer) {
        const balance = fundings.reduce((total, funding) => {
            total = total.add(funding.amount);
            return total;
        }, new Decimal(0));
        console.log("balance ", balance);
        const feePerByte = await this.api.getSmartFee(4);
        let forwardingToColdAmount = new Decimal(0);
        let forwardingToWithdrawAmount = new Decimal(0);
        let totalAmountFunding = new Decimal(0);
        let inputs = [];
        let outputs = [];
        if (balance.lt(notificationThreshHold)) {
            await this.notificationToAdmin({ type: this.notified_type.walletBalanceLowerThreshold, asset: constants.CURRENCY, producer });
        }
        await Promise.each(fundings, async funding => {
            const address = await this.addressRepository.findById({ service: this.name, _id: funding.addressId });
            if (totalAmountFunding.gte(forwardingThreshHold) || (wallet._id.toString() !== configWallet.depositWalletId && wallet._id.toString() !== configWallet.withdrawWalletId)) {
                console.log("totalAmountFunding.add(funding.amount) ", totalAmountFunding.add(funding.amount));
                console.log("forwardingThreshHold ", forwardingThreshHold);

                inputs.push({
                    _id: funding._id.toString(),
                    transactionHash: funding.transactionHash,
                    outputIndex: funding.outputIndex,
                    amount: funding.amount,
                    path: address.path,
                    script: funding.script,
                });
                forwardingToColdAmount = forwardingToColdAmount.add(funding.amount);
            } else if (totalAmountFunding.lte(forwardingThreshHold)) {
                if (totalAmountFunding.add(funding.amount).gte(forwardingThreshHold)) {
                    console.log("totalAmountFunding.add(funding.amount) ", totalAmountFunding.add(funding.amount));
                    console.log("forwardingThreshHold ", forwardingThreshHold);
                    forwardingToWithdrawAmount = forwardingThreshHold.sub(totalAmountFunding);
                    inputs.push({
                        _id: funding._id.toString(),
                        transactionHash: funding.transactionHash,
                        outputIndex: funding.outputIndex,
                        amount: funding.amount,
                        path: address.path,
                        script: funding.script,
                    });
                    forwardingToColdAmount = forwardingToColdAmount.add(new Decimal(funding.amount)).sub(forwardingToWithdrawAmount);
                }
            }
            totalAmountFunding = totalAmountFunding.add(funding.amount);
        });
        if (forwardingToWithdrawAmount.gt(0)) {
            outputs.push({
                address: withdrawAddress,
                amount: forwardingToWithdrawAmount,
            });
        }
        ///(148 x input + 34 x output + 10) x fee per byte
        const inputByte = new Decimal(148).mul(inputs.length);
        /// 1 output to cold and 1 output changeAddress;
        const ouputByte = new Decimal(34).mul(outputs.length + 1);

        // 10 is base byte transaction
        const byteTransaction = inputByte.add(ouputByte).add(10);
        console.log("feePerByte ", feePerByte);
        console.log("byteTransaction", byteTransaction);

        const fee = byteTransaction.mul(feePerByte).mul(constants.BTC_TO_SATOSHI).round().div(constants.BTC_TO_SATOSHI);
        console.log("fee", fee);
        console.log("forwardingToWithdrawAmount ", forwardingToWithdrawAmount);
        console.log("forwardingToColdAmount ", forwardingToColdAmount.sub(fee));
        if (forwardingToColdAmount.sub(fee).gt(0)) {
            outputs.push({
                address: coldAddress,
                amount: forwardingToColdAmount.sub(fee),
            });
        }
        const meta = {
            inputs: inputs,
            outputs: outputs,
            fee: fee,
            amount: forwardingToColdAmount.sub(fee),
        }
        return meta;
    }

    signTx(inputs, outputs, fee, wallet, coldAddress) {
        var multiSigTx = new bitcore.Transaction();
        let network;
        if (NODE_ENV == "development") {
            network = bitcore.Networks.testnet;
        } else if (NODE_ENV == "production") {
            network = bitcore.Networks.mainnet;
        }
        const changeAddress = new bitcore.Address(
            coldAddress,
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
module.exports = BtcTransporter;
