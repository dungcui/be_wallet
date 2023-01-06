var mongoose = require("mongoose");

var Schema = mongoose.Schema;

var WalletConfigSchema = new Schema({
    service: { type: String, unique: true, required: true },
    depositWalletId: { type: String, required: true },
    withdrawWalletId: { type: String, required: true },
    distributionWalletId: { type: String, required: false },
    encryptedColdWallet: { type: String, required: false },
    requireConfirmed: { type: Number, required: false },
    moveFundSleepTime: { type: Number, required: false },
    estimateGasPrice: { type: Number, required: false, default: 0 },
}, { timestamps: true });

const WalletConfig = mongoose.model("WalletConfig", WalletConfigSchema);

module.exports = WalletConfig;