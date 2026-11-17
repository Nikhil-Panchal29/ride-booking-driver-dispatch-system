import mongoose from 'mongoose';

const rideEventSchema = new mongoose.Schema(
  {
    // Monotonic sequence number generated from the Counter collection.
    // Consumers use this to read events in order without deleting them.
    seq: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    rideId: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['REQUESTED', 'ASSIGNED', 'NO_DRIVER_FOUND'],
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model('RideEvent', rideEventSchema);
