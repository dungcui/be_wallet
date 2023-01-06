const Promise = require("bluebird");
const TinyQueue = require("tinyqueue");
const { EventEmitter } = require("events");
const { buildBalancesHash, buildConfirmWithdrawals } = require("../utils");
const { Decimal } = require("decimal.js");
const _ = require("lodash");
const { keyEncrypDB } = require("./config");
const { signMessage, decrypt } = require("../utils");

class Monitor extends EventEmitter {
  constructor({
    balancesHashRepository,
    syncBlockRepository,
    walletRepository,
    walletConfigRepository,
    api,
    tokenRepository,
    addressRepository,
    withdrawRepository,
    fundingRepository,
    distributionRepository,
    interpreter,
    name,
    currency,
    sleepTime,
    minimumConfirmation
  }) {
    super();
    this.syncBlockRepository = syncBlockRepository;
    this.walletRepository = walletRepository;
    this.walletConfigRepository = walletConfigRepository;
    this.api = api;
    this.tokenRepository = tokenRepository;
    this.addressRepository = addressRepository;
    this.withdrawRepository = withdrawRepository;
    this.fundingRepository = fundingRepository;
    this.distributionRepository = distributionRepository;
    this.interpreter = interpreter;
    this.canStop = true;
    this.nextBlocks = [];
    this.isRunning = false;
    this.nextBlocks = new TinyQueue([], (a, b) => a.height - b.height);
    this.name = name;
    this.currency = currency;
    this.sleepTime = Number(sleepTime);
    this.minimumConfirmation = Number(minimumConfirmation);
    this.balancesHashRepository = balancesHashRepository;
  }

  async start() {
    this.isRunning = true;
    this.canStop = false;
    await this.run();
    this.canStop = true;
  }

  async stop() {
    this.isRunning = false;
    console.log("Attempt to stop...");
    if (this.canStop) {
      console.log("Stopped.");
      return;
    }
    await Promise.delay(1000 * this.sleepTime);
    await this.stop();
  }

  async run() {
    while (this.isRunning) {
      await this.monitorNetwork();
    }
  }
  async monitorNetwork() {
    try {
      let syncedBlock = await this.syncBlockRepository.get({ service: this.name });
      const latestHeight = parseInt(await this.api.getLatestBlockHeight());
      /// calculator transactionhash confirmed block 
      // use lastest block height -1 for genesis monitor
      if (!syncedBlock || (syncedBlock && syncedBlock.height == -1)) {
        syncedBlock = await this.syncBlockRepository.update({ service: this.name, height: latestHeight - 1 })
      }
      const currentHeight = syncedBlock
        ? syncedBlock.height
        : latestHeight - 1;

      const confirmedHeight = latestHeight - this.minimumConfirmation;

      if (currentHeight < confirmedHeight) {
        // Fetch and process at the same time
        await Promise.all([
          this.reproduceBalancesHash(),
          this.fetchRange(currentHeight + 1, confirmedHeight),
          this.processRange(currentHeight + 1, confirmedHeight)
        ]);
      } else {
        // Reach confirmed height, nothing to do
        await Promise.delay(1000 * this.sleepTime);
      }
    } catch (ex) {
      console.log("ex", ex);
      console.log(`${this.name}_monitor` + " Exception ", ex);
      this.canStop = true;
      await this.stop();
      await this.start();
    }
  }

  async shouldProcessNextBlock(fromHeight, toHeight) {
    // Pre-validate
    if (!this.isRunning || fromHeight > toHeight) return false;
    // get new block from queue with peek()  to validate 
    const nextBlock = this.nextBlocks.peek();
    if (this.validateBlock(nextBlock, fromHeight, toHeight)) return true;
    await Promise.delay(1000 * this.sleepTime);
    return this.shouldProcessNextBlock(fromHeight, toHeight);
  }

  validateBlock(block, fromHeight, toHeight) {
    return block && (block.height >= fromHeight && block.height <= toHeight);
  }


  async processRange(fromHeight, toHeight) {
    if (await this.shouldProcessNextBlock(fromHeight, toHeight)) {
      const nextBlock = this.nextBlocks.pop();
      //get new block from queue with peek  to process, then remove from queue
      await this.processBlock(nextBlock);
      await this.processRange(parseInt(nextBlock.height) + 1, toHeight);
    }
  }


  async reproduceBalancesHash() {
    const failedBalanceHash = await this.balancesHashRepository.getErrorBalanceHash({ service: this.name });
    // console.log("failedBalanceHash", failedBalanceHash);
    await Promise.each(failedBalanceHash, async balanceHash => {
      const block = balanceHash.balancesHash;
      const signature = signMessage(block, keyEncrypDB);
      if (signature === balanceHash.signature) {
        await this.balancesHashRepository.update({ service: this.name, balancesHash: block, status: "success" });
        this.emit("block", JSON.parse(block));
      }
    });
  }


  async processBlock(nextBlock) {
    var { height, hash, timestamp, transactions } = nextBlock;
    try {
      /// filter funding tx, ignore distribution funding
      const fundings = await this.buildFundings(transactions);
      const balancesHash = buildBalancesHash(fundings);
      console.log("")
      await Promise.each(fundings, async tx => {
        await this.fundingRepository.add(tx);
      });
      const withdrawals = await this.buildWithdrawals(transactions);
      console.log("withdrawals", withdrawals);
      const confirmedWithdrawals = buildConfirmWithdrawals(withdrawals);
      console.log(" confirmedWithdrawals ", confirmedWithdrawals);
      await Promise.each(withdrawals, tx => this.processWithdrawal(tx));
      await Promise.each(withdrawals, async tx => {
        if (tx.withdrawalId) {
          if (tx.minerStatus) {
            await this.withdrawRepository.updateStatus({ service: this.name, withdrawalId: tx.withdrawalId, transactionHash: tx.transactionHash, outputIndex: tx.outputIndex, minerFee: tx.feeAmount, feeCurrency: tx.feeCurrency, status: this.withdrawRepository.status.SUCCESS, errorMsg: "" });
          } else {
            await this.withdrawRepository.updateStatusForRetryErrorTransaction({ service: this.name, withdrawalId: tx.withdrawalId });
          }
        }
      });
      // Submit new block
      const block = { hash, height, network: this.name, timestamp, balancesHash, confirmedWithdrawals };
      console.log(`Processed block ${height}`);
      await this.syncBlockRepository.update({ service: this.name, height });
      if (balancesHash.length || confirmedWithdrawals.length) {
        //emit to worker done with event
        this.emit("block", block);
      }
    } catch (err) {
      console.log(`${this.name}_monitor` + " Exception ", err);
    }
  }

  async buildFundings(transactions) {
    // Filter all txid for our deposit    
    const isFunding = transaction => transaction.toAddress;
    const isSupportedCurrency = async tx => {
      const { currency, contractAddress } = tx;
      return (
        currency === this.currency ||
        await this.tokenRepository.isEnabled({ service: this.name, symbol: currency, contractAddress })
      );
    };
    const isNotExisted = async tx => {
      const { transactionHash, outputIndex } = tx;
      return !(await this.fundingRepository.findFundingByTxHashAndOutputIndex(
        {
          service: this.name,
          transactionHash,
          outputIndex,
          type: this.fundingRepository.type.FUNDING
        }
      ));
    };

    const isNotDistributionTransaction = async tx => {
      const { transactionHash } = tx;
      const distribution = await this.distributionRepository.findByTransactionHash({ service: this.name, transactionHash });
      return _.isEmpty(distribution);
    };

    const isHavingAmout = tx => {
      const { amount } = tx;
      return new Decimal(amount).gt(0);
    };

    const addFundingAttributes = tx => ({
      service: this.name,
      transactionHash: tx.transactionHash,
      outputIndex: tx.outputIndex,
      type: this.fundingRepository.type.FUNDING,
      blockHeight: tx.blockHeight,
      amount: tx.amount,
      currency: tx.currency,
      to: tx.toAddress.address,
      addressId: tx.toAddress._id,
      walletId: tx.toAddress.walletId,
      toAddress: tx.toAddress,
      from : tx.from,
      script: tx.script,
      status: this.fundingRepository.status.CONFIRMED,
    });
    const fundingTransaction = await Promise.filter(
      transactions,
      async tx => {
        return (
          isFunding(tx) &&
          await isSupportedCurrency(tx) &&
          await isNotExisted(tx) &&
          await isNotDistributionTransaction(tx) &&
          isHavingAmout(tx)
        );
      },
      { concurrency: 1 }
    );

    const addMinerInfoFundings = await this.addMinerInfo(fundingTransaction);
    const validatedFunding = Promise.filter(
      addMinerInfoFundings,
      tx => {
        return (
          this.validateTransactions(tx)
        );
      }
    );

    return validatedFunding.map(addFundingAttributes);
  }

  // override by other blockchain 
  async validateTransactions(tx) {
    return true;
  }
  // override by other blockchain 
  async addMinerInfo(fundings) {
    return Promise.map(
      fundings, funding => {
        return {
          ...funding,
          minerStatus: true,
        }
      });
  }

  async buildWithdrawals(transactions) {
    console.log("*----- Monitor.buildWithdrawals -----*");
    const isUTXO = transaction =>
      transaction.inputs && transaction.inputs.length > 0;
    const isWithdrawal = transaction => transaction.fromAddress;
    const isGoingToProcess = async ({ transactionHash, outputIndex }) => {
      const withdrawal = await this.withdrawRepository.findByServiceTransactionHashAndIndex(
        { service: this.name, transactionHash, outputIndex: outputIndex }
      );
      return !withdrawal || withdrawal.status === this.withdrawRepository.status.TRANSFERED;
    };


    const filtedWithdrawals = await Promise.filter(
      transactions,
      async tx => {
        const goingToProcess = await isGoingToProcess(tx);
        return (isUTXO(tx) || isWithdrawal(tx)) && goingToProcess;
      },
      { concurrency: 1 }
    );
    const withdrawMinerInfo = await this.addMinerInfo(filtedWithdrawals);
    const withdrawals = await Promise.map(withdrawMinerInfo, async tx => {
      const withdraw = await this.withdrawRepository.findByServiceTransactionHashAndIndex({ service: this.name, transactionHash: tx.transactionHash, outputIndex: tx.outputIndex });
      return {
        ...tx,
        withdrawalId: withdraw ? withdraw.withdrawalId : null,
        status: this.withdrawRepository.status.SUCCESS,
        feeAmount: (withdraw && withdraw.minerFee) ? withdraw.minerFee : tx.feeAmount,
        service: this.name,
      }
    })
    return withdrawals;
  }

  async processWithdrawal(withdrawal) {
    console.log("*----- Monitor.processWithdrawal -----*");
    if (withdrawal.inputs) {
      // This is for Bxx currencies
      await Promise.each(withdrawal.inputs, input =>
        this.spend(
          {
            ...input,
            currency: withdrawal.currency,
            spentInTransactionHash: withdrawal.transactionHash
          }
        )
      );
    } else if (withdrawal.currency === withdrawal.feeCurrency) {
      // This is for others, which need virtual fundings
      // Same fee currency, combine amount, 1 spend
      console.log("withdrawal.amount ", withdrawal.amount);
      console.log("withdrawal.feeAmount ", withdrawal.feeAmount);
      if (withdrawal.amount != null && withdrawal.feeAmount != null && !_.isUndefined(withdrawal.feeAmount) && !_.isUndefined(withdrawal.amount)) {
        await this.spendVirtually(
          {
            ...withdrawal,
            amount: new Decimal(withdrawal.amount)
              .add(withdrawal.feeAmount)
          }
        );
      }
    } else {
      // Same as above but different fee currency, 2 spends
      await this.spendVirtually(withdrawal);
      // ignore fee in that phase
      try {
        if (withdrawal.feeAmount && withdrawal.feeCurrency) {
          await this.spendVirtually(
            {
              ...withdrawal,
              amount: withdrawal.feeAmount,
              currency: withdrawal.feeCurrency
            }
          );
        }
      } catch (error) {
        this.debug(error.stack);
      }
    }
  }

  async spend({ transactionHash, outputIndex, spentInTransactionHash, currency }) {
    await this.fundingRepository.markAsSpent(
      {
        service: this.name,
        transactionHash,
        outputIndex,
        spentInTransactionHash,
        currency: currency,
      }
    );
  }

  // Spend amount of currency from address, at hash
  async spendVirtually({ fromAddress, currency, amount, transactionHash, blockHeight }) {
    console.log("*---- monitor.spendVirtually ----*");
    const unspentFundings = await this.fundingRepository.findAllUnspentByAddressAndCurrency({
      addressId: fromAddress._id,
      currency
    });
    const total = unspentFundings.reduce(
      (sum, tx) => sum.add(tx.amount),
      new Decimal(0)
    );

    const changeAmount = total.sub(amount);
    console.log("changeAmount", changeAmount);
    // if (changeAmount.lt(0)) {
    //   throw Error("Not enough money to spend");
    // }
    // No need to add 0 funding
    if (changeAmount.gt(0)) {
      const changeFunding = {
        currency,
        blockHeight,
        outputIndex: 0,
        transactionHash,
        service: this.name,
        to: fromAddress.address,
        addressId: fromAddress.id,
        walletId: fromAddress.walletId,
        amount: changeAmount.toFixed(),
        type: this.fundingRepository.type.VIRTUAL,
        state: this.fundingRepository.status.CONFIRMED
      };
      await this.fundingRepository.add(changeFunding);
    }
    await Promise.each(unspentFundings, async tx => {
      await this.fundingRepository.maskSpentById(
        {
          service: this.name,
          _id: tx._id,
          spentInTransactionHash: transactionHash
        }
      )
    });
  }
}


module.exports = Monitor;
