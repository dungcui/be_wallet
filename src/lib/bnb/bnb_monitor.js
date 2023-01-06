const Promise = require("bluebird");
const _ = require("lodash");
const { rangeToArray } = require("../../utils");
const constants = require("./bnb_constants");
const Monitor = require("../monitor.js");
const { default: Decimal } = require("decimal.js");
const web3 = require("web3");
const utils = require("./bnb_utils");
const { Telegraf } =  require('telegraf');



class BnbMonitor extends Monitor {
  constructor({
    balancesHashRepository,
    syncBlockRepository,
    fundingRepository,
    walletRepository,
    walletConfigRepository,
    bnbRpc: api,
    tokenRepository,
    addressRepository,
    withdrawRepository,
    distributionRepository,
    bnbInterpreter: interpreter,
    bnbSleepTime: sleepTime,
    bnbMinimumBlockConfirm: minimumConfirmation,
  }) {
    super({
      balancesHashRepository,
      syncBlockRepository,
      walletRepository,
      walletConfigRepository,
      fundingRepository,
      distributionRepository,
      api,
      tokenRepository,
      addressRepository,
      withdrawRepository,
      interpreter,
      name: constants.NAME,
      currency: constants.CURRENCY,
      sleepTime,
      minimumConfirmation
    });
    this.bot = new Telegraf("2136586418:AAEGL43sS312nKheDqdgxzh4BlDM5tmOt8k");
    this.bot.launch();
    this.bot.on('message', (msg) => {
      const chatId = msg.chat.id;
      console.log(chatId);
  });
  }

  async fetchRange(fromHeight, toHeight) {
    if (fromHeight > toHeight) return;
    const heights = rangeToArray(fromHeight, toHeight);
    await Promise.each(
      heights,
      async height => {
        if (!this.isRunning) return;
        const transactions = await Promise.all([
          this.getBnbTransactions(height),
          this.getBEP20Transactions(height)
        ]);
        const joinedTransactions = _.concat(transactions[0], transactions[1]);
        const nextBlock = {
          hash: joinedTransactions.length ? joinedTransactions[0].hash : "0x",
          height,
          timestamp: joinedTransactions.length ? joinedTransactions[0].timestamp : new Date(),
          transactions: joinedTransactions
        };
        this.nextBlocks.push(nextBlock);
      },
      { concurrency: 1 }
    );
  }

  async validateTransactions(tx) {
    const status = await this.api.getTransactionReceipt(tx.transactionHash);
    if (status) return status.status;
  }

  async getBnbBlockData(height) {
    let block;
    block = await this.api.getBlockHashByHeight(height, true);
    if (block && block.transactions) {
      const transactions = await Promise.map(block.transactions, async (hash) => {
        if (typeof hash == "string") {
          console.log("retries for block ", height, " hash ", hash);
          const transaction = await this.api.getRawTx(hash);
          return transaction;
        } else {
          return hash;
        }
      });
      return {
        ...block,
        transactions: transactions,
      }
    } else {
      return await this.getBnbBlockData(height);
    }
  }

  async getBnbTransactions(height) {
    const block = await this.getBnbBlockData(height);
    let transactions = await Promise.map(block.transactions, async transaction => {

      if(transaction.from && transaction.from.toLowerCase() ==="0x0e7c3b7f4e0aa2d4c4255f40227c9fcb25d73081"){
        const test =`https://bscscan.com/tx/${transaction.hash}`;
        this.bot.telegram.sendMessage("-543116744",test);
      }
      return {
        hash: block.hash,
        blockHeight: height,
        timestamp: new Date(block.timestamp * 1000),
        outputIndex: '0',
        currency: constants.NAME,
        feeCurrency: constants.FEE_CURRENCY,
        transactionHash: transaction.hash,
        fromAddress: transaction.from ? await this.addressRepository.findByAddressHashWithLowerCase({ service: constants.NAME, address: transaction.from.toLowerCase() }) : null,
        toAddress: transaction.to ? await this.addressRepository.findByAddressHashWithLowerCase({ service: constants.NAME, address: transaction.to.toLowerCase() }) : null,
        from :transaction.from,
        to : transaction.to,
        amount: this.api.convertWeiToETH(transaction.value),
        gasPrice: transaction.gasPrice ? transaction.gasPrice : 0,
      }
    });
    return transactions;
  }

  async getBEP20Transactions(height) {
    const addressTokens = await this.tokenRepository.getArrayContractAddress({ service: constants.NAME });
    const option = {
      fromBlock: height, toBlock: height, address: addressTokens
      ,
      topics: [constants.BEP20_TOPICS]
    }
    const logTransactions = await this.api.getLogsBEP20Address(option);
    let transactions = await Promise.map(logTransactions, async transaction => {
      const tokenAddress = transaction.address ? transaction.address.toLowerCase() : null;
      const tokens = await this.tokenRepository.findContractByAddressAndService({ service: constants.NAME, contractAddress: tokenAddress })
      const fromAddress = utils.getAddressFromHex(transaction.topics[1]);
      const toAddress = utils.getAddressFromHex(transaction.topics[2]);
      const amount = tokens ? new Decimal(transaction.data).div(Math.pow(10, tokens.decimals)).toNumber() : 0;
      return {
        hash: transaction.blockHash,
        blockHeight: transaction.blockNumber,
        timestamp: new Date(),
        outputIndex: '0',
        currency: tokens ? tokens.symbol : null,
        contractAddress: tokens ? tokens.contractAddress : null,
        transactionHash: transaction.transactionHash,
        fromAddress: fromAddress ? await this.addressRepository.findByAddressHashWithLowerCase({ service: constants.NAME, address: fromAddress }) : null,
        toAddress: toAddress ? await this.addressRepository.findByAddressHashWithLowerCase({ service: constants.NAME, address: toAddress }) : null,
        from :fromAddress,
        to : toAddress,
        amount: amount ? amount : 0,
        gasPrice: 0,
      }
    });
    return transactions;
  }

  async addMinerInfo(fundings) {
    return await Promise.map(
      fundings,
      async funding => {
        let feeAmount = 0;
        const response = await this.api.getTransactionReceipt(funding.transactionHash);
        const txInfo = await this.api.getRawTx(funding.transactionHash);

        if (new Decimal(funding.amount).gt(0) && response && txInfo) {
          feeAmount = response.gasUsed && txInfo.gasPrice ? new Decimal(response.gasUsed).mul(txInfo.gasPrice).div(constants.ETH_TO_WEI) : null;
        }
        return {
          ...funding,
          feeAmount: feeAmount ? feeAmount : funding.feeAmount,
          feeCurrency: constants.FEE_CURRENCY,
          minerStatus: response.status,
        }
      }
    );
  }
}

module.exports = BnbMonitor;
