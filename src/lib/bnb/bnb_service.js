const Promise = require("bluebird");
const _ = require("lodash");
const isEmpty = _.isEmpty;
const utils = require("./bnb_utils");
const debug = require("debug")("wallet_service");
const Service = require("../service");
const constants = require("./bnb_constants");
const { Decimal } = require("decimal.js");
const { DataGrouper } = require("../../utils");
const { signMessage, decrypt } = require("../../utils");
const { keyEncrypDB } = require("../config");
const { BnbHdWallet } = require("./bnb_hdwallet");

class BnbService extends Service {
  constructor({
    walletRepository,
    walletConfigRepository,
    walletThresholdRepository,
    bnbRpc,
    tokenRepository,
    addressRepository,
    withdrawRepository,
    fundingRepository,
    bnbInterpreter: interpreter,
    bnbGasPrice,
  }) {
    super({
      name: constants.NAME,
      currency: constants.CURRENCY,
      api: bnbRpc,
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
    this.bnbGasPrice= bnbGasPrice;
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
    const hex = await this.api.bnbCall(object);
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
  
  // async withdraw(req){
  //   const configWallet = await this.walletConfigRepository.getByService({ service: constants.NAME });
  //   if (!configWallet || !configWallet.withdrawWalletId) {
  //       // await this.notificationToAdmin({ type: notified_type.walletNotConfigured, configWallet, producer, walletNotConfigured: "Withdraw " });
  //       throw new Error("wallet not found");
  //     } else {
  //       const withdrawWallet = await this.walletRepository.getById({ service: constants.NAME, _id: configWallet.withdrawWalletId });
  //       const masterKey = decrypt(withdrawWallet.encryptedKey, keyEncrypDB);
  //       const hdkey = new BnbHdWallet(masterKey);
  //       const path = constants.bip44Prefix + '0';
  //       const privateKey = hdkey.getPrivateKeyByPath(path);
  //       const withdrawAddress = decrypt(withdrawWallet.encryptedAddress, keyEncrypDB);
  //       var balanceMaps = await this.fundingRepository.getMapBalanceAddressWallet({ service: constants.NAME, walletId: configWallet.withdrawWalletId, to: withdrawAddress })
  //       const gasPrice = await this.getCurrentGasPrice();
  //       if(new Decimal(req.amount).gt(balanceMaps.get(req.asset))){
  //         throw new Error("wallet not enough balance");
  //       }
  //       const nonce = await this.api.getNonce(withdrawAddress);
  //       let hash="";
  //       if (req.asset !== constants.CURRENCY) {
  //           hash = await this.transferBEP20(req, withdrawAddress, nonce, privateKey, gasPrice);
  //       } else {
  //           hash = await this.transferBNB(req, withdrawAddress, nonce, privateKey, gasPrice);
  //       }
    
  //       if (!_.isEmpty(hash)) {
  //           let transactionHash = await this.api.getTransactionHashFromRawHash(hash);
  //           await Promise.delay(200);
  //           const response = await this.api.broadcast(hash);
  //           if (response) {
  //               // await this.withdrawRepository.updateTransactionHash({ service: constants.NAME, withdrawalId: request.withdrawalId, transactionHash, outputIndex: 0, status: this.withdrawRepository.status.TRANSFERED, errorMsg: error });
  //               return {
  //                   transactionHash: transactionHash,
  //               }
  //           } else {
  //               return {
  //                   transactionHash: transactionHash,
  //               }
  //           }
  //       } else {
  //           return {
  //               transactionHash: transactionHash,
  //           }
  //       }
  //     }
  //   }

    async transferBEP20(request, withdrawAddress, nonce, privateKey, gasPrice) {
      const token = await this.tokenRepository.findByServiceAndSymbol({ service: constants.NAME, symbol: request.asset });
      const encodeData = this.api.getEncodeData(request.address, withdrawAddress, request.amount, token);
      const gasLimit = await this.api.getEstimateGas(withdrawAddress, token, encodeData);
      const tx = {
          privateKey: privateKey, encodeData: encodeData, toAddress: token.contractAddress, nonce: nonce, value: 0, gas_price: gasPrice, gas_limit: gasLimit
      }
      const hash = await this.signTx(tx);
      return hash;
  }


  async transferBNB(request, withdrawAddress, nonce, privateKey, gasPrice) {
      const tx = {
          privateKey: privateKey, encodeData: null, toAddress: request.address, nonce: nonce , value: request.amount, gas_price: gasPrice, gas_limit: constants.GROSS_GAS_LIMIT
      }
      const hash = await this.signTx(tx);
      return hash;
  }


  async signTx({ privateKey, encodeData, toAddress, nonce, value, gas_price, gas_limit }) {
      const pk = Buffer.from(privateKey, "hex");
      const gasPrice = this.api.convertToWei(gas_price, "gwei");
      const gasLimit = this.api.convertToBN(gas_limit);
      let amount = '0x0';
      if (!encodeData) {
          amount = this.api.convertToWei(new Decimal(value).mul(constants.ETH_TO_GWEI), "gwei");
      }


      const rawTx = {
          to: toAddress,
          nonce,
          gasPrice,
          gas : gasLimit,
          value: amount,
          data: encodeData
      }
        
      const tx = await this.api.signTx(rawTx,privateKey);
      return tx.rawTransaction;
  }


  async getCurrentGasPrice() {
      // const { estimateGasPrice } = await this.walletConfigRepository.getByService({ service: this.name });
      try {
          const mbnbod = "GET";
          const headers = {
              "Content-Type": "application/json"
          };
          // const options = { mbnbod, headers };
          // const raw = await fetch(this.estimateGasUrl, options);
          // const result = await raw.json();
          const gasPrice = new Decimal(this.bnbGasPrice).round().toFixed();
          // await this.walletConfigRepository.updateEstimateGasPrice({ service: this.name, estimateGasPrice: gasPrice })
          return gasPrice;
      } catch (ex) {
          // return new Decimal(estimateGasPrice);
      }
  }
}
module.exports = BnbService;
