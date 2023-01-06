const utils = require("../utils");
const keySignMessage = process.env.KEY_SIGN_MESSAGE;
const keyEncrypDB = process.env.KEY_ENCRYP_DB;

const { rabbitDepositQueue } = require("./rabbitMQ");
function create({ monitor, balancesHash, producer }) {
  monitor.on("block", async block => {
    const jsonBlock = JSON.stringify(block);
    const signature = utils.signMessage(jsonBlock, keySignMessage);
    const data = {
      signature: signature, message: block
    }
    let status = "";
    try {
      producer.sendToQueue(rabbitDepositQueue, Buffer.from(JSON.stringify(data)), { persistent: true });
      status = "success";
    }
    catch (ex) {
      status = "error";
    }
    const signatureDB = utils.signMessage(jsonBlock, keyEncrypDB);
    balancesHash.update({ service: monitor.name, balancesHash: jsonBlock, status: status, signature: signatureDB });
  });
  return monitor;
}

module.exports = { create };
