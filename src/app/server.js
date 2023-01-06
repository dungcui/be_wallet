const debug = require("debug")("wallet:server");
const _ = require("lodash");
const camelCaseKeys = require("camelcase-keys");
const express = require("express");
const bodyParser = require("body-parser");
const utils = require('../utils');
const keySignMessage = process.env.KEY_SIGN_MESSAGE;
const Promise = require("bluebird");
const cors = require('cors')

function getCurrencyToService(services) {
  const hash = {};
  // Native currency
  services.forEach(service => {
    // Backward compatible
    const currencies = service.currencies || [];
    // Native
    if (service.currency) {
      currencies.push(service.currency);
    }
    currencies.forEach(currency => {
      hash[currency] = service;
    });
  });
  return hash;
}

async function create({ port, services, container}) {
  const currencyToService = getCurrencyToService(services);
  // Create server
  const server = express();
  server.use(
    bodyParser.json({
      verify: (req, res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  server.use(cors());

  const handleRequest = (req, resp) => {
    const { url } = req;
    const headers = req.headers;
    const option = { deep: true };
    const method = _.camelCase(url.slice(1));
    const { currency } = req.body;
    const rawBody = req.rawBody;
    const signature = utils.signMessage(rawBody, keySignMessage);
    if (signature != headers.signature) {
      return resp.status(401).send({
        error: 401,
        message: "Not authenticated!"
      });
    }

    if (!currency) {
      return resp.status(404).send({
        error: 404,
        message: "Missing currency!"
      });
    }
    const service = currencyToService[currency];
    if (!service) {
      return resp.status(500).send({
        error: 500,
        message: "Currency is not support"
      });
    }
    try {
      // Convert from snake to camel...
      service[method](camelCaseKeys(req.body, option))
        .then(res => {
          // Convert from camel back to snake
          resp.json(res);
        })
        .catch(err => {
          // Print error for logging
          debug(err.stack);
          resp.status(500).json({ error: 500, message: err.message });
        });
    } catch (err) {
      resp.status(500).json({ error: 500, message: "undefined method" });
    }
  };

  const handleListCurrencyRequest = (req, resp) => {
    const { url } = req;
    const headers = req.headers;
    const option = { deep: true };
    const method = _.camelCase(url.slice(1));
    const { currencies } = req.body;
    const rawBody = req.rawBody;
    const signature = utils.signMessage(rawBody, keySignMessage);
    if (signature != headers.signature) {
      return resp.status(401).send({
        error: 401,
        message: "Not authenticated!"
      });
    }
    if (!currencies) {
      return resp.status(404).send({
        error: 404,
        message: "Missing currencies!"
      });
    }
    Promise.map(currencies, async (currency) => {
      const service = currencyToService[currency];
      if (!service) {
        return { asset: currency, amount: 0 };
      }
      try {
        // Convert from snake to camel...
        const res = await service[method](camelCaseKeys(req.body, option));
        return res;
      } catch (err) {
        console.log("err ", err);
        resp.status(500).json({ error: 500, message: "undefined method" });
        return;
      }
    }).then(result => resp.json(...result));
  };


  const handleGetListWallet = (req, resp) => {
    const { skip, limit, search } = req.query;
    try {
      const walletRepository = container.resolve("walletRepository");
      walletRepository.getPagingList({skip, limit, search}).then((data)=>{
        resp.json(data);          
      });
    } catch (err) {
      console.log("err ", err);
      resp.status(500).json({ error: 500, message: "undefined method" });
      return;
    }
  };

  const handleGetListConfigWallet = (req, resp) => {
    const { skip, limit, search } = req.query;
    try {
      const walletConfigRepository = container.resolve("walletConfigRepository");
      walletConfigRepository.getPagingList({skip, limit, search}).then((data)=>{
        resp.json(data);          
      });
    } catch (err) {
      console.log("err ", err);
      resp.status(500).json({ error: 500, message: "undefined method" });
      return;
    }
  };


  server.get("/", (req, res) => {
    res.json({ message: "API portal" });
  });

  server.post("/addWallet", handleRequest);
  server.post("/getWalletInfo", handleRequest);
  // server.post("/updateWallet", handleRequest);
  server.post("/configWallet", handleRequest);
  server.post("/getAddress", handleRequest);
  server.post("/withdrawalRequest", handleRequest);
  server.post("/getTotalWallet", handleListCurrencyRequest);
  server.post("/validateAddress", handleRequest);
  server.post("/addSmartContract", handleRequest);
  server.post("/setRequireConfirmed", handleRequest);
  server.post("/setMoveFundSleepTime", handleRequest);
  server.post("/setWalletThreshold", handleRequest);
  // server.post("/withdraw", handleRequest);
  server.get("/getWallets", handleGetListWallet);
  server.get("/getConfigWallets", handleGetListConfigWallet);
  server.post("/multilpleWithdrawalRequest", handleRequest);
  
  const app = server.listen(port, () => {
    debug(`listen on port ${port}`);
  });
  return app;
}

module.exports = { create };
