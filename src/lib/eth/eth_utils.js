const { keccak256: sha3 } = require("js-sha3");

let abi = require("ethereumjs-abi");
let _ = require("underscore");

const padLeft = (raw, width, pos = "0") => {
    const data = String(raw);
    return data.length >= width
        ? data
        : new Array(width - data.length + 1).join(pos) + data;
};

const getObject = (to, func, args = []) => {
    const funcHex = `0x${sha3(func).substring(0, 8)}`;
    const val = args.reduce((prev, arg) => prev + padLeft(arg, 64), "");
    const data = funcHex + val;
    return { to, data };
};
// https://docs.alchemyapi.io/guides/eth_getlogs
// decided first 26 bit 
// 0x000000000000000000000000390e4cc5eaa09791c167a4b0ec9c6df598ec99df
const getAddressFromHex = (hex) => {
    if (hex) {
        return '0x' + hex.substring(26);
    } else {
        return null;
    }
};

module.exports = {
    padLeft,
    getObject,
    getAddressFromHex
};
