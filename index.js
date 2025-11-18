const express = require('express')
const app = express()
const cors = require('cors')
const port = process.env.PORT || 3000
const { MongoClient, ServerApiVersion } = require('mongodb');
require("dotenv").config();


// middleware 
app.use(express.json())
app.use(cors())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.g0ilve4.mongodb.net/?appName=Cluster0`;


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


async function run() {
  try {
    await client.connect();
    
    const db = client.db('zap_shift_DB')
    const parcelsCollection = db.collection('parcels')


    app.post('/parcels',async(req,res)=>{
      const parcelData = req.body 
      const result = await parcelsCollection.insertOne(parcelData)
      res.send(result)
    })


    app.get('/parcels',async(req,res)=>{
      const {email} = req.query;
      const query = {}
      if(email){
        query.senderEmail = email
      }

      const cursor = parcelsCollection.find(query)
      const result = await cursor.toArray()
      res.send(result)
    })






    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
