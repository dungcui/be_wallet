const constants = require("./bnb_constants");
const web3 = require("web3");
const { isEmpty } = require("lodash");
const { keyEncrypDB } = require("../config");
const { encrypt, decrypt } = require("../../utils");
const Promise = require("bluebird");


const { generateMnemonic, generateMasterKey, BnbHdWallet } = require("./bnb_hdwallet");


class BnbInterpreter {
    constructor({ tokenRepository, walletRepository, walletThresholdRepository, addressRepository, fundingRepository, bnbRpc, syncBlockRepository }) {
        this.api = bnbRpc;
        this.syncBlockRepository = syncBlockRepository;
        this.addressRepository = addressRepository;
        this.fundingRepository = fundingRepository;
        this.walletRepository = walletRepository;
        this.tokenRepository = tokenRepository;
        this.walletThresholdRepository = walletThresholdRepository;
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
            const wallet = new BnbHdWallet(masterKey);
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

module.exports = BnbInterpreter;
