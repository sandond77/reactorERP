const express = require("express");
const {Router} = require("express");
const router = express.Router();

router.get('/', (req,res)=>{
    res.json({
        "message":"route success"
    });
});

module.exports = router;