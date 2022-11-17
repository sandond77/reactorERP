const { Sequelize } = require('sequelize');

module.exports = new Sequelize('reactorerp', 'root', 'password', {
    dialect: 'mysql'
});