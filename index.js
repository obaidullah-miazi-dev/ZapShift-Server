const express = require("express");
const app = express();
const cors = require("cors");
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const admin = require("firebase-admin");

const serviceAccount = require("./zapshift-web-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.g0ilve4.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("zap_shift_DB");
    const parcelsCollection = db.collection("parcels");
    const paymentCollection = db.collection("payment");
    const usersCollection = db.collection("users");
    const ridersCollection = db.collection("riders");

    // middleware for security
    const firebaseToken = async (req, res, next) => {
      const token = req.headers.authorization;
      if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      try {
        const tokenId = token.split(" ")[1];
        const decode = await admin.auth().verifyIdToken(tokenId);
        console.log("decoded in the token", decode);
        req.decoded_email = decode.email;
      } catch (err) {}
      next();
    };

    // admin middle ware for vverfiying admin
    const adminVerify = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    // users related apis
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();

      const email = user.email;
      const existUser = await usersCollection.findOne({ email });
      if (existUser) {
        return res.send({ message: "user already exist" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.patch("/users/:id", firebaseToken, adminVerify, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const roleInfo = req.body;
      const updatedData = {
        $set: {
          role: roleInfo.role,
        },
      };
      const result = await usersCollection.updateOne(query, updatedData);
      res.send(result);
    });

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      console.log(user);
      res.send({ role: user?.role || "user" });
    });

    // parcels related apis
    app.post("/parcels", async (req, res) => {
      const parcelData = req.body;
      parcelData.createdAt = new Date();
      const result = await parcelsCollection.insertOne(parcelData);
      res.send(result);
    });

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollection.deleteOne(query);
      res.send(result);
    });

    app.get('/parcels/rider',async(req,res)=>{
      const {riderEmail,deliveryStatus} = req.query 
      const query = {}

      if(riderEmail){
        query.riderEmail = riderEmail
      }

      if(deliveryStatus !== 'parcel_deliverd'){
        query.deliveryStatus = {$nin:['parcel_deliverd']}
      }

      if(deliveryStatus){
        query.deliveryStatus = deliveryStatus
      }

      const result = await parcelsCollection.find(query).toArray()
      res.send(result)
    })

    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollection.findOne(query);
      res.send(result);
    });

    app.get("/parcels", async (req, res) => {
      const { email, deliveryStatus } = req.query;
      const query = {};
      if (email) {
        query.senderEmail = email;
      }

      if (deliveryStatus) {
        query.deliveryStatus = deliveryStatus;
      }

      const cursor = parcelsCollection.find(query).sort({ cost: 1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.patch('/parcels/:id',async(req,res)=>{
      const {riderEmail,riderName,riderId} = req.body 
      const id = req.params.id 
      const query = {_id: new ObjectId(id)}

      const updatedData = {
        $set:{
          deliveryStatus: 'rider_assigned',
          riderId: riderId,
          riderEmail: riderEmail,
          riderName: riderName
        }
      }

      const result = await parcelsCollection.updateOne(query,updatedData)

      // update rider info 
      const riderQuery = {_id: new ObjectId(riderId)}
      const riderUpdatedData = {
        $set:{
          workStatus: 'in-delivery'
        }
      }
      const riderResult = await ridersCollection.updateOne(riderQuery,riderUpdatedData)
      res.send(riderResult)
    })

    app.patch('/parcels/:id/status',async(req,res)=>{
      const {deliveryStatus,riderId} = req.body 
      const id = req.params.id 
      const query = {_id: new ObjectId(id)}
      const updatedData = {
        $set:{
          deliveryStatus: deliveryStatus
        }
      }

     if(deliveryStatus === 'parcel_deliverd'){
       // update rider info 
      const riderQuery = {_id: new ObjectId(riderId)}
      const riderUpdatedData = {
        $set:{
          workStatus: 'available'
        }
      }
      const riderResult = await ridersCollection.updateOne(riderQuery,riderUpdatedData)
      res.send(riderResult)
     }

      const result = await parcelsCollection.updateOne(query,updatedData)
      res.send(result)
    })

    // stripe payment related apis
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo?.parcelName,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo?.senderEmail,
        metadata: {
          parcelId: paymentInfo?.parcelId,
          parcelName: paymentInfo?.parcelName,
        },
        mode: "payment",
        success_url: `${process.env.YOUR_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.YOUR_DOMAIN}/dashboard/payment-canceled`,
      });

      console.log(session);
      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const paymentExist = await paymentCollection.findOne(query);
      if (paymentExist) {
        return res.send({
          message: "aleardy exist",
          transactionId,
          trackingId: paymentExist.trackingId,
        });
      }
      console.log(session);
      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const deliveryStatus = "pending-pickup";
        const query = { _id: new ObjectId(id) };
        const trackingId =
          "TRK-" + Math.random().toString(36).substring(2, 10).toUpperCase();
        const update = {
          $set: {
            paymentStatus: "paid",
            deliveryStatus: deliveryStatus,
            trackingId: trackingId,
            transactionId: session.payment_intent,
          },
        };
        const result = await parcelsCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          PaidAt: new Date(),
          trackingId: trackingId,
        };

        if (session.payment_status === "paid") {
          const paymentResult = await paymentCollection.insertOne(payment);
          return res.send({
            success: true,
            modifyParcel: result,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            paymentInfo: paymentResult,
          });
        }
      }
      return res.send({ success: false });
    });

    app.get("/payments", firebaseToken, async (req, res) => {
      const email = req.query.email;
      // console.log(req.headers)
      const query = {};
      if (email) {
        query.customerEmail = email;

        // check the email
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "forbidden" });
        }
      }
      const cursor = paymentCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // riders related api
    app.post("/riders", async (req, res) => {
      const rider = req.body;
      rider.status = "pending";
      rider.createdAt = new Date();
      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    });

    app.get("/riders", async (req, res) => {
      const {status,district,workStatus} = req.query
      const query = {};
      if (status) {
        query.status = status;
      }
      if(district){
        query.district = district
      }
      if(workStatus){
        query.workStatus = workStatus
      }
      const result = await ridersCollection.find(query).toArray();
      res.send(result);
    });

    app.patch("/riders/:id", firebaseToken, adminVerify, async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updateInfo = {
        $set: {
          status: status,
          workStatus: 'available'
        },
      };
      const result = await ridersCollection.updateOne(query, updateInfo);

      // update user role
      if (status === "accepted") {
        const email = req.body.email;
        const userQuery = { email };
        const updateUser = {
          $set: {
            role: "rider",
          },
        };
        const userResult = await usersCollection.updateOne(
          userQuery,
          updateUser
        );
      }

      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
