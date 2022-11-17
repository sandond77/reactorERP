const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const db = require("./config/database");
const { Sequelize } = require('sequelize');

const app = express();
const PORT = process.env.PORT || 8080;

//mySQL Connection
db.authenticate()
	.then(() => console.log("Database connection made!"))
	.catch(err => console.log("Connection Error: "+err))


//Schema #1 - Main Inventory Database
//Schema #2 - Transaction Database that communicates to main inventory


app.listen(PORT, console.log(`App is listening on port ${PORT}`));
