const express = require("express");
const { Sequelize } = require('sequelize');

const app = express();

const PORT = process.env.PORT || 8080;

//mySQL Connection
// const sequelize = new Sequelize(process.env.DB_CONNECTION_URL);
const sequelize = new Sequelize('reactorerp', 'root', 'password', {
    dialect: 'mysql'
  });

async function assertDatabaseConnectionOk() {
	console.log(`Checking database connection...`);
	try {
		await sequelize.authenticate();
		console.log('Database connection OK!');
	} catch (error) {
		console.log('Unable to connect to the database:');
		console.log(error.message);
		process.exit(1);
	}
}

assertDatabaseConnectionOk()
//Schema #1 - Main Inventory Database
//Schema #2 - Transaction Database that communicates to main inventory


app.listen(PORT, console.log(`App is listening on port ${PORT}`));
