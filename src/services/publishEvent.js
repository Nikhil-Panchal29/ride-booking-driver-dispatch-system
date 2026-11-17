import Counter from '../models/Counter.js';
import RideEvent from '../models/RideEvent.js';

// Atomically increases a named counter and returns the new value.
// Used for ride IDs and event sequence numbers.
export async function getNextCounterValue(counterName, { session } = {}) {
  const counter = await Counter.findByIdAndUpdate(
    counterName,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, ...(session ? { session } : {}) }
  );

  return counter.seq;
}

// Stores a ride status event in MongoDB.
// The seq number lets consumers read events in order.
// When called inside a transaction, the counter is incremented in the same
// transaction, so sequence order matches transaction commit order.
export async function publishEvent({ rideId, status, seq }, { session } = {}) {
  const eventSeq = seq ?? (await getNextCounterValue('rideEventSeq', { session }));

  const event = new RideEvent({
    rideId,
    status,
    seq: eventSeq,
  });

  await event.save(session ? { session } : {});
  return event;
}
