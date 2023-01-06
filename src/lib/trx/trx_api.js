const Api = require('../api');
const TronWeb = require('tronweb');
const HttpProvider = TronWeb.providers.HttpProvider;
const NODE_ENV = process.env.NODE_ENV;
const constants = require('./trx_constants');
const Web3 = require("web3");
const web3 = new Web3('ws://localhost:8546');
const ADDRESS_PREFIX = '41';
const { Decimal } = require("decimal.js");
const Promise = require("bluebird");
const _ = require("lodash");

var ethers = require('ethers')

const AbiCoder = ethers.utils.AbiCoder;
const ADDRESS_PREFIX_REGEX = /^(41)/;

class TrxApi extends Api {
    constructor({ trxTestnetNodeUrl, trxNodeUrl }) {
        const nodeUrl = NODE_ENV == "development" ? trxTestnetNodeUrl : trxNodeUrl;
        super({
            baseUrl: nodeUrl,
            sleepTime: Number(10),
            maxAttempt: 20,
            timeout: 100000,
        });
        this.fullNode = new HttpProvider(nodeUrl);
        this.solidityNode = new HttpProvider(nodeUrl);
        this.eventServer = new HttpProvider(nodeUrl);
        this.tronWeb = new TronWeb(this.fullNode, this.solidityNode, this.eventServer);
        this.tronWeb.setHeader({ "TRON-PRO-API-KEY": 'c5e6a733-078b-43dc-bfa6-dcef5a0945be' });
        this.tronWeb.setAddress('TJ5uvEXv9vDzrP4pMK5bTAphSEc7yhFwxM');
    }

    async getBlock(num, attempt = 0) {
        try {
            return await this.tronWeb.trx.getBlock(num);
        } catch (err) {
            console.log("exception rpc tron", err);
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getBlock(num, attempt + 1);
        }
    }
    async getAccount(address, attempt = 0) {
        try {
            // 1 Trx = 1.000.000 Sun
            let account = await this.tronWeb.trx.getAccount(address);
            return account;
        } catch (err) {
            console.log("get account error", err);
            return null;
        }
    }

    async getLatestBlockHeight(attempt = 0) {
        try {
            const result = await this.tronWeb.trx.getCurrentBlock();
            if (result && result.block_header && result.block_header.raw_data.number) {
                return result.block_header.raw_data.number;
            }
        } catch (err) {
            console.log("err",err);
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getLatestBlockHeight(attempt + 1);
        }
    }

    async getAssetInfoById(assetId, attempt = 0) {
        try {
            const asset = await this.tronWeb.trx.getTokenByID(assetId);
            if (asset) {
                return asset
            } else {
                return await this.getAssetInfoById(assetId, attempt + 1);
            }
        } catch (err) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getAssetInfoById(assetId, attempt + 1);
        }
    }
    async getTokenBalance(token, address) {
        try {
            let contract = await this.tronWeb.contract().at(token.contractAddress);
            const balance = await contract.methods.balanceOf(address).call();
            const result = new Decimal(balance.toString()).div(Math.round(10, token.decimals));
            return result;
        } catch (ex) {
            console.log("ex", ex);
            console.log("get balance error", ex.message);
            return 0;
        }
    }

    async getTransactionReceipt(txid, attempt = 0) {
        try {
            const response = await this.tronWeb.trx.getTransactionInfo(txid);
            if (_.isEmpty(response)) {
                return await getUnconfirmedTransactionReceipt(txid);
            } else {
                return response;
            }
        } catch (err) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getTransactionReceipt(txid, attempt + 1);
        }
    }

    async getUnconfirmedTransactionReceipt(txid, attempt = 0) {
        try {
            const response = await this.tronWeb.trx.getUnconfirmedTransactionInfo(txid);
            return response;
        } catch (err) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getTransactionReceipt(txid, attempt + 1);
        }
    }

    async validateAddress(address) {
        try {
            const result = await this.tronWeb.isAddress(address);
            const valid = result;
            return { valid };
        } catch (err) {
            console.log("err", err);
            return { valid: false };
        }
    }

    async getInfoSmartContract(trc20ContractAddress) {
        try {
            let contract = await this.tronWeb.contract().at(trc20ContractAddress);
            let decimals = await contract.decimals().call();
            let totalSupply = await contract.totalSupply().call();
            return { decimals, totalSupply };
        } catch (ex) {
            console.log("api err", ex);
            return { decimals: null, totalSupply: null };
        }

    }
    async sendToken(address, amount, token, privateKey, feeLimit) {
        try {
            let contract = await this.tronWeb.contract().at(token.contractAddress);
            let amountToken = new Decimal(amount).mul(Math.pow(10, token.decimals)).toFixed();
            await this.tronWeb.setPrivateKey(privateKey);
            const transactionHash = await contract.transfer(address, amountToken).send({
                feeLimit: new Decimal(feeLimit).mul(constants.ONE_TRX).toNumber(),
                callValue: 0,
                shouldPollResponse: false
            });
            console.log("response", transactionHash);
            return transactionHash;
        } catch (err) {
            console.log("send token error", err);
            return null;
        }
    }

    async sendTrx(address, amount, privateKey) {
        try {
            const trxAmount = new Decimal(amount).mul(constants.ONE_TRX).toFixed();
            const response = await this.tronWeb.trx.sendTransaction(address, trxAmount, privateKey);
            if (response && response.result) {
                return response.txid;
            } else {
                return null;
            }
        } catch (err) {
            console.log("send token error", err);
            return null;
        }
    }

    async getBalanceTrx(address) {
        try {
            // 1 Trx = 1.000.000 Sun
            let balanceTrx = await this.tronWeb.trx.getBalance(address)
            balanceTrx = new Decimal(balanceTrx).div(constants.ONE_TRX);
            return balanceTrx;
        } catch (err) {
            console.log("get account error", err);
            return 0;
        }
    }


    async convertHexToStringAddress(hexAddress) {
        return await this.tronWeb.address.fromHex(hexAddress);
    }

 
    async  decodeDataSmartContract(output, ignoreMethodHash) {
        let types = ['address', 'uint256']
        if (!output || typeof output === 'boolean') {
            ignoreMethodHash = output;
            output = types;
        }
    
        if (ignoreMethodHash && output.replace(/^0x/, '').length % 64 === 8)
            output = '0x' + output.replace(/^0x/, '').substring(8);
    
        if (output.replace(/^0x/, '').length % 64)
            throw new Error('The encoded string is not valid. Its length must be a multiple of 64.');
    
        const abiCoder = new AbiCoder();
        const decoded = await abiCoder.decode(['address', 'uint256'], output)
        let address = ADDRESS_PREFIX + decoded['0'].substr(2).toLowerCase();
        address = await this.tronWeb.address.fromHex(address)
        let amount = decoded['1']
        return { address, amount : amount.toString() }
    }
}   

module.exports = TrxApi;
