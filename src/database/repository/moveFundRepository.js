
class MoveFundRepository {

    constructor({ MoveFundModel }) {
        this.MoveFundModel = MoveFundModel;
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
        return await this.MoveFundModel.create({ service, currency, address, amount, minerFee, feeCurrency, retries, status, errorMsg, transactionHash });
    }

    async updateStatus({ service, withdrawalId, transactionHash, status, errorMsg }) {
        return await this.MoveFundModel.findOneAndUpdate({ service, withdrawalId, transactionHash }, { status, errorMsg });
    }

    async updateTransactionHash({ service, withdrawalId, transactionHash, status, errorMsg }) {
        return await this.MoveFundModel.findOneAndUpdate({ service, withdrawalId }, { transactionHash, status, errorMsg });
    }

    async updateStatusForRetryErrorTransaction({ service, _id }) {
        const currentRetries = await this.TokenModel.findOne({ service, _id });
        return await this.MoveFundModel.findOneAndUpdate({ service, _id }, { transactionHash: "", status: this.status.INQUEUE, errorMsg: "", retries: currentRetries.retries + 1 });
    }

    async findById({ _id }) {
        return await this.MoveFundModel.findOne({ _id });
    }
}

module.exports = MoveFundRepository;