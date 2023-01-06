const Promise = require('bluebird');
const Monitor = require('../monitor');
const Decimal = require('decimal.js');
const constants = require('./btc_constants');
const { rangeToArray } = require('../../utils');


class BtcMonitor extends Monitor {
    constructor({
        balancesHashRepository,
        btcSleepTime,
        btcMinimumBlockConfirm,
        btcRpc,
        syncBlockRepository,
        tokenRepository,
        walletRepository,
        btcInterpreter,
        fundingRepository,
        withdrawRepository,
        addressRepository,
        distributionRepository
    }) {
        super({
            api: btcRpc,
            name: constants.NAME,
            currency: constants.CURRENCY,
            syncBlockRepository,
            tokenRepository,
            walletRepository,
            interpreter: btcInterpreter,
            fundingRepository,
            withdrawRepository,
            addressRepository,
            distributionRepository,
            minimumConfirmation: btcMinimumBlockConfirm,
            sleepTime: btcSleepTime,
            balancesHashRepository,
        });
    }

    async fetchRange(fromHeight, toHeight) {
        if (fromHeight > toHeight) return;
        const heights = rangeToArray(fromHeight, toHeight);
        await Promise.each(heights, async (height) => {
            if (!this.isRunning) return;
            const blockHash = await this.api.getBlockHashByHeight(height);
            const block = await this.api.getBlock(blockHash);
            const transactions = [];
            await Promise.each(block.tx, async (tx) => {
                const rawTx = await this.parseTransaction(tx, height);
                transactions.push(...rawTx);
            }, { concurrency: 1 });
            const nextBlock = { hash: block.hash, timestamp: new Date(block.time), height, transactions };
            this.nextBlocks.push(nextBlock);
        });

    }

    async parseTransaction(tx, blockHeight) {
        const transaction = await this.api.getRawTx(tx);
        let inputs = null;
        const vin = transaction.vin.filter(inp => inp.txid && inp.vout >= 0);
        const [input] = vin;
        const isWithdrawal =
            input && (await this.fundingRepository.findFundingByTxHashAndOutputIndex({ service: this.name, transactionHash: input.txid, outputIndex: input.vout, type: this.fundingRepository.type.FUNDING }));
        if (isWithdrawal) {
            // ...
            inputs = await Promise.map(transaction.vin, async inp => ({
                ...inp,
                transactionHash: inp.txid,
                outputIndex: inp.vout,
            }));
        }
        const outputs = [];
        // parse vout
        await Promise.each(transaction.vout, async (out) => {
            const { scriptPubKey, n, value: amount } = out;
            const { addresses } = scriptPubKey;
            let address = null;
            if (addresses && addresses.length > 0) {
                [address] = addresses;
                outputs.push({
                    inputs,
                    blockHeight,
                    height: blockHeight,
                    currency: constants.CURRENCY,
                    feeCurrency: constants.FEE_CURRENCY,
                    amount: amount,
                    to: address,
                    toAddress: address ? (await this.addressRepository.findByAddressHashWithLowerCase({ service: constants.NAME, address })) : null,
                    transactionHash: transaction.txid,
                    outputIndex: n,
                    script: scriptPubKey.hex,
                });
            }
        });
        return outputs;
    }

    validateBlock(block, fromHeight, toHeight) {
        return block && (
            block.height === fromHeight &&
            block.height <= toHeight
        );
    }
}

module.exports = BtcMonitor;
