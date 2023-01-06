const { Decimal } = require("decimal.js");

class WalletThresholdRepository {

    constructor({ WalletThresholdModel }) {
        this.walletThresholdModel = WalletThresholdModel;
    }

    async update({ service, token, notificationThreshold, forwardingThreshold, minimumDeposit }) {
        return await this.walletThresholdModel.findOneAndUpdate({ service, token }, { notificationThreshold, forwardingThreshold, minimumDeposit }, {
            upsert: true, new: true
        })
    }

    async getByService({ service }) {
        const thresholds = await this.walletThresholdModel.find({ service });
        if (thresholds) {
            return thresholds.map(threshold => {
                return {
                    assetCode: threshold.token,
                    notificationThreshold: threshold.notificationThreshold,
                    forwardingThreshold: threshold.forwardingThreshold,
                }
            });
        } else {
            return [];
        }
    }

    async getForwardingThreshHoldByServiceToken({ service, token }) {
        const thresholds = await this.walletThresholdModel.findOne({ service, token });
        if (thresholds && thresholds.forwardingThreshold) {
            return new Decimal(thresholds.forwardingThreshold);
        } else {
            return new Decimal(0);
        }

    }

    async getNotificationThreshHoldByServiceToken({ service, token }) {
        const thresholds = await this.walletThresholdModel.findOne({ service, token });
        if (thresholds && thresholds.notificationThreshold) {
            return new Decimal(thresholds.notificationThreshold);
        } else {
            return new Decimal(0);
        }

    }

    async getMapMinimumDeposit({ service }) {
        const thresholds = await this.walletThresholdModel.find({ service });
        if (thresholds) {
            return thresholds.reduce(function (map, threshold) {
                map.set(threshold.token, threshold.minimumDeposit);
                return map;
            }, new Map());
        } else {
            return {};
        }
    }
}

module.exports = WalletThresholdRepository;