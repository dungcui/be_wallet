var mongoose = require("mongoose");

var Schema = mongoose.Schema;

var WithdrawSchema = new Schema({
	service: { type: String, required: true, index: true },
	withdrawalId: { type: String, required: true, index: true, unique: true },
	address: { type: String, required: true, index: true },
	asset: { type: String, required: true, index: true },
	tag: { type: String, required: false },
	amount: { type: Number, required: true },
	minerFee: { type: Number, required: false, default: null },
	feeCurrency: { type: String, required: false, default: 0 },
	retries: { type: Number, default: 0 },
	status: { type: String, enum: ["inqueue", "transfered", "success", "rejected"], default: "inqueue", index: true },
	errorMsg: { type: String },
	transactionHash: { type: String },
	outputIndex: { type: Number, default: 0 },
	signature: { type: String, required: true, index: true },
	isNotified: { type: Boolean, default: false },
}, { timestamps: true });

const Withdraw = mongoose.model("Withdraw", WithdrawSchema);

module.exports = Withdraw;