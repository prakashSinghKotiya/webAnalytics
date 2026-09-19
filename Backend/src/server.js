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




try {
    await connectdb();
    console.log("Database connected successfully.");
} catch (err) { console.error("Database connection failed: ", err); }

export const app = express()

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

app.use('/ttfb',checkAuth, ttfbRoute);
app.use('/uptime',checkAuth, uptimeRobotRoute);
app.use('/lighthouse',checkAuth, LighthouseRoute);



