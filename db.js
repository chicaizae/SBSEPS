const { Sequelize } = require('sequelize');
require('dotenv').config();

// Dialecto: sqlite por defecto, puede cambiarse a mariadb con DB_DIALECT
const dialect = process.env.DB_DIALECT || 'sqlite';

let sequelize;
if (dialect === 'sqlite') {
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: process.env.SQLITE_PATH || 'data.sqlite',
    logging: false,
  });
} else {
  // MariaDB (compatible con MySQL)
  sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    dialect: dialect,
    logging: false,
  });
}

module.exports = sequelize;
