var mongoose = require("mongoose");

var Schema = mongoose.Schema;

var FundingSchema = new Schema({
	service: { type: String, required: true, index: true },
	transactionHash: { type: String, required: true },
	outputIndex: { type: String, required: true },
	currency: { type: String, required: true, index: true },
	to: { type: String, required: true, index: true },
	type: { type: String, required: true, index: true },
	amount: { type: Number, required: true },
	blockHeight: { type: Number },
	addressId: { type: String, required: true, unique: false },
	walletId: { type: String, required: true, unique: false },
	status: { type: String, enum: ["confirmed", "pending", "failed"], index: true },
	spentInTransactionHash: { type: String, required: false },
}, { timestamps: true });

FundingSchema.index({ transactionHash: 1, addressId: 1, amount: 1, outputIndex: 1 }, { unique: true });
const Funding = mongoose.model("Funding", FundingSchema);

module.exports = Funding;