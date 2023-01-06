const constants = require("./eth_constants");
const web3 = require("web3");
const { isEmpty } = require("lodash");
const { keyEncrypDB } = require("../config");
const { encrypt, decrypt } = require("../../utils");
const utils = require("./eth_utils");
const Promise = require("bluebird");


const { generateMnemonic, generateMasterKey, EthHdWallet } = require("./eth_hdwallet");


class EthInterpreter {
    constructor({ tokenRepository, walletRepository, walletThresholdRepository, addressRepository, fundingRepository, ethRpc, syncBlockRepository }) {
        this.api = ethRpc;
        this.syncBlockRepository = syncBlockRepository;
        this.addressRepository = addressRepository;
        this.fundingRepository = fundingRepository;
        this.walletRepository = walletRepository;
        this.tokenRepository = tokenRepository;
        this.walletThresholdRepository = walletThresholdRepository;
    }

    async parseTransaction(transaction, blockHeight) {
        const amount = web3.utils
            .fromWei(new web3.utils.BN(transaction.value))
            .toString();
        let feeAmount = web3.utils
            .fromWei(new web3.utils.BN(transaction.gas));
        let toAddress = "";
        if (transaction.to)
            toAddress = await this.addressRepository.findByAddressHashWithLowerCase({ service: constants.NAME, address: transaction.to.toLowerCase() })
        return {
            ...transaction,
            blockHeight,
            outputIndex: 0,
            currency: constants.NAME,
            feeCurrency: constants.FEE_CURRENCY,
            transactionHash: transaction.hash,
            fromAddress: transaction.from,
            toAddress: toAddress,
            amount,
            feeAmount
        };
    }

    async generateWallet(req) {
        const {
            currency,
            walletName,
        } = req;
        try {
            let mnemonic;
            let masterKey;
            let wallet;
            let settlementAddress;
                // generate address with path = 0 address type is settlement
            mnemonic = generateMnemonic();
            masterKey = generateMasterKey(mnemonic);
            wallet = await this.walletRepository.create({
                service: currency,
                walletName: walletName,
                encryptedKey: encrypt(masterKey, keyEncrypDB),
            });
            const { address: generatedAddress } = await this.generateAddress({ currency: req.currency, path: 0 }, wallet);
            settlementAddress = generatedAddress;
            await this.walletRepository.updateAddress({ _id: wallet._id, encryptedAddress: encrypt(settlementAddress, keyEncrypDB) });
        
        const responseData = {
            walletId: wallet._id,
            walletName: wallet.walletName,
            mnemonic: mnemonic,
            masterKey: masterKey,
            walletAddress: settlementAddress,
        };
            return responseData;
        } catch (e) {
            throw new Error(e.message)
        }
    }


    async generateAddress(req, walletDeposit) {
        const { currency, path } = req;
        try {
            const masterKey = decrypt(walletDeposit.encryptedKey, keyEncrypDB);
            const wallet = new EthHdWallet(masterKey);
            let hdPath = constants.bip44Prefix + path;
            const address = wallet.deriveByPath(hdPath);
            this.addressRepository.create(
                {
                    service: currency, walletId: walletDeposit._id
                    , type: path === this.addressRepository.path.SETTLEMENT
                        ? this.addressRepository.type.SETTLEMENT
                        : path === this.addressRepository.path.COLDWALLET
                            ? this.addressRepository.type.COLDWALLET
                            : this.addressRepository.type.USER
                    , path: path, address: address, memo: ""
                }
            )
            const responseData = { address: address };
            return responseData;
        } catch (e) {
            throw new Error(e.message)
        }
    }

}

module.exports = EthInterpreter;
