import mongoose from 'mongoose';

const consumerOffsetSchema = new mongoose.Schema({
  // Existing databases may already have a unique index on `name`.
  name: {
    type: String,
    required: true,
    unique: true,
  },
  // Last event sequence number processed by this consumer.
  lastSeq: {
    type: Number,
    default: 0,
  },
});

export default mongoose.model('ConsumerOffset', consumerOffsetSchema);
