"use strict";
const debug = require("debug");
const Promise = require("bluebird");
const _ = require("lodash");
const { keyEncrypDB } = require("../config");
const { signMessage, encrypt, decrypt } = require("../../utils");
const Transporter = require("../transporter");
const { EthHdWallet } = require("./eth_hdwallet");
const EthereumTx = require("ethereumjs-tx").Transaction;
const constants = require("./eth_constants.js");
const { Decimal } = require("decimal.js");
const fetch = require("node-fetch");
const { addHexPrefix } = require("ethereumjs-util");


class EthTransporter extends Transporter {
    constructor({
        addressRepository,
        tokenRepository,
        walletRepository,
        walletConfigRepository,
        withdrawRepository,
        distributionRepository,
        fundingRepository,
        walletThresholdRepository,
        ethTransporterSleepTime,
        ethRpc,
        ethEstimateGasPriceUrl,
        moveFundRepository,
    }) {
        super({
            name: constants.NAME,
            currency: constants.CURRENCY,
            api: ethRpc,
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
            sleepTime: ethTransporterSleepTime,
            moveFundRepository,
        });
        this.estimateGasUrl = ethEstimateGasPriceUrl;
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
        await this.autoMoveFundERC20Token(configWallet, distributionWallet, distributionAddress, coldAddress, withdrawAddress, minimumDepositMap, producer);
        await this.autoMoveFundETH(distributionAddress, coldAddress, withdrawAddress, minimumDepositMap);
    }

    async autoMoveFundERC20Token(configWallet, distributionWallet, distributionAddress, coldAddress, withdrawAddress, minimumDepositMap, producer) {
        const tokens = await this.tokenRepository.getAll(this.name);
        await Promise.each(tokens, async token => {
            const withdrawWalletBalance = await this.api.getBalance(token, withdrawAddress);
            const threshHold = await this.walletThresholdRepository.getForwardingThreshHoldByServiceToken({ service: constants.NAME, token: token.symbol });
            const fundings = await this.fundingRepository.getAllAddressHaveFundingByToken({ service: this.name, currency: token.symbol });
            console.log("token ", token.symbol, " fundings ", fundings);
            let totalMoveFund = new Decimal(0);
            await Promise.each(fundings, async (funding) => {
                const address = await this.addressRepository.findById({ service: this.name, _id: funding.addressId });
                if (this.isEligibledAmount(token.symbol, funding, minimumDepositMap) && this.isNotWithdrawOrDistributionAddress(address, withdrawAddress, distributionAddress)) {
                    let encodeData = "";
                    let toAddress = "";
                    let moveFundAmount = 0;
                    const wallet = await this.walletRepository.getById({ service: this.name, _id: funding.walletId ? funding.walletId : address.walletId });
                    // is not withdraw wallet
                    if (address.address !== withdrawAddress) {
                        if (threshHold.eq(0) || withdrawWalletBalance.add(totalMoveFund).gte(threshHold)) {
                            encodeData = this.api.getEncodeData(coldAddress, address.address, funding.amount, token);
                            moveFundAmount = funding.amount;
                            totalMoveFund = totalMoveFund.add(funding.amount);
                            toAddress = coldAddress;
                        } else {
                            if (new Decimal(funding.amount).gt(threshHold.sub(withdrawWalletBalance))) {
                                moveFundAmount = threshHold.sub(withdrawWalletBalance);
                            } else {
                                moveFundAmount = funding.amount;
                            }
                            encodeData = this.api.getEncodeData(withdrawAddress, address.address, moveFundAmount, token);
                            totalMoveFund = totalMoveFund.add(moveFundAmount);
                            toAddress = withdrawAddress;
                        }
                        const gasLimit = await this.api.getEstimateGas(address.address, token, encodeData);
                        const gasPrice = await this.getCurrentGasPrice();
                        const addressETHBalance = await this.api.getBalanceETH(address.address);
                        const transactionFee = new Decimal(gasLimit).mul(gasPrice).div(constants.ETH_TO_GWEI);
                        if (new Decimal(addressETHBalance).lt(transactionFee)) {
                            const distributionAmount = transactionFee.sub(addressETHBalance);
                            await this.distributorGas(configWallet, distributionWallet, distributionAddress, address, gasPrice, distributionAmount, producer);
                        }
                        const transactionHash = await this.moveFundERC20(wallet, address, token, encodeData, gasLimit, gasPrice);
                        if (transactionHash) {
                            console.log(" completed move fund ", moveFundAmount, " ", token.symbol, " from address :", address.address, " to address :", toAddress, " transactionHash :", transactionHash);
                            await this.moveFundRepository.create({ service: this.name, currency: token.symbol, address: address.address, amount: moveFundAmount, minerFee: 0, feeCurrency: constants.NAME, retries: 0, status: this.fundingRepository.status.TRANSFERED, errorMsg: "", transactionHash });
                            return transactionHash;
                        }
                    }
                }
            });
        });
    }

    async autoMoveFundETH(distributionAddress, coldAddress, withdrawAddress, minimumDepositMap) {
        const withdrawWalletBalance = await this.api.getBalanceETH(withdrawAddress);
        const threshHold = await this.walletThresholdRepository.getForwardingThreshHoldByServiceToken({ service: this.name, token: constants.CURRENCY });
        const fundings = await this.fundingRepository.getAllAddressHaveFundingByToken({ service: this.name, currency: constants.CURRENCY });
        console.log("fundings ", fundings);
        var totalMoveFund = new Decimal(0);
        await Promise.each(fundings, async (funding) => {
            const address = await this.addressRepository.findById({ service: this.name, _id: funding.addressId });
            if (this.isEligibledAmount(constants.CURRENCY, funding, minimumDepositMap) && this.isNotWithdrawOrDistributionAddress(address, withdrawAddress, distributionAddress)) {
                let toAddress = "";
                let moveFundAmount;
                console.log(" movefund from ", address.address, " amount ", funding.amount);
                const wallet = await this.walletRepository.getById({ service: this.name, _id: funding.walletId });
                /// is not withdraw address
                if (address.address !== withdrawAddress) {
                    const gasPrice = await this.getCurrentGasPrice();
                    if (threshHold.eq(0) || new Decimal(withdrawWalletBalance).add(totalMoveFund).gte(threshHold)) {
                        moveFundAmount = new Decimal(funding.amount).sub(new Decimal(gasPrice).mul(constants.GROSS_GAS_LIMIT).div(constants.ETH_TO_GWEI));
                        totalMoveFund = totalMoveFund.add(funding.amount);
                        toAddress = coldAddress;
                    } else {
                        if (new Decimal(funding.amount).gt(threshHold.sub(withdrawWalletBalance))) {
                            moveFundAmount = threshHold.sub(withdrawWalletBalance);
                        } else {
                            moveFundAmount = new Decimal(funding.amount).sub(new Decimal(gasPrice).mul(constants.GROSS_GAS_LIMIT).div(constants.ETH_TO_GWEI));
                        }
                        toAddress = withdrawAddress;
                        totalMoveFund = totalMoveFund.add(moveFundAmount);
                    }
                    const transactionHash = await this.moveFundETH(wallet, address, toAddress, moveFundAmount, constants.GROSS_GAS_LIMIT, gasPrice);
                    if (transactionHash) {
                        console.log(" completed move fund ", moveFundAmount, " ", constants.CURRENCY, " from address :", address.address, " to address :", toAddress, " transactionHash :", transactionHash);
                        await this.moveFundRepository.create({ service: this.name, currency: constants.CURRENCY, address: address.address, amount: moveFundAmount, minerFee: 0, feeCurrency: constants.NAME, retries: 0, status: this.fundingRepository.status.TRANSFERED, errorMsg: "", transactionHash });
                        return transactionHash;
                    }
                }
            }
        });
    }
    async moveFundERC20(wallet, address, token, encodeData, gasLimit, gasPrice) {
        const addressETHBalance = await this.api.getBalanceETH(address.address);
        if (new Decimal(addressETHBalance).lt(new Decimal(gasPrice).mul(gasLimit).div(constants.ETH_TO_GWEI))) {
            console.log(`address ${address.address} not enough ETH for fee`);
            return;
        }
        const masterKey = decrypt(wallet.encryptedKey, keyEncrypDB);
        const hdkey = new EthHdWallet(masterKey);
        const path = constants.bip44Prefix + address.path;
        const privateKey = hdkey.getPrivateKeyByPath(path);
        const nonce = await this.api.getNonce(address.address);
        const tx = {
            privateKey: privateKey, encodeData, toAddress: token.contractAddress, nonce: nonce, value: 0, gas_price: gasPrice, gas_limit: gasLimit
        }
        const hash = this.signTx(tx);
        const transactionHash = await this.api.getTransactionHashFromRawHash(hash);
        await this.api.broadcast(hash);
        return transactionHash;
    }

    async moveFundETH(wallet, address, toAddress, moveFundAmount, gasLimit, gasPrice) {
        const masterKey = decrypt(wallet.encryptedKey, keyEncrypDB);
        const hdkey = new EthHdWallet(masterKey);
        const path = constants.bip44Prefix + address.path;
        const privateKey = hdkey.getPrivateKeyByPath(path);
        const nonce = await this.api.getNonce(address.address);
        const tx = {
            privateKey: privateKey, encodeData: null, toAddress: toAddress, nonce: nonce, value: moveFundAmount, gas_price: gasPrice, gas_limit: gasLimit
        }
        const hash = this.signTx(tx);
        const transactionHash = await this.api.getTransactionHashFromRawHash(hash);
        await this.api.broadcast(hash);
        return transactionHash;
    }

    isEligibledAmount(tokenName, tx, minimumDepositMap) {
        let minimumDeposit = minimumDepositMap.get(tokenName) ? minimumDepositMap.get(tokenName) : 0;
        return (new Decimal(tx.amount).gte(minimumDeposit));
    }

    isNotWithdrawOrDistributionAddress(address, withdrawAddress, distributionAddress) {
        return (address.address !== withdrawAddress && address.address !== distributionAddress);
    }

    async distributorGas(configWallet, distributionWallet, distributionAddress, address, gasPrice, distributionAmount, producer) {
        if (!distributionWallet) {
            await this.notificationToAdmin({ type: this.notified_type.walletNotConfigured, producer, configWallet, walletNotConfigured: "Distribution " });
            console.log("distribution wallet not yet configured!");
            return;
        }
        const distributionWalletBalance = await this.api.getBalanceETH(distributionAddress);
        if (distributionWalletBalance.lt(distributionAmount)) {
            console.log("distribution wallet not enough balance!");
            await this.notificationToAdmin({ type: this.notified_type.distributionWalletBalance, producer, configWallet, address: distributionAddress, toAddress: address.address, amount: distributionAmount, asset: constants.CURRENCY });
            return;
        }
        const masterKey = decrypt(distributionWallet.encryptedKey, keyEncrypDB);
        const wallet = new EthHdWallet(masterKey);
        const path = constants.bip44Prefix + '0';
        const privateKey = wallet.getPrivateKeyByPath(path);
        const nonce = await this.api.getNonce(distributionAddress);
        const tx = {
            privateKey: privateKey, toAddress: address.address, nonce: nonce, value: distributionAmount, gas_price: gasPrice, gas_limit: constants.GROSS_GAS_LIMIT
        }
        const hash = this.signTx(tx);
        const transactionHash = await this.api.getTransactionHashFromRawHash(hash);
        const response = await this.api.broadcast(hash);
        if (response) {
            if (configWallet.isNotified) {
                await this.walletConfigRepository.updateIsNotified({ service: constants.NAME, isNotified: true });
            }
            console.log(" completed distribution ", distributionAmount, " to ", address.address);
            /// convert gwei to ether
            const gas = new Decimal(response.gasUsed).mul(gasPrice).div(constants.ETH_TO_GWEI);
            await this.distributionRepository.create({ service: constants.NAME, currency: constants.CURRENCY, address: address.address, amount: distributionAmount, minerFee: gas, feeCurrency: constants.CURRENCY, status: this.distributionRepository.status.SUCCESS, errorMsg: "", transactionHash })
        }
    }


    async getCurrentGasPrice() {
        const { estimateGasPrice } = await this.walletConfigRepository.getByService({ service: this.name });
        try {
            const method = "GET";
            const headers = {
                "Content-Type": "application/json"
            };
            const options = { method, headers };
            const raw = await fetch(this.estimateGasUrl, options);
            const result = await raw.json();
            const gasPrice = new Decimal(result.average).div(10).round().toFixed();
            await this.walletConfigRepository.updateEstimateGasPrice({ service: this.name, estimateGasPrice: gasPrice })
            return gasPrice;
        } catch (ex) {
            console.log("ex ",ex);
            return new Decimal(estimateGasPrice);
        }
    }

    signTx({ privateKey, encodeData, toAddress, nonce, value, gas_price, gas_limit }) {
        const pk = Buffer.from(privateKey, "hex");
        const gasPrice = this.api.convertToWei(gas_price, "gwei");
        const gasLimit = this.api.convertToBN(gas_limit);
        let amount = '0x0';
        if (!encodeData) {
            amount = this.api.convertToWei(new Decimal(value).mul(constants.ETH_TO_GWEI), "gwei");
        }
        const txOptions = {
            nonce,
            gasLimit,
            gasPrice,
            to: toAddress,
            value: amount,
            data: encodeData
        };
        const tx = new EthereumTx(txOptions, { 'chain': 'rinkeby' });
        tx.sign(pk);
        return addHexPrefix(tx.serialize().toString("hex"));
    }
}
module.exports = EthTransporter;
