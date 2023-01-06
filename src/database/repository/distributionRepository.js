
class DistributionRepository {

    constructor({ DistributionModel }) {
        this.DistributionModel = DistributionModel;
        this.status = {
            SUCCESS: 'confirmed',
            INQUEUE: 'inqueue',
            TRANSFERED: 'transfered',
            REJECTED: 'rejected',
            /// status reponse for backend
            PENDING: 'PENDING'
        }
    }
    async create({ service, currency, address, amount, minerFee, feeCurrency, retries, status, errorMsg, transactionHash }) {
        return await this.DistributionModel.create({ service, currency, address, amount, minerFee, feeCurrency, retries, status, errorMsg, transactionHash });
    }

    async updateStatus({ service, withdrawalId, transactionHash, status, errorMsg }) {
        return await this.DistributionModel.findOneAndUpdate({ service, withdrawalId, transactionHash }, { status, errorMsg });
    }

    async updateTransactionHash({ service, withdrawalId, transactionHash, status, errorMsg }) {
        return await this.DistributionModel.findOneAndUpdate({ service, withdrawalId }, { transactionHash, status, errorMsg });
    }

    async updateStatusForRetryErrorTransaction({ service, _id }) {
        const currentRetries = await this.TokenModel.findOne({ service, _id });
        return await this.DistributionModel.findOneAndUpdate({ service, _id }, { transactionHash: "", status: this.status.INQUEUE, errorMsg: "", retries: currentRetries.retries + 1 });
    }

    async getPendingWithdraw({ service }) {
        return await this.DistributionModel.find({ service, status: "inqueue" });
    }
    async getTransferedWithdraw({ service }) {
        return await this.DistributionModel.find({ service, status: "transfered" });
    }

    async findByWithdrawalId({ _id }) {
        return await this.DistributionModel.findOne({ _id });
    }

    async findByTransactionHash({ service, transactionHash }) {
        return await this.DistributionModel.findOne({ service, transactionHash });
    }
}

module.exports = DistributionRepository;