const Promise = require("bluebird");

class AddressRepository {

    constructor({ AddressModel }) {
        this.AddressModel = AddressModel;
        this.type = {
            USER: "user",
            SETTLEMENT: "settlement",
            COLDWALLET: "cold"
        };
        this.path = {
            SETTLEMENT: 0,
            COLDWALLET: 0
        };
    }

    async findByAddressHashWithLowerCase({ service, address }) {
        return await this.AddressModel.findOne({ service, address })
    }

    async findByAddressHash({ service, address }) {
        return await this.AddressModel.findOne({ service, address })
    }


    async findById({ service, _id }) {
        return await this.AddressModel.findOne({ service, _id })
    }

    async findByServiceAndWalletIdAndPath({ service, walletId, path }) {
        return await this.AddressModel.findOne({ service, walletId, path })
    }

    async findByAddressAndMemo(service, address, memo) {
        return await this.AddressModel.findOne({ service, address, memo })
    }

    async create({ service, walletId, path, address, memo, type }) {
        return this.AddressModel.create(
            { service, walletId, type, path, address, memo }
        );
    }

    async getTotalAddressOfWalletId({ service, walletId }) {
        try {
            const groupByData = await this.AddressModel.aggregate([
                {
                    $match: {
                        service: service,
                        walletId: walletId,
                    }
                },
                {
                    $group: {
                        _id: {
                            walletId: '$walletId',
                        },
                        totalAddress: { $sum: 1 }
                    }
                }
            ]).exec();
            const result = Promise.map(groupByData, data => {
                return {
                    ...data._id,
                    totalAddress: data.totalAddress
                }
            })
            return result;
        } catch (ex) {
            console.log("ex ", ex);
            return null;
        }

    }
}

module.exports = AddressRepository;