import express from 'express';
import Ride from '../models/Ride.js';
import QueueJob from '../models/QueueJob.js';
import { getNextCounterValue, publishEvent } from '../services/publishEvent.js';

const router = express.Router();

function formatRideId(seq) {
  return `RIDE-${String(seq).padStart(6, '0')}`;
}

// POST /rides - create a ride and add it to the MongoDB queue.
router.post('/rides', async (req, res) => {
  const { riderName, pickup, drop } = req.body || {};

  if (!riderName || !pickup || !drop) {
    return res.status(400).json({ error: 'riderName, pickup and drop are required' });
  }

  try {
    const rideSeq = await getNextCounterValue('rideId');
    const rideId = formatRideId(rideSeq);

    const ride = await Ride.create({
      rideId,
      riderName,
      pickup,
      drop,
      status: 'REQUESTED',
    });

    try {
      await QueueJob.create({ rideId, status: 'PENDING' });
      await publishEvent({ rideId, status: 'REQUESTED' });
    } catch (bookingError) {
      // Best-effort cleanup: do not leave a ride without its queue job/event.
      await QueueJob.deleteOne({ rideId }).catch(() => {});
      await Ride.deleteOne({ rideId }).catch(() => {});
      throw bookingError;
    }

    return res.status(201).json({ rideId, status: ride.status });
  } catch (error) {
    console.error('Failed to book ride:', error.message);
    return res.status(500).json({ error: 'Failed to book ride' });
  }
});

// GET /rides/stats - simple counts grouped by status.
router.get('/rides/stats', async (req, res) => {
  try {
    const [total, requested, assigned, noDriverFound] = await Promise.all([
      Ride.countDocuments(),
      Ride.countDocuments({ status: 'REQUESTED' }),
      Ride.countDocuments({ status: 'ASSIGNED' }),
      Ride.countDocuments({ status: 'NO_DRIVER_FOUND' }),
    ]);

    return res.json({
      total,
      statusCounts: {
        REQUESTED: requested,
        ASSIGNED: assigned,
        NO_DRIVER_FOUND: noDriverFound,
      },
      finalRides: assigned + noDriverFound,
    });
  } catch (error) {
    console.error('Failed to fetch ride stats:', error.message);
    return res.status(500).json({ error: 'Failed to fetch ride stats' });
  }
});

// GET /rides/:id - fetch one ride by rideId.
router.get('/rides/:id', async (req, res) => {
  try {
    const ride = await Ride.findOne({ rideId: req.params.id }).lean();

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    return res.json(ride);
  } catch (error) {
    console.error('Failed to fetch ride:', error.message);
    return res.status(500).json({ error: 'Failed to fetch ride' });
  }
});

export default router;
