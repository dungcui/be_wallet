const ip = require('ip');
const _ = require('underscore');
const { Decimal } = require('decimal.js');
const FlakeId = require('flake-idgen');
const sjcl = require("sjcl");
const crypto = require("crypto");

const generator = new FlakeId({
  // Prevent multiple servers collision
  id: ip.toLong(ip.address()) % 1024,
});

function capTransactions(transactions, maximumAmount) {
  let total = new Decimal(0);
  return _.sortBy(transactions, 'id').filter((t) => {
    total = total.add(t.grossAmount);
    return total.lte(maximumAmount);
  });
}

function formatAddressWithMemo({ address, memo }) {
  return `${address},memo_text:${memo}`;
}

function nextId() {
  return new Decimal(`0x${generator.next().toString('hex')}`).toFixed();
}

function buildConfirmWithdrawals(withdrawals) {
  const confirmedNetworkTxs = [];
  withdrawals.forEach((withdrawal) => {
    const { withdrawalId, transactionHash, feeAmount, feeCurrency, status, outputIndex } = withdrawal;
    if (withdrawalId !== null && !_.isUndefined(withdrawalId) && !_.isUndefined(feeAmount) && feeAmount !== null && feeCurrency !== null && !_.isUndefined(feeCurrency)) {
      confirmedNetworkTxs.push({
        id: withdrawalId,
        status: status,
        transactionHash: transactionHash,
        outputIndex: outputIndex,
        minerFee: new Decimal(feeAmount),
        minerFeeToken: feeCurrency,
        minerFeeStatus: "MINED",
      });
    }
  });
  return confirmedNetworkTxs;
}

function buildBalancesHash(fundings) {
  const deposits = fundings.map(funding => {
    return {
      currency: funding.currency,
      transactionHash: funding.transactionHash,
      to_address: funding.toAddress.address,
      from_address: funding.from,
      tag: funding.toAddress.tag ? funding.toAddress.tag : null,
      status: funding.status,
      amount: funding.amount,
      outputIndex: funding.outputIndex
    }
  })
  const balanceHash = DataGrouper.sum(deposits, ["currency", "transactionHash", "outputIndex","from_address", "to_address", "tag", "status"]);
  return balanceHash;
};

var DataGrouper = (function () {
  var has = function (obj, target) {
    return _.any(obj, function (value) {
      return _.isEqual(value, target);
    });
  };

  var keys = function (data, names) {
    return _.reduce(data, function (memo, item) {
      var key = _.pick(item, names);
      if (!has(memo, key)) {
        memo.push(key);
      }
      return memo;
    }, []);
  };

  var group = function (data, names) {
    var stems = keys(data, names);
    return _.map(stems, function (stem) {
      return {
        key: stem,
        vals: _.map(_.where(data, stem), function (item) {
          return _.omit(item, names);
        })
      };
    });
  };

  group.register = function (name, converter) {
    return group[name] = function (data, names) {
      return _.map(group(data, names), converter);
    };
  };

  return group;
}());

DataGrouper.register("sum", function (item) {
  return _.extend({}, item.key, {
    amount: _.reduce(item.vals, function (memo, node) {
      return memo + Number(node.amount);
    }, 0)
  });
});

DataGrouper.register("max", function (item) {
  return _.extend({}, item.key, {
    Max: _.reduce(item.vals, function (memo, node) {
      return Math.max(memo, Number(node.amount));
    }, Number.NEGATIVE_INFINITY)
  });
});

function splitAddressAndMemo(hash) {
  const addressAndMemo = hash.split(",");
  const address = addressAndMemo[0];
  const memo = addressAndMemo[1].split(":")[1];
  return { address, memo }
}

function arrayToMap(array, { keys = [], separator = '_' }) {
  const map = new Map();

  array.forEach((element) => {
    const key = keys.map(k => element[k]).join(separator);
    map.set(key, element);
  });

  return map;
}

function rangeToArray(startAt, to) {
  const size = (to - startAt) + 1; // include startAt and to
  return [...Array(size).keys()].map(i => i + startAt);
}


// PRIVATE

// Encrypts the EOS private key with the derived key
function encryptWithKey(unencrypted, key) {
  const encrypted = JSON.parse(sjcl.encrypt(key, unencrypted, { mode: "gcm" }));
  return JSON.stringify(encrypted);
}

// PUBLIC

// Derive the key used for encryption/decryption
// TODO: change default value for useOldSaltEncoding to false after migrating keys
function deriveKey(password, salt, useOldSaltEncoding = true) {
  let saltArray = salt;
  if (!useOldSaltEncoding) {
    // correct usage of this library is to convert the salt to a BitArray - otherwise it won't be decodable correcly using the expected approach
    saltArray = stringToBitArray(salt || "");
  }
  // NOTE Passing in at least an empty string for the salt, will prevent cached keys, which can lead to false positives in the test suite
  const { key } = sjcl.misc.cachedPbkdf2(password, { iter: 1000, salt: saltArray });
  // new salt encoding expects the key object to be converted explicity to a string
  return (useOldSaltEncoding) ? key : bitArrayToString(key);
}

// Decrypts the encrypted EOS private key with the derived key
function decryptWithKey(encrypted, key) {
  try {
    const encryptedData = JSON.stringify(Object.assign(JSON.parse(encrypted), { mode: "gcm" }));
    return sjcl.decrypt(key, encryptedData);
  } catch (err) {
    // console.error('Decryption Error:', err);
    return "";
  }
}

// Decrypts the encrypted EOS private key with wallet password, and salt
function decrypt(encrypted, password, salt = "") {
  // try decrypting with new Salt encoding approach
  let decrypted = decryptWithKey(encrypted, deriveKey(password, salt, false));
  if (decrypted === "") {
    // if decrypt fails, try using the old Salt encoding approach
    decrypted = decryptWithKey(encrypted, deriveKey(password, salt, true));
  }
  return decrypted;
}

// Encrypts the EOS private key with wallet password, and salt
// TODO: change default value for useOldSaltEncoding to false after migrating keys
function encrypt(unencrypted, password, salt = "", useOldSaltEncoding = true) {
  return encryptWithKey(unencrypted, deriveKey(password, salt, useOldSaltEncoding));
}


function stringToBitArray(value) {
  return sjcl.codec.base64.toBits(value);
}

function bitArrayToString(value) {
  return sjcl.codec.base64.fromBits(value);
}

function signMessage(message, keySignMessage) {
  const hmac = crypto.createHmac("sha256", keySignMessage);
  hmac.update(message);
  const hash = hmac.digest("hex");
  return hash;
}

module.exports = {
  nextId,
  capTransactions,
  buildBalancesHash,
  formatAddressWithMemo,
  buildConfirmWithdrawals,
  arrayToMap,
  rangeToArray,
  splitAddressAndMemo,
  decrypt,
  decryptWithKey,
  deriveKey,
  encrypt,
  signMessage,
  DataGrouper,
};
