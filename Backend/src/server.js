import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { boss } from './queue/boss.js';
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
import Hostingreview from "./Routes/Hostingreview.Routes.js";
import ContactRoutes from "./Routes/Contact.Routes.js";

import { connectprismaSQLdb, prisma } from './config/db.prismaSQL.js';
import { resolveServiceRecord } from './Services/jobIdResolver.Service.js';




try {
 // await connectdb();
  await connectprismaSQLdb()
  console.log("Database connected successfully.");
} catch (err) {
  console.error("Database connection failed: ", err);
}

if (process.env.START_WORKERS_IN_SERVER !== "false") {
  startallworkers();
}

export const app = express();
app.set('trust proxy', 1);
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.json());

const defaultAllowedOrigins = [
  'https://monitormyhost.com',
  'https://www.monitormyhost.com',
  'https://dashboard.monitormyhost.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

const envAllowed = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

export const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...envAllowed]));

export const isOriginAllowed = (origin) => {
  if (!origin) return true;
  const normalized = origin.trim().replace(/\/+$/, '');
  return (
    allowedOrigins.includes(normalized) ||
    allowedOrigins.includes('*') ||
    /^https:\/\/(www\.|dashboard\.)?monitormyhost\.com$/i.test(normalized)
  );
};

export const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      return callback(null, origin || true);
    }
    console.warn(`[CORS] Disallowed origin: "${origin}"`);
    return callback(new Error(`CORS policy violation for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-guest-id', 'x-session-id'],
  exposedHeaders: ['x-guest-id', 'Authorization'],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
//app.options('*', cors(corsOptions));

app.get('/', (req, res) => {
  res.send('running server');
});

// app.post('/demo-uptime', async (req, res) => {
//   const{url}= req.body
//   let parsedUrl = new URL(url);
//   const hsotinginfo = await measureTTFB(parsedUrl)
//     //const result = await checkUrl(url)
//   res.json({hsotinginfo})
// });




// Demo Infrastructure Health Check
app.get('/demo/health', async (req, res) => {
  const io = req.app.get('io');

  let postgresConnected = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    postgresConnected = true;
  } catch (dbErr) {
    console.error("[HealthCheck] PostgreSQL ping error:", dbErr.message);
  }

  let pgbossConnected = false;
  try {
    await boss.getSchedules();
    pgbossConnected = true;
  } catch (bossErr) {
    console.error("[HealthCheck] pg-boss check error:", bossErr.message);
  }

  res.status(200).json({
    status: postgresConnected && pgbossConnected ? 'healthy' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    services: ['ttfb', 'lighthouse', 'dns', 'redirect', 'whois', 'uptime'],
    database: {
      postgresql: postgresConnected ? 'connected' : 'disconnected',
      pgboss: pgbossConnected ? 'connected' : 'disconnected',
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
// Resilient to both PostgreSQL integer primary keys and pg-boss job UUIDs.
app.get('/demo/status/:service/:id', optionalActor, async (req, res) => {
  try {
    const { service, id } = req.params;
    const userId = req.user?.id != null ? Number(req.user.id) : (req.user?._id != null ? Number(req.user._id) : undefined);
    const guestId = req.guestId;

    if (!userId && !guestId) {
      return res.status(401).json({
        success: false,
        message: "Authentication or guest session required",
      });
    }

    const { doc, service: resolvedService, dbIdKey, error } = await resolveServiceRecord({
      service,
      id,
      userId,
      guestId,
    });

    if (error === "invalid_service") {
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

    const docIdStr = doc.id.toString();
    return res.status(200).json({
      success: true,
      service: resolvedService,
      jobId: docIdStr,
      id: doc.id,
      ...(dbIdKey ? { [dbIdKey]: docIdStr } : {}),
      status: doc.status,
      result: doc.result || null,
      error: doc.error || null,
      createdAt: doc.createdAt,
      completedAt: doc.completedAt || null,
      ...(doc.region ? { region: doc.region } : {}),
      ...(doc.strategy ? { strategy: doc.strategy } : {}),
    });
  } catch (err) {
    console.error("[demo/status] Error fetching status:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error fetching status",
    });
  }
});



app.use("/review", Hostingreview);
app.use("/api/contact", ContactRoutes);
app.use("/contact", ContactRoutes);



// Demo & service routes
app.use('/ttfb', ttfbRoute);
app.use('/uptime', checkAuth, uptimeRobotRoute);
app.use('/lighthouse', LighthouseRoute);
app.use('/dns', DnsRecordRoutes);
app.use('/redirect', RedirectCheckRoutes);
app.use('/whois', WhoisLookupRoutes);
