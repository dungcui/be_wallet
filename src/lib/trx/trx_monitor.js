const { Decimal } = require("decimal.js");
const Promise = require('bluebird');
const Monitor = require('../monitor');
const constants = require('./trx_constants');
const { rangeToArray } = require('../../utils');
const trc20Utils = require('./trx_utils');
const _ = require("lodash");
class TrxMonitor extends Monitor {
    constructor({
        balancesHashRepository,
        trxSleepTime,
        trxMinimumBlockConfirm,
        trxApi,
        syncBlockRepository,
        tokenRepository,
        walletRepository,
        trxInterpreter,
        fundingRepository,
        withdrawRepository,
        addressRepository,
        distributionRepository
    }) {
        super({
            balancesHashRepository,
            api: trxApi,
            name: constants.NAME,
            currency: constants.CURRENCY,
            syncBlockRepository,
            tokenRepository,
            walletRepository,
            interpreter: trxInterpreter,
            fundingRepository,
            withdrawRepository,
            addressRepository,
            distributionRepository,
            minimumConfirmation: trxMinimumBlockConfirm,
            sleepTime: trxSleepTime,
        });
    }

    async fetchRange(fromHeight, toHeight) {
        if (fromHeight > toHeight) return;
        const heights = rangeToArray(fromHeight, toHeight);
        // await Promise.each(heights.reverse(), async (height) => {
        await Promise.each(heights, async (height) => {
            if (!this.isRunning) return;
            const block = await this.api.getBlock(height);
            const txs = block.transactions ? block.transactions : []
            const transactions = [];
            await Promise.each(txs, async (transaction) => {
                try {
                    const parsedTx = await this.parseTransaction(transaction, height);
                    if (parsedTx) {
                        transactions.push(parsedTx);
                    }
                } catch (error) {
                    console.log('error', error);
                }
            });
            const nextBlock = { hash: block.blockID, timestamp: block.block_header.raw_data.timestamp, height, transactions };
            this.nextBlocks.push(nextBlock);
        }, { concurrency: 1 });
    }

    async parseTransaction(transaction, blockHeight) {
        if (this.isTriggerSmartContract(transaction)) {
            const contractAddress = await this.api.convertHexToStringAddress(transaction.raw_data.contract[0].parameter.value.contract_address);
            const smartContract = await this.tokenRepository.findContractByAddressAndService({ service: this.name, contractAddress });
            // USDT contract: TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
            if (smartContract) {
                const decodeData = await this.api.decodeDataSmartContract(transaction.raw_data.contract[0].parameter.value.data, true);
                const decimalsContract = smartContract.decimals;
                const fromAddress = trc20Utils.getBase58CheckAddress(transaction.raw_data.contract[0].parameter.value.owner_address);
                const toAddress = decodeData.address
                const amount = new Decimal(decodeData.amount).div(Math.pow(10, decimalsContract));
                return {
                    ...transaction,
                    blockHeight,
                    outputIndex: 0,
                    contractAddress,
                    currency: smartContract.symbol,
                    transactionHash: transaction.txID,
                    to: toAddress,
                    toAddress: toAddress ? (await this.addressRepository.findByAddressHashWithLowerCase({ service: constants.NAME, address: toAddress })) : null,
                    fromAddress: fromAddress ? (await this.addressRepository.findByAddressHashWithLowerCase({ service: constants.NAME, address: fromAddress })) : null,
                    amount,
                }
            }
        } else if (this.isTransferTransaction(transaction)) {
            const { parameter } = transaction.raw_data.contract[0];
            const toAddress = trc20Utils.getBase58CheckAddress(parameter.value.to_address);
            const fromAddress = trc20Utils.getBase58CheckAddress(parameter.value.owner_address);
            const amount = new Decimal(parameter.value.amount).div(constants.ONE_TRX);
            return {
                blockHeight,
                outputIndex: 0,
                currency: this.currency,
                transactionHash: transaction.txID,
                to: toAddress,
                toAddress: toAddress ? (await this.addressRepository.findByAddressHash({ service: constants.NAME, address: toAddress })) : null,
                fromAddress: fromAddress ? (await this.addressRepository.findByAddressHash({ service: constants.NAME, address: fromAddress })) : null,
                amount: amount,
            }
        // } else if (this.isTransferAssetTransaction(transaction)) {
        //     const { parameter } = transaction.raw_data.contract[0];
        //     const assetIdHex = parameter.value.asset_name;
        //     let assetId;
        //     if (assetIdHex) {
        //         const buf = new Buffer.from(assetIdHex, 'hex');
        //         assetId = buf.toString('utf8');
        //         if (assetId) {
        //             const assetInfo = await this.api.getAssetInfoById(assetId);
        //             if(assetInfo && assetInfo.owner_address){
        //                 // console.log("assetInfo.data[0]",assetInfo);
        //                 const contractAddress = await this.api.convertHexToStringAddress(assetInfo.owner_address);
        //                 const smartContract = await this.tokenRepository.findContractByAddressAndService({ service: this.name, contractAddress });
        //                 if (smartContract) {
        //                     const toAddress = trc20Utils.getBase58CheckAddress(parameter.value.to_address);
        //                     const fromAddress = trc20Utils.getBase58CheckAddress(parameter.value.owner_address);
        //                     const amount = new Decimal(parameter.value.amount).div(Math.pow(10, smartContract.decimals));
        //                     return {
        //                         ...transaction,
        //                         blockHeight,
        //                         outputIndex: 0,
        //                         currency: smartContract.symbol,
        //                         contractAddress,
        //                         transactionHash: transaction.txID,
        //                         to: toAddress,
        //                         toAddress: toAddress ? (await this.addressRepository.findByAddressHashWithLowerCase({ service: constants.NAME, address: toAddress })) : null,
        //                         fromAddress: fromAddress ? (await this.addressRepository.findByAddressHashWithLowerCase({ service: constants.NAME, address: fromAddress })) : null,
        //                         amount: amount,
        //                     }
        //                 }
        //             }
        //         }
        //     }
        }
    }

    isTriggerSmartContract(tx) {
        if (tx.raw_data.contract[0].type === 'TriggerSmartContract')
            return true;
    }

    isTransferTransaction(tx) {
        return tx.raw_data.contract[0].type === 'TransferContract';
    }

    isTransferAssetTransaction(tx) {
        return tx.raw_data.contract[0].type === 'TransferAssetContract';
    }


    validateBlock(block, fromHeight, toHeight) {
        if (!block) return false;
        this.heightPassing = (
            block.height === fromHeight &&
            block.height <= toHeight
        );
        return this.heightPassing;
    }

    async getBundlePayload({ type, currency, transactions }) {
        const blockRef = await this.getBlockRef();
        const meta = { ...blockRef }
        const result = { type, currency, transactions, meta };
        return result;
    }
    async getBlockRef() {
        const { hash, number, timestamp } = await this.api.getLatestBlock();
        return { hash, number, timestamp };
    }
    async addMinerInfo(fundings) {
        return await Promise.map(
            fundings,
            async funding => {
                let feeAmount = 0;
                const response = await this.api.getTransactionReceipt(funding.transactionHash);
                if (response && response.fee) {
                    feeAmount = new Decimal(response.fee).div(constants.ONE_TRX);
                }
                return {
                    ...funding,
                    feeAmount: feeAmount,
                    feeCurrency: constants.FEE_CURRENCY,
                    minerStatus: !response.result !== 'FAILED' ? true : false,
                }
            }
        );
    }

}

module.exports = TrxMonitor;
