
class BalancesHashRepository {

    constructor({ BalancesHashModel }) {
        this.BalancesHashModel = BalancesHashModel;
    }

    async create({ service, balancesHash, status, signature }) {
        return await this.BalancesHashModel.create({ service, balancesHash, status, signature })
    }

    async update({ service, balancesHash, status, signature }) {
        return await this.BalancesHashModel.findOneAndUpdate({ service, balancesHash }, { status, signature }, {
            upsert: true, new: true
        })
    }

    async getErrorBalanceHash({ service }) {
        return await this.BalancesHashModel.find({ service: service, status: "error" })
    }



}

module.exports = BalancesHashRepository;