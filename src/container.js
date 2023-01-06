const awilix = require("awilix");
const _ = require("lodash");

const { Lifetime } = awilix;

// Create container by loading app & lib
const create = () => {
  const container = awilix.createContainer();

  // Load script
  // initialize database on models  : src/database/*.js.
  container.loadModules(
    ["src/app/**/*.js", "src/lib/**/*.js", "src/database/*.js", "src/database/repository/*.js"],
    {
      formatName: "camelCase",
      resolverOptions: {
        lifetime: Lifetime.SINGLETON
      }
    }
  );

  // Load modules for Models Repository.
  container.loadModules(
    [
      "src/database/models/*.js",
    ],
    {
      formatName: name => `${name.charAt(0).toUpperCase()}${name.substring(1)}`,
      resolverOptions: {
        register: awilix.asValue,
        lifetime: Lifetime.SINGLETON
      }
    });

  module.exports = container;

  return container;
};

// Provision environment for container base on service name
const provision = (container, services) => {
  services.forEach(service => {
    _.keys(process.env).forEach(key => {
      // Check if key is setting for service
      if (key.indexOf(`${service}_`) === 0) {
        // Backward compatible
        container.register(_.camelCase(key), awilix.asValue(process.env[key]));
        // New format
        container.register(key, awilix.asValue(process.env[key]));
      }
    });
  });
  return container;
};

module.exports = { create, provision };
