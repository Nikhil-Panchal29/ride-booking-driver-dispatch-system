import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../src/config/db.js';
import Ride from '../src/models/Ride.js';
import RideEvent from '../src/models/RideEvent.js';

const API_URL = process.env.API_URL || 'http://localhost:5000';
const TOTAL_RIDES = 100;
const WAIT_TIMEOUT_MS = 120000;
const POLL_INTERVAL_MS = 1000;

const PICKUPS = ['Mumbai', 'Delhi', 'Bangalore', 'Pune', 'Hyderabad'];
const DROPS = ['Navi Mumbai', 'Gurgaon', 'Electronic City', 'Kothrud', 'HITEC City'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function bookRide(index) {
  const payload = {
    riderName: `Load Rider ${index + 1}`,
    pickup: PICKUPS[index % PICKUPS.length],
    drop: DROPS[index % DROPS.length],
  };

  const response = await fetch(`${API_URL}/rides`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to book ride ${index + 1}: ${response.status} ${text}`);
  }

  const data = await response.json();

  if (!data.rideId) {
    throw new Error(`Ride ${index + 1} response did not include rideId`);
  }

  return data.rideId;
}

async function waitForFinalRides(rideIds) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let finalCount = 0;

  while (Date.now() < deadline) {
    finalCount = await Ride.countDocuments({
      rideId: { $in: rideIds },
      status: { $in: ['ASSIGNED', 'NO_DRIVER_FOUND'] },
    });

    if (finalCount === rideIds.length) {
      return finalCount;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  console.warn(`Timed out waiting for final ride statuses. Final count: ${finalCount}/${rideIds.length}`);
  return finalCount;
}

async function getDoubleAssignedRideCount(rideIds) {
  const result = await RideEvent.aggregate([
    { $match: { rideId: { $in: rideIds }, status: 'ASSIGNED' } },
    { $group: { _id: '$rideId', assignments: { $sum: 1 } } },
    { $match: { assignments: { $gt: 1 } } },
    { $count: 'doubleAssignedRides' },
  ]);

  return result[0]?.doubleAssignedRides || 0;
}

async function main() {
  await connectDB();

  console.log(`Booking ${TOTAL_RIDES} rides on ${API_URL} ...`);

  // Book all rides at the same time using Promise.all.
  const rideIds = await Promise.all(
    Array.from({ length: TOTAL_RIDES }, (_, index) => bookRide(index))
  );

  console.log(`Booked ${rideIds.length} rides. Waiting for final statuses ...`);

  const finalCount = await waitForFinalRides(rideIds);

  // Fetch API statistics for visibility. The pass/fail checks below are
  // calculated directly from MongoDB for the rides created by this test.
  let apiStats = null;
  try {
    const response = await fetch(`${API_URL}/rides/stats`);
    if (response.ok) {
      apiStats = await response.json();
    }
  } catch (error) {
    console.warn('Could not fetch /rides/stats:', error.message);
  }

  if (apiStats) {
    console.log('API /rides/stats response:');
    console.log(apiStats);
  }

  const [totalCreated, requested, assigned, noDriverFound, doubleAssignedRides] =
    await Promise.all([
      Ride.countDocuments({ rideId: { $in: rideIds } }),
      Ride.countDocuments({ rideId: { $in: rideIds }, status: 'REQUESTED' }),
      Ride.countDocuments({ rideId: { $in: rideIds }, status: 'ASSIGNED' }),
      Ride.countDocuments({ rideId: { $in: rideIds }, status: 'NO_DRIVER_FOUND' }),
      getDoubleAssignedRideCount(rideIds),
    ]);

  const finalRides = assigned + noDriverFound;

  console.table([
    { status: 'REQUESTED', count: requested },
    { status: 'ASSIGNED', count: assigned },
    { status: 'NO_DRIVER_FOUND', count: noDriverFound },
    { status: 'FINAL_TOTAL', count: finalRides },
  ]);

  const checks = [
    {
      check: 'Total rides created',
      expected: TOTAL_RIDES,
      actual: totalCreated,
      passed: totalCreated === TOTAL_RIDES,
    },
    {
      check: 'ASSIGNED + NO_DRIVER_FOUND',
      expected: TOTAL_RIDES,
      actual: finalRides,
      passed: finalRides === TOTAL_RIDES,
    },
    {
      check: 'Double-assigned rides',
      expected: 0,
      actual: doubleAssignedRides,
      passed: doubleAssignedRides === 0,
    },
    {
      check: 'Rides stuck in REQUESTED',
      expected: 0,
      actual: requested,
      passed: requested === 0,
    },
  ];

  console.table(checks);

  const allPassed = checks.every((item) => item.passed) && finalCount === rideIds.length;

  if (allPassed) {
    console.log('Load test passed.');
  } else {
    console.log('Load test failed.');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('Load test error:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
