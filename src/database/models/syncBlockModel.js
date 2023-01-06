var mongoose = require("mongoose");

var Schema = mongoose.Schema;

var SyncBlockSchema = new Schema({
    _id: { type: Number },
    service: { type: String, unique: true, required: true, index: true },
    height: { type: Number, required: true },
}, { timestamps: true });

const SyncBlock = mongoose.model("SyncBlock", SyncBlockSchema);

module.exports = SyncBlock;