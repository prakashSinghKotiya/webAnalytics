import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import cookieParser from 'cookie-parser';

import { connectdb } from './config/db.mongoose.js';
import { sharedRedisConnection } from './config/redis.js';
import { initializeGuestDemo, optionalActor } from './Middleware/guestDemo.Mw.js';
import checkAuth from './Middleware/authentication.Mw.js';
import { startallworkers } from './Workers/worker.js';

import UserRoutes from "./Routes/User.Routes.js";
import AuthRoutes from "./Routes/Auth.Routes.js";
import AdminRoutes from "./Routes/Admin.Routes.js";
import ttfbRoute from './Routes/ttfb.Route.js';
import uptimeRobotRoute from './Routes/uptimeRobot.Routes.js';
import LighthouseRoute from './Routes/Lighthouse.Route.js';
import DnsRecordRoutes from './Routes/dnsRecord.Routes.js';
import RedirectCheckRoutes from './Routes/redirectCheck.Routes.js';
import WhoisLookupRoutes from './Routes/whoisLookup.Routes.js';

import { Ttfb } from './Models/Ttfb.Model.js';
import { Lighthouse } from './Models/Lighthouse.Model.js';
import { DnsRecord } from './Models/dnsRecord.Model.js';
import { RedirectCheck } from './Models/redirectCheck.Model.js';
import { WhoisLookup } from './Models/whoisLookup.Model.js';

try {
  await connectdb();
  console.log("Database connected successfully.");
} catch (err) {
  console.error("Database connection failed: ", err);
}

startallworkers();

export const app = express();
app.set('trust proxy', 1);
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.json());
// const clientOriginConfig = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
// const allowedOrigins = clientOriginConfig.split(',').map((o) => o.trim().replace(/\/+$/, ''));

app.use(cors({
  origin:(process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim().replace(/\/+$/, '')),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-guest-id', 'x-session-id'],
  exposedHeaders: ['x-guest-id', 'Authorization'],
}));

app.get('/', (req, res) => {
  res.send('running server');
});

// Demo Infrastructure Health Check
app.get('/demo/health', async (req, res) => {
  const io = req.app.get('io');
  let redisStatus = sharedRedisConnection.status;
  let redisPing = false;
  try {
    const pong = await sharedRedisConnection.ping();
    redisPing = pong === 'PONG';
  } catch (err) {
    console.error("[HealthCheck] Redis ping error:", err.message);
  }

  res.status(200).json({
    status: 'healthy',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    services: ['ttfb', 'lighthouse', 'dns', 'redirect', 'whois', 'uptime'],
    database: {
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      redis: redisPing ? 'connected' : redisStatus,
    },
    sockets: {
      connectedClients: io ? io.engine?.clientsCount || 0 : 0,
    },
  });
});

app.use("/user", UserRoutes);
app.use("/auth", AuthRoutes);
app.use("/admin", AdminRoutes);

// Establishes the signed guest cookie and returns roomId before browser opens Socket.IO.
app.post('/demo/session', initializeGuestDemo);

// Unified fallback status polling endpoint (usable by both guest and authenticated users)
app.get('/demo/status/:service/:id', optionalActor, async (req, res) => {
  try {
    const { service, id } = req.params;
    const userId = req.user?._id?.toString();
    const guestId = req.guestId;

    if (!userId && !guestId) {
      return res.status(401).json({
        success: false,
        message: "Authentication or guest session required",
      });
    }

    const query = { _id: id };
    if (userId) {
      query.userId = userId;
    } else {
      query.guestId = guestId;
    }

    let doc = null;
    switch (service.toLowerCase()) {
      case 'ttfb':
        doc = await Ttfb.findOne(query).lean();
        break;
      case 'lighthouse':
        doc = await Lighthouse.findOne(query).lean();
        break;
      case 'dns':
      case 'dnsrecord':
        doc = await DnsRecord.findOne(query).lean();
        break;
      case 'redirect':
        doc = await RedirectCheck.findOne(query).lean();
        break;
      case 'whois':
        doc = await WhoisLookup.findOne(query).lean();
        break;
      default:
        return res.status(400).json({
          success: false,
          error: `Invalid service '${service}'. Expected one of: ttfb, lighthouse, dns, redirect, whois`,
        });
    }

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: `${service} record not found`,
      });
    }

    return res.status(200).json({
      success: true,
      service: service.toLowerCase(),
      jobId: doc._id.toString(),
      status: doc.status,
      result: doc.result || null,
      error: doc.error || null,
      createdAt: doc.createdAt,
      completedAt: doc.completedAt || null,
    });
  } catch (err) {
    console.error("[demo/status] Error fetching status:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error fetching status",
    });
  }
});

// Demo & service routes
app.use('/ttfb', ttfbRoute);
app.use('/uptime', checkAuth, uptimeRobotRoute);
app.use('/lighthouse', LighthouseRoute);
app.use('/dns', DnsRecordRoutes);
app.use('/redirect', RedirectCheckRoutes);
app.use('/whois', WhoisLookupRoutes);
