const { Address, HDPrivateKey, Networks } = require('bitcore-lib');
const constants = require('./btc_constants');
const Promise = require('bluebird');
const NODE_ENV = process.env.NODE_ENV;
const Mnemonic = require("bitcore-mnemonic");
const { encrypt, decrypt } = require("../../utils");
const { keyEncrypDB } = require("../config");
const bch = require('bitcore-lib-cash');

class BtcInterpreter {
    constructor({ tokenRepository, walletRepository, walletThresholdRepository, addressRepository, fundingRepository, btcRpc, syncBlockRepository }) {
        this.api = btcRpc;
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
            let address = "";
            if (NODE_ENV == "development") {
                address = new Address(wallet.derive(hdPath).publicKey, Networks.testnet).toString();
            } else if (NODE_ENV == "production") {
                address = new Address(wallet.derive(hdPath).publicKey, Networks.mainnet).toString();
            }
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

    buildBroadcastedWithdrawals(transaction) {
        const { txid: transactionHash, vout } = transaction;
        return vout.map(out => ({
            amount: out.value * constants.BTC_TO_SATOSHI,
            currency: constants.CURRENCY,
            toAddress: out.scriptPubKey.addresses[0],
            outputIndex: out.n,
            transactionHash,
        }));
    }

    buildInputWithdrawals(transaction) {
        const { vin } = transaction;
        return vin.map(input => ({
            txid: input.txid,
            vout: input.vout,
        }));
    }

    async deserializeTx(raw) {
        const rawTx = await this.api.decodeRawTransaction(raw);
        return {
            transactionHash: rawTx.txid,
            ...rawTx,
        };
    }

    async getMeta(wallet) {
        return { walletId: wallet.id };
    }
}

module.exports = BtcInterpreter;
