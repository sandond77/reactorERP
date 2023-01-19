const express = require("express");
const path = require("path");
const users = require("./routes/users");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.static(path.resolve(__dirname, '../client/build')));
app.use('/api/users', users);

app.get("/api", (req,res)=>{
    res.json({message: "Hello from server backend!"});
});

app.listen(PORT, () => {
    console.log(`Server listening on ${PORT}`);  
});

