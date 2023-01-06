const Promise = require("bluebird");
const { Decimal } = require("decimal.js");

class FundingRepository {

    constructor({ FundingModel }) {
        this.FundingModel = FundingModel;
        this.type = {
            FUNDING: 'funding',
            MOVE_FUND: 'move_fund',
            VIRTUAL: 'virtual',
        };
        this.status = {
            CONFIRMED: 'confirmed',
            PENDING: 'pending',
            FAILED: 'failed',
        };
    }

    async add(
        { service, transactionHash, outputIndex,
            type, blockHeight, to, amount, currency, addressId, walletId, script, status }) {
        await this.FundingModel.create({
            service,
            transactionHash,
            outputIndex,
            type,
            blockHeight,
            to,
            amount,
            currency,
            addressId,
            walletId,
            script,
            status,
            spentInTransactionHash: null,
        });
    }

    async markAsSpent({ service, transactionHash, outputIndex, spentInTransactionHash, currency }) {
        return await this.FundingModel.findOneAndUpdate({ service, transactionHash, outputIndex, spentInTransactionHash: null, currency }, { spentInTransactionHash });
    }

    async maskSpentById({ service, _id, spentInTransactionHash }) {
        return await this.FundingModel.findOneAndUpdate({ service, _id }, { spentInTransactionHash });
    }

    async findAllUnspentByAddressAndCurrency({ addressId, currency }) {
        return await this.FundingModel.find({ addressId, currency, spentInTransactionHash: null });
    }

    async findFundingByTxHashAndOutputIndex({ service, transactionHash, outputIndex, type }) {
        return await this.FundingModel.findOne({ service, transactionHash, outputIndex, type });
    }

    async updateFundingAsConfirmed({ transactionHash, status = this.status.CONFIRMED }) {
        await this.FundingModel.updateMany({ transactionHash }, { status });
    }

    async getAllAvaiableFundingsByServiceAndWalletId({ service, walletId }) {
        try {
            const groupByData = await this.FundingModel.aggregate([
                {
                    $addFields: { amountDbl: { $toDecimal: '$amount' } }
                },
                {
                    $match: {
                        $and: [
                            { service: service },
                            { walletId: walletId },
                            { $or: [{ spentInTransactionHash: { $exists: false } }, { spentInTransactionHash: null }] },
                            { $or: [{ isUsed: { $exists: false } }, { isUsed: false }] }
                        ]
                    }
                },
                {
                    $group: {
                        _id: {
                            asset: '$currency',
                        },
                        amount: { $sum: '$amountDbl' },
                    }
                },
                {
                    $match: {
                        amount: { $gt: 0 }
                    }
                }
            ]).exec();
            const result = Promise.map(groupByData, data => {
                return {
                    ...data._id,
                    amount: new Decimal(data.amount.toString()).toFixed(8)
                }
            })
            return result;
        } catch (ex) {
            return null;
        }
    }
    async getAllWalletIdHaveFunding({ service }) {
        try {
            const groupByData = await this.FundingModel.aggregate([
                {
                    $match: {
                        $and: [
                            { service: service },
                            { $or: [{ spentInTransactionHash: { $exists: false } }, { spentInTransactionHash: null }] },
                            { $or: [{ isUsed: { $exists: false } }, { isUsed: false }] }
                        ]
                    }
                },
                {
                    $group: {
                        _id: {
                            walletId: '$walletId',
                        },
                        amount: { $sum: '$amount' },
                    }
                },
                {
                    $match: {
                        amount: { $gt: 0 }
                    }
                }
            ]).exec();
            const result = Promise.map(groupByData, data => {
                return {
                    ...data._id,
                    amount: new Decimal(data.amount).toFixed(8)
                }
            })
            return result;
        } catch (ex) {
            return null;
        }
    }



    async getAllAddressHaveFundingByToken({ service, currency }) {
        try {
            const groupByData = await this.FundingModel.aggregate([
                {
                    $addFields: { amountDbl: { $toDecimal: '$amount' } }
                },
                {
                    $match: {
                        $and: [
                            { service: service },
                            { currency: currency },
                            { $or: [{ spentInTransactionHash: { $exists: false } }, { spentInTransactionHash: null }] },
                            { $or: [{ isUsed: { $exists: false } }, { isUsed: false }] }
                        ]
                    }
                },
                {
                    $group: {
                        _id: {
                            addressId: '$addressId',
                            walletId: '$walletId'
                        },
                        amount: { $sum: '$amountDbl' },
                    }
                },
                {
                    $match: {
                        amount: { $gt: 0 }
                    }
                }
            ]).exec();
            const result = Promise.map(groupByData, data => {
                console.log("data.amount ", data.amount.toString());
                return {
                    ...data._id,
                    amount: new Decimal(data.amount.toString())
                }
            })
            return result;
        } catch (ex) {
            return [];
        }
    }

    async getMapBalanceAddressWallet({ service, walletId, to }) {
        try {
            const groupByData = await this.FundingModel.aggregate([
                {
                    $addFields: { amountDbl: { $toDecimal: '$amount' } }
                },
                {
                    $match: {
                        $and: [
                            { service: service },
                            { walletId: walletId },
                            { to: to },
                            { $or: [{ spentInTransactionHash: { $exists: false } }, { spentInTransactionHash: null }] },
                            { $or: [{ isUsed: { $exists: false } }, { isUsed: false }] }
                        ]
                    }
                },
                {
                    $group: {
                        _id: {
                            asset: '$currency',
                        },
                        amount: { $sum: '$amountDbl' },
                    }
                },
                {
                    $match: {
                        amount: { $gt: 0 }
                    }
                }
            ]).exec();
            const result = Promise.reduce(groupByData, (balanceMaps, data) => {
                balanceMaps.set(data._id.asset, new Decimal(data.amount.toString()));
                return balanceMaps;
            }, new Map());
            return result;
        } catch (ex) {
            return null;
        }
    }

    async getAllUnspentInputByWallet({ service, walletId }) {
        return await this.FundingModel.find({ $and: [{ walletId }, { service }, { spentInTransactionHash: null }, { $or: [{ isUsed: { $exists: false } }, { isUsed: false }] }] }).sort({ amount: +1 });
    }

    async updateIsUsed({ service, _id }) {
        return await this.FundingModel.findOneAndUpdate({ service, _id }, { isUsed: true });
    }
}

module.exports = FundingRepository;