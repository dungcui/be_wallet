var mongoose = require("mongoose");

var Schema = mongoose.Schema;

var BalancesHashSchema = new Schema({
    service: { type: String, required: true, index: true },
    balancesHash: { type: String, required: true, index: true },
    status: { type: String, required: true, index: true },
    signature: { type: String, required: true },
}, { timestamps: true });

const BalancesHash = mongoose.model("BalancesHash", BalancesHashSchema);

module.exports = BalancesHash;