const Promise = require("bluebird");
const _ = require("lodash");
const isEmpty = _.isEmpty;
const utils = require("./eth_utils.js");
const debug = require("debug")("wallet_service");
const Service = require("../service");
const constants = require("./eth_constants");
const Decimal = require("decimal.js");
const { DataGrouper } = require("../../utils");


class EthService extends Service {
  constructor({
    walletRepository,
    walletConfigRepository,
    walletThresholdRepository,
    ethRpc,
    tokenRepository,
    addressRepository,
    withdrawRepository,
    fundingRepository,
    ethInterpreter: interpreter,
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
      walletThresholdRepository,
      interpreter
    })
  }
  async addSmartContract(req) {
    const { currency, contractAddress, symbol } = req;
    const existedToken = await this.tokenRepository.find({ service: currency, contractAddress: contractAddress });
    if (existedToken) {
      throw new Error(
        `Token already existed!`
      );
    }
    if (!contractAddress) {
      throw new Error(
        `Missing contractAddress!`
      );
    }
    if (!symbol) {
      throw new Error(
        `Missing symbol!`
      );
    }
    // Get decimals from Ether node
    const object = utils.getObject(contractAddress, "decimals()", []);
    const hex = await this.api.ethCall(object);
    const decimals = new Decimal(hex).toNumber();
    // If couldn't get decimals from blockchain -> throw error
    if (!decimals) {
      throw new Error(
        `Could not find decimals of the contract address ${contractAddress}`
      );
    }
    // Add to db
    await this.tokenRepository.create({
      service: currency,
      contractAddress: contractAddress.toLowerCase(),
      symbol: symbol,
      enabled: true,
      decimals
    });
    return { token: symbol, decimals, address: contractAddress };
  }
}
module.exports = EthService;
