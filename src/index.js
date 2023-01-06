const _ = require("lodash");
const Decimal = require("decimal.js");
// const logger = require("./logger");
const { createProducer, rabbitDepositQueue, rabbitConfirmQueue, rabbitWalletInsufficientBalance } = require("./app/rabbitMQ");
require('dotenv').config()


const {
  create: createContainer,
  provision: provisionContainer
} = require("./container");
const { create: createWorker } = require("./app/worker");
const { create: createServer } = require("./app/server");
const { LatestBlock } = require("./lib/latest_block");


// Setup global precision
Decimal.set({ precision: 100 });

async function startServer(container, serviceNames) {
  const port = process.env.PORT || 3000;

  // Create container & provision env
  const services = serviceNames.map(name => {
    const service = container.resolve(_.camelCase(`${name}_SERVICE`));
    service.name = name.toUpperCase();
    return service;
  });
  // Create server
  const server = await createServer({ port, services, container });
  // Then start
  console.log(" App service started at " + `${port}`);
  return { server };
}

async function startWorker(container, monitorName) {
  // Load worker
  const monitor = container.resolve(_.camelCase(`${monitorName}_MONITOR`));
  monitor.name = monitorName;

  const balancesHash = container.resolve("balancesHashRepository");

  const producer = await createProducer(rabbitDepositQueue);
  // Then listen & start
  const worker = createWorker({ monitor, balancesHash, producer });
  worker.start().catch(err => {
    console.log("Worker have error ", err);
    process.exit(1);
  });

  return { worker };
}

async function startPayment(container, paymentName) {
  // Load worker
  const payment = container.resolve(_.camelCase(`${paymentName}_PAYMENT`));
  const producer = await createProducer(rabbitWalletInsufficientBalance);

  payment.start(producer).catch(err => {
    console.log("payment error", err);
    process.exit(1);
  });

  console.log(`${paymentName}` + " payment processer started");
  return { payment };
}



async function startGetLatestBlock(container, serviceNames) {
  // Load class
  const syncBlockRepository = container.resolve("syncBlockRepository");
  const producer = await createProducer(rabbitConfirmQueue);
  const latestBlock = new LatestBlock({ syncBlockRepository });
  latestBlock.start(serviceNames, producer).catch(err => {
    console.log("lastest block error", err);
    process.exit(1);
  });
  console.log("latest block started");

  return { latestBlock, producer };
}

async function startTransporter(container, transporterName) {
  // Load worker
  const transporter = container.resolve(_.camelCase(`${transporterName}_TRANSPORTER`));
  const producer = await createProducer(rabbitWalletInsufficientBalance);

  transporter.start(producer).catch(err => {
    console.log("transporter error", err);
    process.exit(1);
  });
  console.log(`${transporterName}` + " transporter started");

  return { transporter };
}


async function start() {
  const type = process.env.SERVICE_TYPE;

  const serviceNames = process.env.SERVICE_NAMES.toUpperCase().split(",");
  if (serviceNames.length === 0) {
    throw Error("At least 1 service name must be specified");
  }

  const container = provisionContainer(createContainer(), serviceNames);
  // Preload data

  switch (type) {
    case "latest_block":
      return startGetLatestBlock(container, serviceNames);
    case "worker":
      return startWorker(container, serviceNames[0]);
    case "payment":
      return startPayment(container, serviceNames[0]);
    case "transporter":
      return startTransporter(container, serviceNames[0]);
    case "server":
      return startServer(container, serviceNames);
    default:
      throw Error(`Service with type ${type} is not supported`);
  }
}



// Graceful shutdown
async function shutdown({ worker, server, payment, transporter }) {
  log.info("Received kill signal, shutting down gracefully");
  if (server) {
    server.close();
    process.exit(0);
  }

  // We will wait for 1 minute, after that we force the process to shutdown
  const forceExit = setTimeout(() => {
    log.error("Could not close connections in time, forcefully shutting down");
    process.exit(1);
  }, 60 * 1000);

  // Stop the only worker
  if (worker) {
    await worker.stop();
  }
  // Close MQ channel
  if (producer) {
    producer.close();
  }

  if (payment) {
    await payment.stop();
  }

  if (transporter) {
    await transporter.stop();
  }

  if (latestBlock) {
    latestBlock.stop();
  }

  clearTimeout(forceExit);
  process.exit(0);
}

// Register signals for app
const registerSignals = app => {
  process.on("SIGTERM", () => shutdown(app));
  process.on("SIGINT", () => shutdown(app));
};

start()
  .then(registerSignals)
  .catch(err => {
    console.log("service have error ", err);
    process.exit(1);
  });
