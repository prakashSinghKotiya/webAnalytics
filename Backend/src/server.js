import express from 'express';
import cors from 'cors';
import ttfbRoute from './Routes/ttfb.Route.js';
import uptimeRobotRoute from './Routes/uptimeRobot.Routes.js';
import { connectdb } from './config/db.mongoose.js';
import LighthouseRoute from './Routes/Lighthouse.Route.js';

import  UserRoutes from "./Routes/User.Routes.js"
import  AuthRoutes from "./Routes/Auth.Routes.js"
import  AdminRoutes from "./Routes/Admin.Routes.js"
import checkAuth from './Middleware/authentication.Mw.js';
import cookieParser from 'cookie-parser';
// import { checkDnsRecords } from './Services/dnsRecordtype.Service.js';
// import { findRedirects } from './Services/redirectCheck.Service.js';
// import { runPageSpeed } from './Services/psInsight.Service.js';
import DnsRecordRoutes from './Routes/dnsRecord.Routes.js';
import RedirectCheckRoutes from './Routes/redirectCheck.Routes.js';
import WhoisLookupRoutes from './Routes/whoisLookup.Routes.js';
import { initializeGuestDemo } from './Middleware/guestDemo.Mw.js';




try {
    await connectdb();
    console.log("Database connected successfully.");
} catch (err) { console.error("Database connection failed: ", err); }

export const app = express()
app.set('trust proxy', 1)
app.use(cookieParser(process.env.COOKIE_SECRET))
app.use(express.json())
app.use(cors({
    origin:  process.env.CLIENT_ORIGIN  || 'http://localhost:5173',
    credentials: true,
}))

app.get('/', (req, res) => {
    res.send('running server')
})




app.use("/user", UserRoutes) 
app.use("/auth", AuthRoutes)
app.use("/admin", AdminRoutes)

// This establishes the signed guest cookie before the browser opens Socket.IO.
app.post('/demo/session', initializeGuestDemo);

// The routers protect history and account-only endpoints themselves. Their two
// demo creation endpoints accept either an authenticated user or a guest.
app.use('/ttfb', ttfbRoute);
app.use('/uptime',checkAuth, uptimeRobotRoute);
app.use('/lighthouse', LighthouseRoute);

app.use('/dns', DnsRecordRoutes);
app.use('/redirect', RedirectCheckRoutes);
app.use('/whois', WhoisLookupRoutes);




