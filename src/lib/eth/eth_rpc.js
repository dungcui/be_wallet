const jayson = require("jayson");
const Promise = require("bluebird");
const Web3 = require("web3");
const NODE_ENV = process.env.NODE_ENV;
const abiTemplate = require("./eth_erc20_abi");
const { Decimal } = require("decimal.js");
const constants = require("./eth_constants");

class EthRpc {
    constructor({ ethNodeUrl, ethTestnetNodeUrl }) {
        this.nodeUrl = NODE_ENV == "production" ? ethNodeUrl : ethTestnetNodeUrl;
        if (!this.nodeUrl) {
            throw Error('Please provide ETHEREUM_NODE_URL');
        }
        this.web3 = new Web3();
        this.sleepTime = 10;
        this.MAX_ATTEMPT = 20;
        this.web3.setProvider(new Web3.providers.WebsocketProvider(this.nodeUrl));
    }

    async initWSConnect() {
        this.web3._provider.on("connect", async () => {
            return;
        });
        this.web3._provider.on("error", async () => {
            console.log("aaa");
            await Promise.delay(1000 * this.sleepTime);
            var provider = new Web3.providers.WebsocketProvider(this.nodeUrl);
            provider.on('connect', function () {
                console.log('WSS Reconnected');
            });

            this.web3.setProvider(provider);
            return;
        });
        this.web3._provider.on("end", async () => {
            console.log("aaa");
            console.log("WS closed");
            console.log("Attempting to reconnect...");
            await Promise.delay(1000 * this.sleepTime);
            var provider = new Web3.providers.WebsocketProvider(this.nodeUrl);
            provider.on('connect', function () {
                console.log('WSS Reconnected');
            });
            this.web3.setProvider(provider);
            return;
        });
    }

    async ethCall(object, attempt = 0) {
        try {
            await this.initWSConnect();
            return (await this.web3.eth.call(object));
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            console.log("ex ", ex);
            await Promise.delay(1000 * this.sleepTime);
            return await this.ethCall(object, attempt + 1);
        }
    }

    async getLogsERC20Address(option, attempt = 0) {
        try {
            await this.initWSConnect();
            return (await this.web3.eth.getPastLogs(option));
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            console.log("ex ", ex);
            await Promise.delay(1000 * this.sleepTime);
            return await this.getLogsERC20Address(option, attempt + 1);
        }
    }

    async getBlock(number, verbose = true, attempt = 0) {
        try {
            await this.initWSConnect();
            const blockInfo = await this.web3.eth.getBlock(number, verbose);
            return blockInfo;
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getBlock(number, attempt + 1);
        }
    }

    async getBlockHashByHeight(height, verbose = true, attempt = 0) {
        try {
            await this.initWSConnect();
            const block = await this.web3.eth.getBlock(height, verbose);
            return block;
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getBlockHashByHeight(
                height,
                attempt + 1
            );
        }
    }

    async getRawTx(txHash, attempt = 0) {
        try {
            await this.initWSConnect();
            const transaction = await this.web3.eth.getTransaction(txHash);
            return transaction;
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getRawTx(txHash, attempt + 1);
        }
    }

    async getTransactionReceipt(txHash, attempt = 0) {
        try {
            await this.initWSConnect();
            const transaction = await this.web3.eth.getTransactionReceipt(txHash);
            return transaction;
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getTransactionReceipt(txHash, attempt + 1);
        }
    }

    async decodeRawTransaction(rawTransaction, attempt = 0) {
        try {
            await this.initWSConnect();
            return this.web3.utils.sha3(rawTransaction);
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.decodeRawTransaction(rawTransaction, attempt + 1);
        }
    }

    async getTransactionFromBlock(hashStringOrNumber, index, attempt = 0) {
        try {
            await this.initWSConnect();
            const transaction = await this.web3.eth.getTransactionFromBlock(
                hashStringOrNumber,
                index
            );
            return transaction;
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getTransactionFromBlock(
                hashStringOrNumber,
                index,
                attempt + 1
            );
        }
    }

    async getLatestBlockHeight(attempt = 0) {
        try {
            await this.initWSConnect();
            const number = await this.web3.eth.getBlockNumber();
            if (!number) {
                const sync = await this.web3.eth.isSyncing();
                if (sync) {
                    return sync.currentBlock;
                }
                return 0;
            }
            return number;
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
            await this.initWSConnect();
            const data = await this.web3.eth.sendSignedTransaction(`${hex}`);
            return data;
        } catch (ex) {
            console.log("error ",ex);
        }
    }

    async getBalanceETH(address, attempt = 0) {
        try {
            await this.initWSConnect();
            const balance = await this.web3.eth.getBalance(address);
            return new Decimal(balance).div(constants.ETH_TO_WEI);
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getBalanceETH(address, attempt + 1);
        }
    }

    async getBalance(token, address, attempt = 0) {
        try {
            await this.initWSConnect();
            const contract = new this.web3.eth.Contract(abiTemplate, token.contractAddress);
            const balance = await contract.methods
                .balanceOf(address)
                .call((err, result) => {
                    return result;
                });
            const grossBalance = new Decimal(balance).div(Math.pow(10, token.decimals));
            return new Decimal(grossBalance);
        } catch (ex) {
            console.log("ex ", ex);
            if (attempt >= this.MAX_ATTEMPT) {
                console.log(` failed ${attempt} times `, ex);
                return 0;
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getBalance(token, address, attempt + 1);
        }
    }



    async getTokenBalance(contractAddress, address, attempt = 0) {
        try {
            await this.checkConnection();
            const contract = new this.web3.eth.Contract(ABI.abi, contractAddress);
            const balance = await contract.methods
                .balanceOf(address)
                .call();
            return balance;
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getTokenBalance(contractAddress, address, attempt + 1);
        }
    }

    async getNonce(address, attempt = 0) {
        try {
            await this.initWSConnect();
            const nonce = await this.web3.eth.getTransactionCount(address);
            return nonce;
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                throw Error(`Failed after ${attempt} retries , exit.`);
            }
            await Promise.delay(1000 * this.sleepTime);
            return await this.getNonce(address, attempt + 1);
        }
    }

    async isAddress(address) {
        try {
            const valid = this.web3.utils.isAddress(address);
            return { valid };
        } catch (ex) {
            return { valid: false };
        }
    }

    getEncodeData(toAddress, fromAddress, amount, token) {
        if (token) {
            const myContract = new this.web3.eth.Contract(abiTemplate, token.contractAddress, {
                from: fromAddress
            });
            const decimals = this.convertToBN(token.decimals);
            const tokenAmount = this.convertToBN(
                new Decimal(amount).mul(Math.pow(10, decimals)).round().toFixed()
            );
            const tokenAmountHex = "0x" + tokenAmount.toString("hex");
            const encodeData = myContract.methods
                .transfer(toAddress, tokenAmountHex)

                .encodeABI();
            return encodeData;
        } else {
            return "";
        }
    }
    convertToWei(value, fromType) {
        return this.convertToBN(
            this.web3.utils.toWei(this.convertToBN(value), fromType)
        );
    }

    convertWeiToETH(value) {
        return this.web3.utils
            .fromWei(this.convertToBN(value));
    }


    convertToBN(value) {
        return this.web3.utils.toBN(`${value}`);
    }

    async getEstimateGas(from, token, encodeData, attempt = 0) {
        try {
            await this.initWSConnect();
            const gas = await this.web3.eth.estimateGas({
                from: from,
                to: token.contractAddress,
                data: encodeData
            });
            return new Decimal(gas).mul(1.15).round();
        } catch (ex) {
            if (attempt >= this.MAX_ATTEMPT) {
                return null;
            }
            console.log("ex ", ex);
            await Promise.delay(1000 * this.sleepTime);
            return await this.getEstimateGas(from, token, encodeData, attempt + 1);
        }
    }
    async getTransactionHashFromRawHash(hash) {
        return await this.web3.utils.sha3(hash);
    }

}

module.exports = EthRpc;
