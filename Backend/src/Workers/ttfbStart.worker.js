import { startTtfbWorker } from "./ttfb.Worker.js";
//import lightHouseworker from "./Lighthouse.Worker.js"
import uptimeWorker from "./uptime.Worker.js";
import dnsWorker from "./dnsRecordcheck.Worker.js";
import redirectWorker from "./redirectCheck.Worker.js"
//import whoisWorker from "./whoisLookup.Worker.js"
const regions = [
    "india",
    "europe",
    "usa"
];

regions.forEach((region) => {
    startTtfbWorker(region);

    console.log(`TTFB worker started for region: ${region}`);
});