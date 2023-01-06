const utils = require("../utils");
const keySignMessage = process.env.KEY_SIGN_MESSAGE;
const latestBlockSleepTime = process.env.LATEST_BLOCK_SLEEP_TIME;
const { rabbitConfirmQueue } = require("../app/rabbitMQ");
const Promise = require("bluebird");

class LatestBlock {
    constructor({
        syncBlockRepository,
    }) {
        this.syncBlockRepository = syncBlockRepository;
    }

    async start(serviceNames, producer) {
        this.isRunning = true;
        this.canStop = false;
        await this.run(serviceNames, producer);
        this.canStop = true;
    }

    async stop() {
        this.isRunning = false;
        this.debug("Attempt to stop...");
        if (this.canStop) {
            this.debug("Stopped.");
            return;
        }
        await Promise.delay(1000 * this.sleepTime);
        await this.stop();
    }

    async run(serviceNames, producer) {
        while (this.isRunning) {
            await this.getLatestBlock(serviceNames, producer);
        }
    }

    async getLatestBlock(serviceNames, producer) {
        const latestBlocks = await this.syncBlockRepository.findByListServices(serviceNames);
        const block = latestBlocks.map(latestBlock => {
            return {
                currency: latestBlock.service,
                height: latestBlock.height
            }
        });
        const jsonBlock = JSON.stringify(block);
        const signature = utils.signMessage(jsonBlock, keySignMessage);
        const data = {
            signature: signature, message: block
        }
        try {
            producer.sendToQueue(rabbitConfirmQueue, new Buffer.from(JSON.stringify(data)), { persistent: true });
        }
        catch (ex) {
        }
        await Promise.delay(1000 * 60 * latestBlockSleepTime);
    }
}

module.exports = { LatestBlock };
