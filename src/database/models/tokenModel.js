var mongoose = require("mongoose");

var Schema = mongoose.Schema;

var TokenSchema = new Schema({
	service: { type: String, required: true, index: true },
	contractAddress: { type: String, required: true, index: true },
	decimals: { type: Number, required: true },
	enabled: { type: Boolean, required: true },
	symbol: { type: String, default: true, required: true },
}, { timestamps: true });
const Token = mongoose.model("Token", TokenSchema);

module.exports = Token;