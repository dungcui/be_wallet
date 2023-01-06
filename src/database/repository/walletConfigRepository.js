const { decrypt } = require("../../utils");
const {keyEncrypDB} = require("../../lib/config");
const Promise = require("bluebird");

class WalletConfigRepository {

    constructor({ WalletConfigModel , WalletModel}) {
        this.WalletConfigModel = WalletConfigModel;
        this.WalletModel = WalletModel;
    }
    async update({ service , depositWalletId, withdrawWalletId, distributionWalletId, encryptedColdWallet }){
        return await this.WalletConfigModel.findOneAndUpdate({ service }, { depositWalletId ,withdrawWalletId, distributionWalletId , encryptedColdWallet}, {
                upsert: true, 
                new: true
            });
    }

    async getByService({ service }) {
        return await this.WalletConfigModel.findOne({ service });
    }

    async getPagingList({ skip, limit, search }) {
        console.log("skip",skip);
        console.log("limit",limit);
        console.log("search",search);

        let wallets ;
        if(search){
            wallets =  await this.WalletConfigModel.find({service: {$regex: '.*' + search + '.*'}}).skip(parseInt(skip)).limit(parseInt(limit)).sort("created_at");
        } else {
            wallets =  await this.WalletConfigModel.find().skip(parseInt(skip)).limit(parseInt(limit)).sort("created_at");
        }
        console.log("wallets",wallets);
        const items = await Promise.map(wallets, async(item)  => {
            return {
                service:item.service,
                deposit_wallet: (await this.WalletModel.findOne({_id : item.depositWalletId})),
                withdrawal_wallet: (await this.WalletModel.findOne({_id : item.withdrawWalletId})),
                distribution_wallet: (await this.WalletModel.findOne({_id : item.distributionWalletId})),
                cold_wallet: decrypt(item.encryptedColdWallet,keyEncrypDB),
            }
        });
        const total = await this.WalletConfigModel.countDocuments();
        return { data : items, total: total};
    }

    async updateEstimateGasPrice({ service, estimateGasPrice }) {
        return await this.WalletConfigModel.findOneAndUpdate({ service }, { estimateGasPrice }, {
            upsert: true, new: true
        });
    }

    async updateIsNotified({ service, isNotified }) {
        return await this.WalletConfigModel.findOneAndUpdate({ service }, { isNotified }, {
            upsert: true, new: true
        });
    }
}

module.exports = WalletConfigRepository;