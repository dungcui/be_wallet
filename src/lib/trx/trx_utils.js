const { keccak256 } = require('js-sha3');
const { encode: encodeBase58 } = require('bs58');
const JsSHA = require('jssha');
const { ec: EllipticCurve } = require('elliptic');
const ADDRESS_PREFIX = '41';



function computeAddress(tronPublicHex) {
    const buffer = Buffer.from(tronPublicHex, 'hex');
    const hash = keccak256(buffer).toString();
    return ADDRESS_PREFIX + hash.substring(24);
}

function getSHA256(msgHex) {
    const shaObj = new JsSHA('SHA-256', 'HEX');
    shaObj.update(msgHex);
    return shaObj.getHash('HEX');
}

function getBase58CheckAddress(addressHex) {
    const checkSum = getSHA256(getSHA256(addressHex)).slice(0, 8);
    const buffer = Buffer.from(addressHex + checkSum, 'hex');
    return encodeBase58(buffer);
}

function getTronPublicKeyHex(publicKey) {
    const ec = new EllipticCurve('secp256k1');
    const key = ec.keyFromPublic(publicKey.toString('hex'), 'hex');
    const { x, y } = key.getPublic();
    const xHex = x.toString('hex').padStart(64, '0');
    const yHex = y.toString('hex').padStart(64, '0');
    return xHex + yHex;
}

function getAddressFromPublicKey(publicKey) {
    const tronPublicHex = getTronPublicKeyHex(publicKey);
    const address = computeAddress(tronPublicHex);
    return getBase58CheckAddress(address);
}



module.exports = {
    getAddressFromPublicKey,
    getBase58CheckAddress,
};