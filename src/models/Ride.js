import mongoose from 'mongoose';

const rideSchema = new mongoose.Schema(
  {
    rideId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    riderName: {
      type: String,
      required: true,
    },
    pickup: {
      type: String,
      required: true,
    },
    drop: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['REQUESTED', 'ASSIGNED', 'NO_DRIVER_FOUND'],
      default: 'REQUESTED',
    },
    driverId: {
      type: String,
      default: null,
    },
    rejectionCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

export default mongoose.model('Ride', rideSchema);
