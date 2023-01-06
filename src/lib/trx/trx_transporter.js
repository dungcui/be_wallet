"use strict";
const Promise = require("bluebird");
const _ = require("lodash");
const { keyEncrypDB } = require("../config");
const { decrypt } = require("../../utils");
const Transporter = require("../transporter");
const constants = require("./trx_constants.js");
const { Decimal } = require("decimal.js");
const bitcore = require('bitcore-lib');
const bch = require('bitcore-lib-cash');

class TrxTransporter extends Transporter {
    constructor({
        addressRepository,
        tokenRepository,
        walletRepository,
        walletConfigRepository,
        withdrawRepository,
        distributionRepository,
        fundingRepository,
        walletThresholdRepository,
        trxTransporterSleepTime,
        trxApi,
        moveFundRepository,
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
            distributionRepository,
            walletThresholdRepository,
            sleepTime: trxTransporterSleepTime,
            moveFundRepository,
        });
    }
    async distributeGasAndMoveFund(producer) {
        try {
            let minimumDepositMap = await this.walletThresholdRepository.getMapMinimumDeposit({ service: this.name });
            const configWallet = await this.walletConfigRepository.getByService({ service: this.name });
            if (!configWallet) {
                await this.notificationToAdmin({ type: this.notified_type.walletNotConfigured, producer, configWallet, walletNotConfigured: "Distribution, Withdraw, ColdWallet, Deposit " });
                console.log("wallet not yet configured!");
            } else {
                const withdrawWallet = await this.walletRepository.getById({ service: this.name, _id: configWallet.withdrawWalletId });
                let withdrawAddress = "";
                let coldAddress = "";
                if (withdrawWallet) {
                    withdrawAddress = decrypt(withdrawWallet.encryptedAddress, keyEncrypDB);
                }
                if (configWallet && configWallet.encryptedColdWallet) {
                    coldAddress = decrypt(configWallet.encryptedColdWallet, keyEncrypDB);
                }
                if (coldAddress && withdrawAddress) {
                    await this.forwardingFund(configWallet, coldAddress, withdrawAddress, minimumDepositMap, producer)
                } else {
                    console.log("wallet not yet configured!");
                }
            }
            await Promise.delay(1000 * 60 * this.sleepTime);
        } catch (ex) {
            console.log("ex ", ex);
            console.log(`${this.name}_transporter` + " Exception ", ex);
            this.canStop = true;
            await this.stop();
            await this.start();
        }
    }
    async forwardingFund(configWallet, coldAddress, withdrawAddress, minimumDepositMap, producer) {
        const distributionWallet = await this.walletRepository.getById({ service: this.name, _id: configWallet.distributionWalletId });
        let distributionAddress = "";
        if (distributionWallet) {
            distributionAddress = decrypt(distributionWallet.encryptedAddress, keyEncrypDB);
        }
        await this.autoMoveFundTRC20Token(configWallet, distributionWallet, distributionAddress, coldAddress, withdrawAddress, minimumDepositMap, producer);
        await this.autoMoveFundTRX(distributionAddress, coldAddress, withdrawAddress, minimumDepositMap);
    }

    async autoMoveFundTRC20Token(configWallet, distributionWallet, distributionAddress, coldAddress, withdrawAddress, minimumDepositMap, producer) {
        const tokens = await this.tokenRepository.getAll(this.name);
        await Promise.each(tokens, async token => {
            const threshHold = await this.walletThresholdRepository.getForwardingThreshHoldByServiceToken({ service: constants.NAME, token: token.symbol });
            const fundings = await this.fundingRepository.getAllAddressHaveFundingByToken({ service: this.name, currency: token.symbol });
            console.log("token ", token.symbol, " fundings ", fundings);
            console.log("threshHold", threshHold);
            let totalMoveFund = new Decimal(0);
            await Promise.each(fundings, async (funding) => {
                const address = await this.addressRepository.findById({ service: this.name, _id: funding.addressId });
                if (this.isEligibledAmount(token.symbol, funding, minimumDepositMap) && this.isNotWithdrawOrDistributionAddress(address, withdrawAddress, distributionAddress)) {
                    const withdrawWalletBalance = await this.api.getBalanceTrx(withdrawAddress);
                    console.log("withdrawWalletBalance", withdrawWalletBalance);
                    let toAddress = "";
                    let moveFundAmount = 0;
                    const wallet = await this.walletRepository.getById({ service: this.name, _id: funding.walletId ? funding.walletId : address.walletId });
                    // is not withdraw wallet
                    if (address.address !== withdrawAddress) {
                        if (threshHold.eq(0) || withdrawWalletBalance.add(totalMoveFund).gte(threshHold)) {
                            moveFundAmount = funding.amount;
                            totalMoveFund = totalMoveFund.add(funding.amount);
                            toAddress = coldAddress;
                        } else {
                            if (new Decimal(funding.amount).gt(threshHold.sub(withdrawWalletBalance))) {
                                moveFundAmount = threshHold.sub(withdrawWalletBalance);
                            } else {
                                moveFundAmount = funding.amount;
                            }
                            totalMoveFund = totalMoveFund.add(moveFundAmount);
                            toAddress = withdrawAddress;
                        }
                        const addressTRXBalance = await this.api.getBalanceTrx(address.address);
                        if (new Decimal(addressTRXBalance).lt(constants.FEE_LIMIT)) {
                            const distributionAmount = new Decimal(constants.FEE_LIMIT).sub(addressTRXBalance);
                            await this.distributorGas(configWallet, distributionWallet, distributionAddress, address, distributionAmount, producer);
                        }
                        const transactionHash = await this.moveFundTRC20(wallet, address, toAddress, token, moveFundAmount);
                        if (transactionHash) {
                            console.log(" completed move fund ", moveFundAmount, " ", token.symbol, " from address :", address.address, " to address :", toAddress, " transactionHash :", transactionHash);
                            await this.moveFundRepository.create({ service: this.name, currency: token.symbol, address: address.address, amount: moveFundAmount, minerFee: 0, feeCurrency: constants.NAME, retries: 0, status: this.fundingRepository.status.TRANSFERED, errorMsg: "", transactionHash: transactionHash });
                            return transactionHash;
                        }
                    }
                }
            });
        });
    }

    async autoMoveFundTRX(distributionAddress, coldAddress, withdrawAddress, minimumDepositMap) {
        const threshHold = await this.walletThresholdRepository.getForwardingThreshHoldByServiceToken({ service: this.name, token: constants.CURRENCY });
        const fundings = await this.fundingRepository.getAllAddressHaveFundingByToken({ service: this.name, currency: constants.CURRENCY });
        console.log("fundings ", fundings);
        console.log("threshHold ", threshHold);
        var totalMoveFund = new Decimal(0);
        await Promise.each(fundings, async (funding) => {
            const address = await this.addressRepository.findById({ service: this.name, _id: funding.addressId });
            if (this.isEligibledAmount(constants.CURRENCY, funding, minimumDepositMap) && this.isNotWithdrawOrDistributionAddress(address, withdrawAddress, distributionAddress)) {
                const withdrawWalletBalance = await this.api.getBalanceTrx(withdrawAddress);
                console.log("withdrawWalletBalance", withdrawWalletBalance);

                let toAddress = "";
                let moveFundAmount;
                console.log(" movefund from ", address.address, " amount ", funding.amount);
                const wallet = await this.walletRepository.getById({ service: this.name, _id: funding.walletId });
                /// is not withdraw address
                if (address.address !== withdrawAddress) {
                    if (threshHold.eq(0) || withdrawWalletBalance.add(totalMoveFund).gte(threshHold)) {
                        moveFundAmount = new Decimal(funding.amount);
                        totalMoveFund = totalMoveFund.add(funding.amount);
                        toAddress = coldAddress;
                    } else {
                        if (new Decimal(funding.amount).gt(threshHold.sub(withdrawWalletBalance))) {
                            moveFundAmount = threshHold.sub(withdrawWalletBalance);
                        } else {
                            moveFundAmount = new Decimal(funding.amount);
                        }
                        toAddress = withdrawAddress;
                        totalMoveFund = totalMoveFund.add(moveFundAmount);
                    }
                    const account = await this.api.getAccount(toAddress);
                    if (!account || !account.active_permission || !account.active_permission.length || !account.active_permission[0].type == "Active") {
                        if (new Decimal(funding.amount).eq(moveFundAmount)) {
                            moveFundAmount = moveFundAmount.sub(constants.BASE_TRX_BURN);
                            totalMoveFund = totalMoveFund.sub(constants.BASE_TRX_BURN);
                        }
                    }
                    const transactionHash = await this.moveFundTRX(wallet, address, toAddress, moveFundAmount);
                    if (transactionHash) {
                        console.log(" completed move fund ", moveFundAmount, " ", constants.CURRENCY, " from address :", address.address, " to address :", toAddress, " transactionHash :", transactionHash);
                        await this.moveFundRepository.create({ service: this.name, currency: constants.CURRENCY, address: address.address, amount: moveFundAmount, minerFee: 0, feeCurrency: constants.NAME, retries: 0, status: this.fundingRepository.status.TRANSFERED, errorMsg: "", transactionHash: transactionHash });
                        return transactionHash;
                    }
                }
            }
        });
    }

    isEligibledAmount(tokenName, tx, minimumDepositMap) {
        let minimumDeposit = minimumDepositMap.get(tokenName) ? minimumDepositMap.get(tokenName) : 0;
        return (new Decimal(tx.amount).gte(minimumDeposit));
    }

    isNotWithdrawOrDistributionAddress(address, withdrawAddress, distributionAddress) {
        return (address.address !== withdrawAddress && address.address !== distributionAddress);
    }

    async distributorGas(configWallet, distributionWallet, distributionAddress, address, distributionAmount, producer) {
        if (!distributionWallet) {
            await this.notificationToAdmin({ type: this.notified_type.walletNotConfigured, producer, configWallet, walletNotConfigured: "Distribution " });
            console.log("distribution wallet not yet configured!");
            return;
        }
        const distributionWalletBalance = await this.api.getBalanceTrx(distributionAddress);
        if (new Decimal(distributionWalletBalance).sub(constants.BASE_TRX_BURN).lt(distributionAmount)) {
            console.log("distribution wallet not enough balance!");
            await this.notificationToAdmin({ type: this.notified_type.distributionWalletBalance, producer, configWallet, address: distributionAddress, toAddress: address.address, amount: distributionAmount, asset: constants.CURRENCY });
            return;
        }
        const masterKey = decrypt(distributionWallet.encryptedKey, keyEncrypDB);
        const wallet = new bitcore.HDPrivateKey(masterKey);
        const path = constants.bip44Prefix + '0';
        const privateKey = wallet.derive(path).privateKey.toString();
        const transactionHash = await this.api.sendTrx(address.address, distributionAmount, privateKey);
        if (transactionHash) {
            if (configWallet.isNotified) {
                await this.walletConfigRepository.updateIsNotified({ service: constants.NAME, isNotified: true });
            }
            console.log(" completed distribution ", distributionAmount, " to ", address.address);
            /// convert gwei to ether
            await this.distributionRepository.create({ service: constants.NAME, currency: constants.CURRENCY, address: address.address, amount: distributionAmount, minerFee: 0, feeCurrency: constants.CURRENCY, status: this.distributionRepository.status.SUCCESS, errorMsg: "", transactionHash: transactionHash })
        }
    }

    async moveFundTRC20(wallet, address, toAddress, token, moveFundAmount) {
        const addressTRXBalance = await this.api.getBalanceTrx(address.address);
        if (addressTRXBalance.lt(constants.FEE_LIMIT)) {
            console.log(`address ${address.address} not enough TRX for fee`);
            return;
        }
        const masterKey = decrypt(wallet.encryptedKey, keyEncrypDB);
        const hdkey = new bitcore.HDPrivateKey(masterKey);
        const path = constants.bip44Prefix + address.path;
        const privateKey = hdkey.derive(path).privateKey.toString();
        const response = await this.api.sendToken(toAddress, moveFundAmount, token, privateKey, constants.FEE_LIMIT);
        return response;
    }

    async moveFundTRX(wallet, address, toAddress, moveFundAmount) {
        const masterKey = decrypt(wallet.encryptedKey, keyEncrypDB);
        const hdkey = new bitcore.HDPrivateKey(masterKey);
        const path = constants.bip44Prefix + address.path;
        const privateKey = hdkey.derive(path).privateKey.toString();
        const response = await this.api.sendTrx(toAddress, moveFundAmount, privateKey);
        return response;
    }
}
module.exports = TrxTransporter;
