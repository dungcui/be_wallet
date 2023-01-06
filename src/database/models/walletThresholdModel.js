var mongoose = require("mongoose");

var Schema = mongoose.Schema;

var walletThresholdSchema = new Schema({
    service: { type: String, required: true },
    token: { type: String, required: true },
    notificationThreshold: { type: Number },
    forwardingThreshold: { type: Number },
    minimumDeposit: { type: Number },
}, { timestamps: true });


walletThresholdSchema.index({ service: 1, token: 1 }, { unique: true });

const walletThreshold = mongoose.model("walletThreshold", walletThresholdSchema);

module.exports = walletThreshold;