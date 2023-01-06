const { HDPrivateKey } = require('bitcore-lib');
const constants = require('./trx_constants');
const NODE_ENV = process.env.NODE_ENV;
const Mnemonic = require("bitcore-mnemonic");
const { encrypt, decrypt } = require("../../utils");
const { keyEncrypDB } = require("../config");
const bch = require('bitcore-lib-cash');
const trc20Utils = require('./trx_utils');

class TrxInterpreter {
    constructor({ tokenRepository, walletRepository, walletThresholdRepository, addressRepository, fundingRepository, trxApi, syncBlockRepository }) {
        this.api = trxApi;
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
            mnemonic = new Mnemonic();
            masterKey = mnemonic.toHDPrivateKey().toString();
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
                mnemonic: mnemonic.toString(),
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
            const wallet = new HDPrivateKey(masterKey);
            let hdPath = constants.bip44Prefix + path;
            const publicKey = wallet.derive(hdPath).publicKey.toString('hex');
            let address = "";
            address = trc20Utils.getAddressFromPublicKey(publicKey);
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

module.exports = TrxInterpreter;
