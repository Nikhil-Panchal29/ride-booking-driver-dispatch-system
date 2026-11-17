import express from 'express';
import connectDB from './config/db.js';
import rideRoutes from './routes/rideRoutes.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// Keep routes at the root so the API matches POST /rides, GET /rides/:id, etc.
app.use('/', rideRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
  });
});
