import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './routes/apiRoutes.js';
import { connectDB } from './services/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Initialize MongoDB connection on server startup
connectDB()
  .then(() => {
    console.log('[Server Startup] MongoDB readyState connected.');
  })
  .catch((err) => {
    console.error('[Server Startup] MongoDB initial connection error:', err.message);
  });

// Body parser with 50mb limit to prevent 413 Payload Too Large error
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Middleware to ensure DB connection on serverless requests
app.use(async (_req, _res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('[Server] DB Connection error:', err);
    next();
  }
});

// Mount REST API routes
app.use('/api', apiRouter);

// Development vs Production static/vite middleware
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  import('vite').then(({ createServer: createViteServer }) => {
    createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    }).then((vite) => {
      app.use(vite.middlewares);
      const PORT = Number(process.env.PORT) || 3000;
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`[Server] Dev server running at http://0.0.0.0:${PORT}`);
      });
    });
  });
} else if (!process.env.VERCEL) {
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Production server running at http://0.0.0.0:${PORT}`);
  });
}

// EXPORT APP FOR VERCEL SERVERLESS:
export default app;
