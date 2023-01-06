const debug = require("debug");
const Promise = require("bluebird");
const _ = require("lodash");
const { keyEncrypDB } = require("./config");
const serviceNames = process.env.SERVICE_NAMES.toUpperCase().split(",");
const { signMessage, encrypt, decrypt } = require("../utils");
const merge = require('array-object-merge')
const { isEmpty } = require("lodash");

class Service {
  constructor({
    name,
    currency,
    api,
    error,
    addressRepository,
    tokenRepository,
    walletRepository,
    walletConfigRepository,
    withdrawRepository,
    walletThresholdRepository,
    fundingRepository,
    interpreter,
  }) {
    // Components
    this.name = name;
    this.currency = currency;
    this.api = api;
    this.error = {
      ...error,
      INVALID_WALLET: "Invalid wallet",
      WALLET_NOT_CONFIGURED: "wallet not yet configured",
      WALLET_TYPE_NOT_VALID: "wallet type invalid",
      EMPTY_PATH: "Path empty.",
      MISSING_REQUIRE_CONFIRMED: "Missing requireConfirmed.",
      MISSING_MOVE_FUND_SLEEP_TIME: "Missing moveFundSleepTime.",
      MISSING_ADDRESS: "Missing address.",
      ADDRESS_INVALID: "Address invalid.",
      MISSING_PAYLOAD: "Missing payload.",
      WALLET_EXISTED: "wallet name existed.",
      ALREADY_HAS_WALLET: "Already has wallet.",
      MISSING_TRANSACTIONS: "Missing transactions",
      DUPLICATED_WITHDRAWAL: "Duplicated withdrawal",
      MOVE_FUND_NOT_IMPLEMENTED: "Move fund has not implemented",
      NOT_HAVE_SMART_CONTACT: "Currency not have suport smart contract",
      NOT_SUPORT_ASSET: "Asset is not support",
      GET_TOTAL_BALANCE_NOT_IMPLEMENTED:
        "Get total balance has not implemented"
    }
    this.addressRepository = addressRepository;
    this.tokenRepository = tokenRepository;
    this.walletRepository = walletRepository;
    this.withdrawRepository = withdrawRepository;
    this.walletConfigRepository = walletConfigRepository;
    this.walletThresholdRepository = walletThresholdRepository;
    this.fundingRepository = fundingRepository;
    this.interpreter = interpreter;
    this.debug = debug;
  }
  async addWallet(req) {
    const {
      currency,
      walletName,
    } = req;
    const existedWallet = await this.walletRepository.getByName({ service : currency, walletName });
    if(existedWallet) {
      throw new Error(this.error.WALLET_EXISTED);
    }
    const wallet = this.interpreter.generateWallet(req);
    return wallet;
  }

  async setRequireConfirmed(req) {
    const { currency, requireConfirmed } = req;
    if (!requireConfirmed) {
      throw new Error(this.error.MISSING_REQUIRE_CONFIRMED);
    }
    const config = await this.walletConfigRepository.updateRequireConfirmed({ service: currency, requireConfirmed });
    if (config) {
      return { status: "success" };
    } else {
      return { status: "fail" };
    }
  }


  async setMoveFundSleepTime(req) {
    const { currency, moveFundSleepTime } = req;
    if (!moveFundSleepTime) {
      throw new Error(this.error.MISSING_MOVE_FUND_SLEEP_TIME);
    }
    const config = await this.walletConfigRepository.updateMoveFundSleepTime({ service: currency, moveFundSleepTime });
    if (config) {
      return { status: "success" };
    } else {
      return { status: "fail" };
    }
  }

  async updateWallet(req) {
    const {
      currency,
      walletId,
      walletName,
      walletType,
      address,
      walletThresholds,
    } = req;
    const existedWallet = await this.walletRepository.getById({ service: currency, _id: walletId });
    if (!existedWallet) {
      throw new Error(this.error.INVALID_WALLET);
    }
    if (walletType != this.walletRepository.type.COLD && walletType != this.walletRepository.type.DEPOSIT && walletType != this.walletRepository.type.WITHDRAW && walletType != this.walletRepository.type.DISTRIBUTION) {
      throw new Error(this.error.WALLET_TYPE_NOT_VALID);
    }
    if (walletType == this.walletRepository.type.COLD) {
      const { valid } = await this.validateAddress(req);
      if (!valid) {
        throw new Error(this.error.ADDRESS_INVALID);
      }
      if (address !== decrypt(existedWallet.encryptedAddress, keyEncrypDB)) {
        await this.walletRepository.updateWalletAddress({ _id: existedWallet.id, walletName, encrypedAddress: encrypt(address, keyEncrypDB) });
        // add to address for get balance from funding
        await this.addressRepository.create(
          {
            service: currency, walletId: walletId
            , type: this.addressRepository.type.COLDWALLET
            , path: this.addressRepository.path.COLDWALLET,
            address: address, memo: ""
          });
      }
      return {
        walletId: existedWallet._id,
        walletType: walletType,
        walletName: walletName,
        walletAddress: address,
      }
    } else {
      if (walletThresholds && walletThresholds.length) {
        await Promise.each(walletThresholds, async threshold => {
          await this.walletThresholdRepository.update({ service: currency, walletId: existedWallet._id, token: threshold.assetCode, notificationThreshold: threshold.notificationThreshold, forwardThreshold: threshold.forwardThreshold });
        })
      }
      await this.walletRepository.updateWalletWithoutAddress({ _id: existedWallet.id, walletName });
      return {
        walletId: existedWallet._id,
        walletType: walletType,
        walletName: walletName,
        walletAddress: existedWallet.address,
      }
    }
  }

  async configWallet(req) {
    const {
      currency,
      depositWallet,
      coldWallet,
      withdrawalWallet,
      distributionWallet,
    } = req;
    try {
      console.log("req",req);
      const existedDepositWallet = await this.walletRepository.getById({ service: currency, _id: depositWallet });
      const existedWithdrawWallet = await this.walletRepository.getById({ service: currency, _id: withdrawalWallet });
      const existedDistributionWallet = await this.walletRepository.getById({ service: currency, _id: distributionWallet });
      if (isEmpty(existedDistributionWallet) ||  isEmpty(existedDepositWallet) || isEmpty(existedWithdrawWallet)) {
        throw new Error(this.error.INVALID_WALLET)
      }
      const encryptedColdWallet =  encrypt(coldWallet, keyEncrypDB);
      const configETH = await this.walletConfigRepository.update({
        service: currency,
        depositWalletId: existedDepositWallet._id,
        withdrawWalletId: existedWithdrawWallet._id,
        distributionWalletId: existedDistributionWallet._id,
        encryptedColdWallet: encryptedColdWallet,
      });
      const responseData = configETH;

      return responseData;
    } catch (e) {
      throw new Error(e.message);
    }
  }

  async getAddress(req) {
    const { currency, path } = req;
    if (!path) {
      throw Error(this.error.EMPTY_PATH)
    }
    const configWallet = await this.walletConfigRepository.getByService({ service: currency });

    if (!configWallet || !configWallet.depositWalletId) {
      throw Error(this.error.WALLET_NOT_CONFIGURED)
    }
    const existedAddress = await this.addressRepository.findByServiceAndWalletIdAndPath({ service: currency, walletId: configWallet.depositWalletId, path: path })
    console.log("existedAddress",existedAddress);
    if (existedAddress) {
      return { address: existedAddress.address };
    } else {
      const depositWallet = await this.walletRepository.getById({ service: currency, _id: configWallet.depositWalletId });
      const address = this.interpreter.generateAddress(req, depositWallet);
      return address;
    }
  }
  async getWalletInfo(req) {
    const {
      currency,
      walletId,
    } = req;
    if (walletId) {
      const existedWallet = await this.walletRepository.getById({ service: currency, _id: walletId });
      if (!existedWallet) {
        throw new Error(this.error.INVALID_WALLET);
      }
      const walletThresholdsConfiged = await this.walletThresholdRepository.getByWalletId({ service: currency, walletId: walletId });
      const tokens = await this.tokenRepository.getAll(currency);
      // get full threshold for all token, currency
      const fullWalletThreshold = tokens.map(token => {
        return {
          assetCode: token.symbol,
          notificationThreshold: 0,
          forwardThreshold: 0,
        }
      });
      fullWalletThreshold.push({ assetCode: this.currency, notificationThreshold: 0, forwardThreshold: 0 })
      return {
        walletId: existedWallet._id,
        walletName: existedWallet.walletName,
        walletType: existedWallet.walletType,
        walletThresholds: merge({ arr: fullWalletThreshold }, {
          arr: walletThresholdsConfiged, field: 'newkey'
        }, "assetCode").arr,
      }
    }
  }

  async addSmartContract(req) {
    throw new Error(this.error.NOT_HAVE_SMART_CONTACT)
  }


  async validateAddress(req) {
    const { address, tag } = req;
    const valid = await this.api.isAddress(address, tag);
    return valid;
  }

  async setWalletThreshold(req) {
    const {
      currency,
      assetCode,
      notificationThreshold,
      forwardingThreshold,
      minimumDeposit,
    } = req;

    const configedThreshold = await this.walletThresholdRepository.update({ service: currency, token: assetCode, notificationThreshold, forwardingThreshold, minimumDeposit });
    if (configedThreshold) {
      return {
        status: "success"
      };
    } else return {
      status: "fail"
    }
  }

  async withdrawalRequest(req) {
    const { currency, withdrawalId, address, tag, amount, asset } = req;
    const formatedRequest = { currency: req.currency, withdrawalId: req.withdrawalId, address: req.address, tag: req.tag, amount: req.amount, asset: req.asset };
    try {
      const existedWithdrawal = await this.withdrawRepository.findByWithdrawalId({ withdrawalId });
      if (existedWithdrawal) {
        throw Error(this.error.DUPLICATED_WITHDRAWAL);
      }
      const existedToken = await this.tokenRepository.findByServiceAndSymbol({ service: currency, symbol: asset });
      if (serviceNames.indexOf(asset) == -1 && _.isEmpty(existedToken)) {
        throw Error(this.error.NOT_SUPORT_ASSET);
      }
      const { valid } = await this.validateAddress(req);
      if (!valid) {
        throw Error(this.error.ADDRESS_INVALID);
      }
      const singnatureData = signMessage(JSON.stringify(formatedRequest), keyEncrypDB);
      await this.withdrawRepository.create({ service: currency, withdrawalId, asset, address, amount, tag, signature: singnatureData })
      return { withdrawalId, status: this.withdrawRepository.status.PENDING }
    } catch (er) {
        throw Error(er.message);
    }
  }

  async multilpleWithdrawalRequest(req) {
    const { currency, withdraws } = req;
    return await Promise.map(withdraws,async withdraw =>{
      const formatedRequest = { currency: currency, withdrawalId: withdraw.withdrawalId, address: withdraw.address, tag: withdraw.tag, amount: withdraw.amount, asset: withdraw.asset };
      try {
        const existedWithdrawal = await this.withdrawRepository.findByWithdrawalId({ withdrawalId : withdraw.withdrawalId });
        if (existedWithdrawal) {
          throw Error(this.error.DUPLICATED_WITHDRAWAL);
        }
        const existedToken = await this.tokenRepository.findByServiceAndSymbol({ service: currency, symbol: withdraw.asset });
        if (serviceNames.indexOf(withdraw.asset) == -1 && _.isEmpty(existedToken)) {
          throw Error(this.error.NOT_SUPORT_ASSET);
        }
        const { valid } = await this.validateAddress(withdraw);
        if (!valid) {
          throw Error(this.error.ADDRESS_INVALID);
        }
        const singnatureData = signMessage(JSON.stringify(formatedRequest), keyEncrypDB);
        await this.withdrawRepository.create({ service: currency, withdrawalId :withdraw.withdrawalId, asset :withdraw.asset, address : withdraw.address, amount:withdraw.amount, tag:withdraw.tag, signature: singnatureData })
        return { withdrawalId :withdraw.withdrawalId, status: this.withdrawRepository.status.PENDING }
      } catch (er) {
          throw Error(er.message);
      }
    })
  }
    

  // async withdraw(req) {
  // }

  async getTotalWallet() {
    const wallets = await this.walletRepository.getAllByService({ service: this.name });
    const walletBalance = await Promise.map(wallets, async wallet => {
      const funding = await this.fundingRepository.getAllAvaiableFundingsByServiceAndWalletId({ service: this.name, walletId: wallet._id.toString() });
      let totalAddress;
      const walletAddress = await this.addressRepository.getTotalAddressOfWalletId({ service: this.name, walletId: wallet._id.toString() });
      if (walletAddress && walletAddress.length) {
        totalAddress = walletAddress[0].totalAddress;
      } else {
        totalAddress = 0;
      }
      if (!funding) {
        return {
          walletId: wallet._id,
          totalAddress: totalAddress,
          total: [],
        }
      } else {
        return {
          walletId: wallet._id,
          totalAddress: totalAddress,
          total: funding,
        }
      }
    })
    return walletBalance;
  }

  async getListWallet() {
    const wallets = await this.walletRepository.getAllByService({ service: this.name });
    const walletBalance = await Promise.map(wallets, async wallet => {
      const funding = await this.fundingRepository.getAllAvaiableFundingsByServiceAndWalletId({ service: this.name, walletId: wallet._id.toString() });
      let totalAddress;
      const walletAddress = await this.addressRepository.getTotalAddressOfWalletId({ service: this.name, walletId: wallet._id.toString() });
      if (walletAddress && walletAddress.length) {
        totalAddress = walletAddress[0].totalAddress;
      } else {
        totalAddress = 0;
      }
      if (!funding) {
        return {
          walletId: wallet._id,
          totalAddress: totalAddress,
          total: [],
        }
      } else {
        return {
          walletId: wallet._id,
          totalAddress: totalAddress,
          total: funding,
        }
      }
    })
    return walletBalance;
  }
}

module.exports = Service;
