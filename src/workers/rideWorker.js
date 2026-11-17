import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Ride from '../models/Ride.js';
import QueueJob from '../models/QueueJob.js';
import { publishEvent } from '../services/publishEvent.js';

const POLL_INTERVAL_MS = 500;
const MAX_REJECTIONS = 3;

// 10 hardcoded fake drivers. In a real system these would come from a
// driver service/database, but the assignment rules are the same.
const FAKE_DRIVERS = Array.from({ length: 10 }, (_, index) => ({
  id: `DRV-${String(index + 1).padStart(3, '0')}`,
  name: `Driver ${index + 1}`,
}));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Atomically claims one PENDING job.
// findOneAndUpdate with status: 'PENDING' means only one worker can win
// each job, which prevents duplicate processing.
async function claimNextJob() {
  return QueueJob.findOneAndUpdate(
    { status: 'PENDING' },
    { $set: { status: 'PROCESSING' } },
    { sort: { createdAt: 1 }, new: true }
  );
}

// Tries to assign a driver inside a transaction.
// The Ride update is conditional: it only succeeds if the ride is still
// REQUESTED and has no driver. This is the key protection against assigning
// one ride to two drivers.
async function assignDriver(job, driver) {
  const session = await mongoose.startSession();
  let assignedRide = null;

  try {
    await session.withTransaction(async () => {
      assignedRide = await Ride.findOneAndUpdate(
        { rideId: job.rideId, status: 'REQUESTED', driverId: null },
        {
          $set: {
            status: 'ASSIGNED',
            driverId: driver.id,
            rejectionCount: job.rejections,
            assignedAt: new Date(),
          },
        },
        { new: true, session }
      );

      if (assignedRide) {
        // publishEvent allocates the event seq inside this transaction, so
        // event sequence order matches transaction commit order.
        await publishEvent(
          { rideId: job.rideId, status: 'ASSIGNED' },
          { session }
        );
        await QueueJob.updateOne(
          { _id: job._id },
          { $set: { status: 'DONE', driverId: driver.id } },
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }

  if (assignedRide) {
    console.log(`Ride ${job.rideId} assigned to ${driver.id}`);
    return true;
  }

  return false;
}

// Marks a ride as NO_DRIVER_FOUND after 3 rejections, also inside a
// transaction so the ride update, event and queue completion stay together.
async function markNoDriverFound(job) {
  const session = await mongoose.startSession();
  let updatedRide = null;

  try {
    await session.withTransaction(async () => {
      updatedRide = await Ride.findOneAndUpdate(
        { rideId: job.rideId, status: 'REQUESTED', driverId: null },
        {
          $set: {
            status: 'NO_DRIVER_FOUND',
            rejectionCount: MAX_REJECTIONS,
            noDriverAt: new Date(),
          },
        },
        { new: true, session }
      );

      if (updatedRide) {
        await publishEvent(
          { rideId: job.rideId, status: 'NO_DRIVER_FOUND' },
          { session }
        );
        await QueueJob.updateOne(
          { _id: job._id },
          { $set: { status: 'DONE' } },
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }

  if (updatedRide) {
    console.log(`Ride ${job.rideId} has NO_DRIVER_FOUND`);
    return true;
  }

  // If another process already changed the ride, just finish the job.
  await QueueJob.updateOne({ _id: job._id }, { $set: { status: 'DONE' } });
  return false;
}

async function handleJob(job) {
  const ride = await Ride.findOne({ rideId: job.rideId }).lean();

  // Nothing to do if the ride is missing or already finished.
  if (!ride || ride.status !== 'REQUESTED') {
    await QueueJob.updateOne({ _id: job._id }, { $set: { status: 'DONE' } });
    return;
  }

  // Create a shuffled driver order once per ride. rejections is used as the
  // index, so rejection #1 tries driverOrder[0], #2 tries driverOrder[1], etc.
  if (!Array.isArray(job.driverOrder) || job.driverOrder.length === 0) {
    job.driverOrder = shuffle(FAKE_DRIVERS).map((driver) => driver.id);
    await job.save();
  }

  while (job.rejections < MAX_REJECTIONS) {
    const driverId = job.driverOrder[job.rejections];
    const driver = FAKE_DRIVERS.find((item) => item.id === driverId);

    if (!driver) {
      throw new Error(`Unknown driver id in queue job: ${driverId}`);
    }

    // Simulate a random driver response: 50% accept, 50% reject.
    const accepted = Math.random() < 0.5;

    if (accepted) {
      const assigned = await assignDriver(job, driver);
      if (assigned) return;

      // Ride changed while we were assigning, so finish the job safely.
      await QueueJob.updateOne({ _id: job._id }, { $set: { status: 'DONE' } });
      return;
    }

    job.rejections += 1;
    await job.save();
    console.log(`Ride ${job.rideId} rejected by ${driver.id} (${job.rejections}/${MAX_REJECTIONS})`);
  }

  await markNoDriverFound(job);
}

// Processes every job that is currently PENDING, then returns.
async function processAvailableJobs() {
  let job;

  while ((job = await claimNextJob())) {
    try {
      await handleJob(job);
    } catch (error) {
      console.error(`Error processing ride ${job.rideId}:`, error.message);

      // Put the job back in PENDING so it can be retried.
      // driverOrder and rejections were saved on the job document, so the
      // worker will continue from where it stopped.
      await QueueJob.updateOne({ _id: job._id }, { $set: { status: 'PENDING' } });
    }
  }
}

async function startWorker() {
  await connectDB();

  // If the worker was restarted while jobs were PROCESSING, move them back
  // to PENDING. This assumes only one worker process is running.
  await QueueJob.updateMany({ status: 'PROCESSING' }, { $set: { status: 'PENDING' } });

  console.log('Ride worker started');

  while (true) {
    try {
      await processAvailableJobs();
    } catch (error) {
      console.error('Worker loop error:', error.message);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

startWorker();
