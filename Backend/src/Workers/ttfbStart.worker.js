import { startTtfbWorker } from "./ttfb.Worker.js";
// import lightHouseworker from "./Lighthouse.Worker.js"
// import worker from "./uptime.Worker.js"

const regions = [
    "india",
    "europe",
    "usa"
];

regions.forEach((region) => {
    startTtfbWorker(region);

    console.log(`TTFB worker started for region: ${region}`);
});