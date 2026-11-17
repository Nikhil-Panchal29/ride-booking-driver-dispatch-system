import connectDB from '../config/db.js';
import RideEvent from '../models/RideEvent.js';
import ConsumerOffset from '../models/ConsumerOffset.js';

const CONSUMER_NAME = 'ops';
const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let isPolling = false;

// Polls ride_events for events after this consumer's saved offset.
// Events are never deleted, so ops and billing can both read all events.
// lastSeq is updated only after an event is handled, which keeps the
// consumer in order and avoids skipping events.
async function pollEvents() {
  if (isPolling) return;
  isPolling = true;

  try {
    const offset = await ConsumerOffset.findOne({ name: CONSUMER_NAME });
    const lastSeq = offset?.lastSeq || 0;

    const events = await RideEvent.find({ seq: { $gt: lastSeq } })
      .sort({ seq: 1 })
      .limit(BATCH_SIZE)
      .lean();

    for (const event of events) {
      console.log(`Ops: ride ${event.rideId} is now in status ${event.status}`);

      // Move the offset forward one event at a time.
      await ConsumerOffset.findOneAndUpdate(
        { name: CONSUMER_NAME },
        { $set: { lastSeq: event.seq } },
        { upsert: true }
      );
    }
  } catch (error) {
    console.error('Ops consumer error:', error.message);
  } finally {
    isPolling = false;
  }
}

async function startConsumer() {
  await connectDB();

  // Create the offset document if this is the first run.
  await ConsumerOffset.findOneAndUpdate(
    { name: CONSUMER_NAME },
    { $setOnInsert: { lastSeq: 0 } },
    { upsert: true, new: true }
  );

  console.log('Ops consumer started');

  while (true) {
    await pollEvents();
    await sleep(POLL_INTERVAL_MS);
  }
}

startConsumer();
