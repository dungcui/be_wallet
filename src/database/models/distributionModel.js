var mongoose = require("mongoose");

var Schema = mongoose.Schema;

var DistributionSchema = new Schema({
    service: { type: String, required: true, index: true },
    currency: { type: String, required: true, index: true },
    address: { type: String, required: true, index: true },
    amount: { type: String, required: true },
    minerFee: { type: Number, required: false },
    feeCurrency: { type: String, required: false },
    retries: { type: Number, default: 0 },
    status: { type: String, enum: ["transfered", "success", "rejected", "confirmed"], index: true },
    errorMsg: { type: String },
    transactionHash: { type: String },
}, { timestamps: true });

const DistributionModel = mongoose.model("Distribution", DistributionSchema);

module.exports = DistributionModel;