const jayson = require("jayson");
const Promise = require("bluebird");
const NODE_ENV = process.env.NODE_ENV;
const { Address } = require('bitcore-lib');
const { default: Decimal } = require("decimal.js");

class BtcRpc {
    constructor({ btcNodeUrl, btcTestnetNodeUrl }) {
        this.nodeUrl = NODE_ENV == "production" ? btcNodeUrl : btcTestnetNodeUrl;
        this.sleepTime = 10;
        this.MAX_ATTEMPT = 20;
        if (!this.nodeUrl) {
            throw Error("Please provide BTC_NODE_URL");
        }
        this.client = Promise.promisifyAll(jayson.client.http(this.nodeUrl));
    }

    async getBlock(blockHash, raw, attempt = 0) {
        try {
            return (await this.client.requestAsync("getblock", [blockHash, !raw]))
                .result;
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getBlock(blockHash, raw, attempt + 1);
        }
    }

    async getBlockHashByHeight(height, attempt = 0) {
        try {
            return (await this.client.requestAsync("getblockhash", [height])).result;
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getBlockHashByHeight(height, attempt + 1);
        }
    }

    async getRawTx(txHash, verbose = 1, attempt = 0) {
        try {
            return (await this.client.requestAsync("getrawtransaction", [
                txHash,
                verbose
            ])).result;
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getRawTx(txHash, verbose, attempt + 1);
        }
    }

    async decodeRawTransaction(rawTransaction, attempt = 0) {
        try {
            return (await this.client.requestAsync("decoderawtransaction", [
                rawTransaction
            ])).result;
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.decodeRawTransaction(rawTransaction, attempt + 1);
        }
    }

    async getLatestBlockHeight(attempt = 0) {
        try {
            return (await this.client.requestAsync("getblockcount", [])).result;
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getLatestBlockHeight(attempt + 1);
        }
    }

    async broadcast(hex, attempt = 0) {
        try {
            return (await this.client.requestAsync("sendrawtransaction", [hex]))
                .result;
        } catch (ex) {
            console.log(`err as broadcast ${ex.message} `);
            return null;
        }
    }

    async isAddress(address) {
        try {
            let hash = "";
            if (NODE_ENV == "development") {
                hash = Address.fromString(address, "testnet");
            } else if (NODE_ENV == "production") {
                hash = Address.fromString(address, "mainnet");
            }
            if (hash.toString() !== address) {
                return { valid: false };
            }
            return { valid: true };
        } catch (err) {
            console.log("err", err);
            return { valid: false };
        }
    }
    // feerate : BTC/KB convert to byte..
    async getSmartFee(minBlockConfirm = 4) {
        let feePerKB = 0;
        let feePerByte = 0;
        const result = (await this.client.requestAsync("estimatesmartfee", [
            minBlockConfirm
        ])).result;
        feePerKB = 0.00001;
        feePerByte = new Decimal(feePerKB).div(1000);
        return feePerByte;
    }
}

module.exports = BtcRpc;
