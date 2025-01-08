const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const port = process.env.PORT || 5000;
const app = express();

// middleware
app.use(
  cors({
    origin: ["http://localhost:5173", "https://the-king-hotel.web.app", "https://the-king-hotel.firebaseapp.com"],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
app.use(express.json());
app.use(cookieParser());
// verify cookie token
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_user}:${process.env.DB_password}@cluster0.p5jac.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const roomsCollection = client
      .db("hotelmanagementdb")
      .collection("roomsinfo");
    const bookroomsCollection = client
      .db("hotelmanagementdb")
      .collection("bookRoomsinfo");
    const reviewroomsCollection = client
      .db("hotelmanagementdb")
      .collection("reviewsRoomsinfo");

    //  generate jwt token
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.SECRET_KEY, {
        expiresIn: "1d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });
    // logout && clear cookie
    app.get("/logout", async (req, res) => {
      res
        .clearCookie("token", {
          maxAge: 0,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    //  rooms data get
    app.get("/rooms", async (req, res) => {
      const skip = parseInt(req.query.skip) || 1;
      const limit = parseInt(req.query.limit) || 8;
      const sort = req.query.sort;
      const sortOption = sort ? { price: sort === "asc" ? 1 : -1 } : {};
      const result = await roomsCollection
        .find({})
        .sort(sortOption)
        .skip((skip - 1) * limit)
        .limit(limit)
        .toArray();

      res.send(result);
    });

    // total rooms count
    app.get("/rooms_count", async (req, res) => {
      const count = await roomsCollection.estimatedDocumentCount();
      res.send({ count });
    });

    // room data  by id
    app.get("/room_details/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await roomsCollection.findOne(query);
      res.send(result);
    });

    // BOOKING room
    app.post("/book_room", verifyToken, async (req, res) => {
      const bookrooms = req.body;

      const query = {
        userEmail: bookrooms.userEmail,
        roomId: bookrooms.roomId,
      };
      const alreadyBooked = await bookroomsCollection.findOne(query);
      if (alreadyBooked) {
        return res.status(400).send("You have already booked this room.");
      }

      const result = await bookroomsCollection.insertOne(bookrooms);

      // Update room unavailable
      const roomQuery = { _id: new ObjectId(bookrooms.roomId) };
      const updateQuery = {
        $set: { available: false },
      };
      const updateAvailable = await roomsCollection.updateOne(
        roomQuery,
        updateQuery
      );

      if (updateAvailable.modifiedCount === 0) {
        return res.status(500).send("Failed to update room availability.");
      }

      res.send(result);
    });

    // cancel booking
    app.delete("/cancel_booking", verifyToken, async (req, res) => {
      const { id, roomId } = req.query;

      const query = { _id: new ObjectId(id) };
      const result = await bookroomsCollection.deleteOne(query);
      // Update room unavailable
      const roomQuery = { _id: new ObjectId(roomId) };
      const updateQuery = {
        $set: { available: true },
      };
      const updateAvailable = await roomsCollection.updateOne(
        roomQuery,
        updateQuery
      );
      if (updateAvailable.modifiedCount === 0) {
        return res.status(500).send("Failed to update room availability.");
      }
      res.send(result);
    });
    //get booked rooms
    app.get("/booked_rooms", verifyToken, async (req, res) => {
      const email = req.query.email;
      const query = { userEmail: email };
      if (req.user.email !== email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await bookroomsCollection.find(query).toArray();
      res.send(result);
    });
    // Update room
    app.patch("/update_booking", verifyToken, async (req, res) => {
      const { id } = req.query;
      const update = req.body;
      const query = { _id: new ObjectId(id) };
      const updateQuery = {
        $set: update,
      };
      const result = await bookroomsCollection.updateOne(query, updateQuery);
      res.send(result);
    });
    //  review post
    app.post("/review", verifyToken, async (req, res) => {
      const review = req.body;
      const result = await reviewroomsCollection.insertOne(review);
      const roomQuery = { _id: new ObjectId(review.roomId) };
      const room = await roomsCollection.findOne(roomQuery);
      if (!room) {
        return res.status(404).send("room not found");
      }
      const newTotalReviews = (room.totalReviews || 0) + 1;
      const newRating =
        ((room.rating || 0) * (room.totalReviews || 0) + review.rooomRating) /
        newTotalReviews;

      const updateQuery = {
        $set: {
          rating: parseFloat(newRating.toFixed(1)),
          totalReviews: newTotalReviews,
        },
      };
      const updateRoom = await roomsCollection.updateOne(
        roomQuery,
        updateQuery
      );
      res.send(result);
    });
    // get reviews
    app.get("/reviews", async (req, res) => {
      const result = await reviewroomsCollection
        .find({})
        .sort({ timestamp: -1 })
        .toArray();
      res.send(result);
    });
    // get reviews by room id
    app.get("/reviews_ofRooms", verifyToken, async (req, res) => {
      const { room } = req.query;
      const query = { roomId: room };
      const skip = parseInt(req.query.skip) || 1;
      const limit = parseInt(req.query.limit) || 4;
      const result = await reviewroomsCollection
        .find(query)
        .sort({ timestamp: -1 })
        .skip((skip - 1) * limit)
        .limit(limit)
        .toArray();
      res.send(result);
    });
    // get reviews count of specific room
    app.get("/reviews_count", verifyToken, async (req, res) => {
      const { rm } = req.query;
      const query = { roomId: rm };
      const count = await reviewroomsCollection.countDocuments(query);
      res.send({ count });
    });

    // await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", async (req, res) => {
  res.send("Hotel Management System");
});
app.listen(port, () => {
  console.log(`server is running on port ${port}`);
});
