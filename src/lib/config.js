// Mapper for environment variables
const environment = process.env.NODE_ENV;
const keyEncrypDB = process.env.KEY_ENCRYP_DB;
const port = process.env.PORT;

const db = {
  name: process.env.MONGO_INITDB_DATABASE,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PWD,
};

const corsUrl = process.env.CORS_URL;

const logDirectory = process.env.LOG_DIR;

module.exports = { keyEncrypDB, environment, db, port, corsUrl, logDirectory }