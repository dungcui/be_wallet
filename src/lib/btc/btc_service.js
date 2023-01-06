const Promise = require("bluebird");
const _ = require("lodash");
const isEmpty = _.isEmpty;
const Service = require("../service");
const constants = require("./btc_constants");
const Decimal = require("decimal.js");


class BtcService extends Service {
  constructor({
    walletRepository,
    walletConfigRepository,
    walletThresholdRepository,
    btcRpc,
    tokenRepository,
    addressRepository,
    withdrawRepository,
    fundingRepository,
    btcInterpreter: interpreter,
  }) {
    super({
      name: constants.NAME,
      currency: constants.CURRENCY,
      api: btcRpc,
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
}
module.exports = BtcService;
