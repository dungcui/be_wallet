var mongoose = require("mongoose");


var Schema = mongoose.Schema;

var MoveFundSchema = new Schema({
    service: { type: String, required: true, index: true },
    currency: { type: String, required: true, index: true },
    address: { type: String, required: true, index: true },
    amount: { type: String, required: true },
    minerFee: { type: Number, required: false },
    feeCurrency: { type: String, required: false },
    retries: { type: Number, default: 0 },
    refTransactions: { type: Array },
    status: { type: String, enum: ["transfered", "success"], index: true },
    errorMsg: { type: String },
    transactionHash: { type: String },
}, { timestamps: true });

const MoveFundModel = mongoose.model("MoveFund", MoveFundSchema);

module.exports = MoveFundModel;