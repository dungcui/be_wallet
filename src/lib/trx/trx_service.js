const Promise = require("bluebird");
const _ = require("lodash");
const isEmpty = _.isEmpty;
const Service = require("../service");
const constants = require("./trx_constants");
const Decimal = require("decimal.js");


class TrxService extends Service {
    constructor({
        walletRepository,
        walletConfigRepository,
        walletThresholdRepository,
        trxApi,
        tokenRepository,
        addressRepository,
        withdrawRepository,
        fundingRepository,
        trxInterpreter: interpreter,
    }) {
        super({
            name: constants.NAME,
            currency: constants.CURRENCY,
            api: trxApi,
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
        });
    }

    async validateAddress(req) {
        const { address } = req;
        console.log("address ", address);
        return await this.api.validateAddress(address)
    }

    async addSmartContract(req) {
        const { currency, contractAddress, symbol } = req;
        console.log("currency ", currency, " contractAddress ", contractAddress, "symbol ", symbol);
        const existedToken = await this.tokenRepository.find({ service: currency, contractAddress: contractAddress });
        if (existedToken) {
            return { token: existedToken.symbol, decimals: existedToken.decimals, address: existedToken.contractAddress };

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
        const { decimals } = await this.api.getInfoSmartContract(contractAddress);

        // If couldn't get decimals from blockchain -> throw error
        if (!decimals) {
            throw new Error(
                `Could not find decimals of the contract address ${contractAddress}`
            );
        }
        // Add to db
        await this.tokenRepository.create({
            service: currency,
            contractAddress: contractAddress,
            symbol: symbol,
            enabled: true,
            decimals
        });
        return { token: symbol, decimals, address: contractAddress };
    }
}
module.exports = TrxService;
