const assert = require("assert");
const express = require("express");
const mongoose = require("mongoose");

const app = express();

const PORT = process.env.PORT || 8080;

const dbName = "reactorERP";
const url = "mongodb://localhost:27017/"+ dbName;

main().catch(err => console.log(err));

async function main() {
    await mongoose.connect(url);
    console.log(`Connection made on ${url}`);
};

app.listen(PORT, console.log(`App is listening on port ${PORT}`));
