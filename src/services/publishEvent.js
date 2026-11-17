import Counter from '../models/Counter.js';
import RideEvent from '../models/RideEvent.js';

// Atomically increases a named counter and returns the new value.
// Used for ride IDs and event sequence numbers.
export async function getNextCounterValue(counterName) {
  const counter = await Counter.findByIdAndUpdate(
    counterName,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  return counter.seq;
}

// Stores a ride status event in MongoDB.
// The seq number lets consumers read events in order.
export async function publishEvent({ rideId, status, seq }) {
  const eventSeq = seq ?? (await getNextCounterValue('rideEventSeq'));

  const event = new RideEvent({
    rideId,
    status,
    seq: eventSeq,
  });

  await event.save();
  return event;
}
