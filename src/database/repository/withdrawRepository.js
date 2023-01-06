
class WithdrawRepository {

    constructor({ WithdrawModel }) {
        this.WithdrawModel = WithdrawModel;
        this.status = {
            SUCCESS: 'success',
            INQUEUE: 'inqueue',
            TRANSFERED: 'transfered',
            REJECTED: 'rejected',
        }
    }

    async create({ service, withdrawalId, asset, address, amount, tag, signature }) {
        return await this.WithdrawModel.create({ service, withdrawalId, asset, address, amount, tag, status: this.status.INQUEUE, errorMsg: "", transactionHash: "", signature });
    }

    async updateStatus({ service, withdrawalId, transactionHash, outputIndex, status, errorMsg, minerFee, feeCurrency }) {
        return await this.WithdrawModel.findOneAndUpdate({ service, withdrawalId, transactionHash, outputIndex }, { status, errorMsg, minerFee, feeCurrency });
    }

    async updateTransactionHash({ service, withdrawalId, transactionHash, outputIndex, minerFee, status, errorMsg }) {
        return await this.WithdrawModel.findOneAndUpdate({ service, withdrawalId }, { transactionHash, outputIndex, minerFee, status, errorMsg }, {
            upsert: true
        });
    }

    async updateStatusForRetryErrorTransaction({ service, withdrawalId }) {
        const currentRetries = await this.WithdrawModel.findOne({ service, withdrawalId });
        return await this.WithdrawModel.findOneAndUpdate({ service, withdrawalId }, { transactionHash: "", status: this.status.INQUEUE, errorMsg: "", retries: currentRetries.retries + 1 });
    }

    async getPendingWithdraw({ service }) {
        return await this.WithdrawModel.find({ service, status: "inqueue" }).limit(30);
    }
    async getTransferedWithdraw({ service }) {
        return await this.WithdrawModel.find({ service, status: "transfered" });
    }

    async findByWithdrawalId({ withdrawalId }) {
        return await this.WithdrawModel.findOne({ withdrawalId });
    }

    async findByServiceTransactionHashAndIndex({ service, transactionHash, outputIndex }) {
        return await this.WithdrawModel.findOne({ service, transactionHash, outputIndex });
    }

    async updateIsNotified({ service, withdrawalId, isNotified }) {
        return await this.WithdrawModel.findOneAndUpdate({ service, withdrawalId }, { isNotified });
    }
}

module.exports = WithdrawRepository;