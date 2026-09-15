import {  QueueEvents } from "bullmq";
import connection from "../config/redis.js"

export const LighthouequeueListner = new QueueEvents("lighthouse-queue" , {
    connection
})