var mongoose = require("mongoose");

var Schema = mongoose.Schema;

var WalletSchema = new Schema({
	service: { type: String, required: true, index: true },
	walletName: { type: String, required: true, index: true },
	encryptedKey: { type: String, required: false },
	encryptedAddress: { type: String, required: false },
}, { timestamps: true });

const Wallet = mongoose.model("Wallet", WalletSchema);

module.exports = Wallet;