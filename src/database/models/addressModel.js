var mongoose = require("mongoose");

var Schema = mongoose.Schema;

var AddressesSchema = new Schema({
	service: { type: String, required: true, index: true },
	walletId: { type: String, required: false, index: true },
	address: { type: String, required: true, index: true },
	memo: { type: String, required: false, index: true },
	type: { type: String, enum: ["user", "settlement", "cold"], required: true },
	path: { type: Number, required: true },
	fullAddress: { type: String, required: false },
}, { timestamps: true });

const Address = mongoose.model("Addresses", AddressesSchema);

module.exports = Address;