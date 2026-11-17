import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Connects the Node.js app to MongoDB Atlas using MONGO_URI from .env.
const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Copy .env.example to .env and add your MongoDB Atlas connection string.');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

export default connectDB;
