import mongoose from 'mongoose';

const queueJobSchema = new mongoose.Schema(
  {
    rideId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'DONE'],
      default: 'PENDING',
    },
    // Shuffled fake-driver order for this ride. The worker uses rejections
    // as the index, so each rejection naturally tries the next driver.
    driverOrder: {
      type: [String],
      default: [],
    },
    rejections: {
      type: Number,
      default: 0,
    },
    driverId: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model('QueueJob', queueJobSchema);
