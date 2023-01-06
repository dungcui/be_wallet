const { decrypt } = require("../../utils");
const {keyEncrypDB} = require("../../lib/config");
class WalletRepository {

    constructor({ WalletModel }) {
        this.WalletModel = WalletModel;
        this.type = {
            COLD: "cold",
            DISTRIBUTION: "distribution",
            WITHDRAW: "withdraw",
            DEPOSIT: "deposit",
        };
    }

    async create({ service, walletName, walletType, encryptedKey, encryptedAddress, encryptedXpubKey }) {
        return await this.WalletModel.create({ service, walletName, walletType, encryptedKey, encryptedAddress, encryptedXpubKey });
    }

    async get({ service, walletName, walletType }) {
        return await this.WalletModel.findOne({ service, walletName, walletType });
    }

    async getByName({ service, walletName }) {
        return await this.WalletModel.findOne({ service, walletName });
    }
    async getById({ service, _id }) {
        return await this.WalletModel.findOne({ service, _id });
    }
    async updateAddress({ _id, encryptedAddress }) {
        return await this.WalletModel.findOneAndUpdate({ _id }, { encryptedAddress });
    }

    async updateWalletAddress({ _id, walletName, encryptedAddress }) {
        return await this.WalletModel.findOneAndUpdate({ _id }, { walletName, encryptedAddress });
    }

    async updateWalletWithoutAddress({ _id, walletName }) {
        return await this.WalletModel.findOneAndUpdate({ _id }, { walletName });
    }

    async getAllByService({ service }) {
        return await this.WalletModel.find({ service });
    }

    async getPagingList({ skip, limit, search }) {
        let wallets;
        if(search){
            wallets =  await this.WalletModel.find(( { $or : [{ walletName: {$regex: '.*' + search + '.*'}},{service: {$regex: '.*' + search + '.*'}}]})).skip(parseInt(skip)).limit(parseInt(limit)).sort("created_at");
        } else {
            wallets =  await this.WalletModel.find().skip(parseInt(skip)).limit(parseInt(limit)).sort("created_at");
        }
        const items = wallets.map(item =>{
            return {
                _id :item._id,
                service:item.service,
                walletName:item.walletName,
                address: decrypt(item.encryptedAddress,keyEncrypDB),
            }
        });
        const total = await this.WalletModel.countDocuments();
        return { data : items, total: total};
    }
}

module.exports = WalletRepository;