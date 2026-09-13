import express from 'express';
import cors from 'cors';
import ttfbRoute from './Routes/ttfb.Route.js';
import uptimeRobotRoute from './Routes/uptimeRobot.Routes.js';
import { connectdb } from './config/db.mongoose.js';




try {
    await connectdb();
    console.log("Database connected successfully.");
} catch (err) { console.error("Database connection failed: ", err); }

export const app = express()

app.use(express.json())
app.use(cors({
    origin: '*',
    credentials: true,
}))

app.get('/', (req, res) => {
    res.send('running server')
})



app.use('/ttfb', ttfbRoute);
app.use('/uptime', uptimeRobotRoute);



// const PORT = process.env.PORT || 5000
// app.listen(PORT, () => {
//     console.log(`Server is running on port ${PORT}`)
// })