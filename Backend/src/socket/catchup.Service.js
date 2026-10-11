import mongoose from "mongoose";
import { Ttfb } from "../Models/Ttfb.Model.js";
import { Lighthouse } from "../Models/Lighthouse.Model.js";
import { DnsRecord } from "../Models/dnsRecord.Model.js";
import { RedirectCheck } from "../Models/redirectCheck.Model.js";
import { WhoisLookup } from "../Models/whoisLookup.Model.js";

const serviceModelMap = {
  ttfb: Ttfb,
  lighthouse: Lighthouse,
  dns: DnsRecord,
  dnsrecord: DnsRecord,
  redirect: RedirectCheck,
  whois: WhoisLookup,
};

const isValidObjectId = (id) =>
  typeof id === "string" && mongoose.Types.ObjectId.isValid(id);

/**
 * Handles catchup requests when a client connects or reconnects.
 * Guarantees delivery even if the client connected after worker completed.
 */
export const handleSocketCatchup = async (socket, data) => {
  try {
    if (!data) return;

    // Normalizing request input: can be { jobs: [...] } or { jobIds: [...] } or { service, id }
    let requests = [];
    if (Array.isArray(data.jobs)) {
      requests = data.jobs;
    } else if (Array.isArray(data.jobIds)) {
      requests = data.jobIds.map((id) => ({ id, service: data.service }));
    } else if (data.id || data.jobId) {
      requests = [{ id: data.id || data.jobId, service: data.service }];
    }

    const userId = socket.data.userId;
    const guestId = socket.data.guestId;
    const clientRoom = socket.data.roomId;

    for (const item of requests) {
      const docId = item.id || item.jobId;
      if (!isValidObjectId(docId)) continue;

      let Model = item.service ? serviceModelMap[item.service.toLowerCase()] : null;

      // If service is specified, query directly
      if (Model) {
        await checkAndEmitDoc(socket, Model, docId, item.service.toLowerCase(), userId, guestId, clientRoom);
      } else {
        // Query across models
        for (const [svcName, M] of Object.entries(serviceModelMap)) {
          const found = await checkAndEmitDoc(socket, M, docId, svcName, userId, guestId, clientRoom);
          if (found) break;
        }
      }
    }
  } catch (err) {
    console.error("[SocketCatchup] Error handling catchup:", err);
  }
};

const checkAndEmitDoc = async (socket, Model, docId, serviceName, userId, guestId, clientRoom) => {
  try {
    const query = { _id: docId };
    if (userId) {
      query.userId = userId;
    } else if (guestId) {
      query.guestId = guestId;
    }

    const doc = await Model.findOne(query).lean();
    if (!doc) return false;

    if (doc.status === "completed" || doc.status === "failed") {
      const roomId = doc.roomId || clientRoom;

      // Build service-specific payloads
      switch (serviceName) {
        case "ttfb": {
          const payload = {
            jobId: doc._id.toString(),
            ttfbdbId: doc._id.toString(),
            roomId,
            region: doc.region,
            result: doc.result,
            status: doc.status,
            error: doc.error || null,
          };
          socket.emit("ttfb:result", payload);
          socket.emit("ttfbCompleted", payload);
          break;
        }
        case "lighthouse": {
          const payload = {
            jobId: doc._id.toString(),
            lighthousedbId: doc._id.toString(),
            roomId,
            result: doc.result,
            status: doc.status,
            error: doc.error || null,
          };
          socket.emit("lighthouse:result", payload);
          socket.emit("lighthouseCompleted", payload);
          socket.emit("Lighthouse-completed", payload);
          break;
        }
        case "dns":
        case "dnsrecord": {
          const payload = {
            jobId: doc._id.toString(),
            dnsRecordId: doc._id.toString(),
            roomId,
            result: doc.result,
            status: doc.status,
            error: doc.error || null,
          };
          socket.emit("dns:result", payload);
          if (doc.status === "completed") {
            socket.emit("dnsRecordCompleted", payload);
            socket.emit("dnsRecordCheck-completed", payload);
          } else {
            socket.emit("dnsRecordFailed", payload);
            socket.emit("dnsRecordCheck-failed", payload);
          }
          break;
        }
        case "redirect": {
          const payload = {
            jobId: doc._id.toString(),
            redirectCheckId: doc._id.toString(),
            recordId: doc._id.toString(),
            roomId,
            result: doc.result,
            status: doc.status,
            error: doc.error || null,
          };
          socket.emit("redirect:result", payload);
          if (doc.status === "completed") {
            socket.emit("redirectCheckCompleted", payload);
            socket.emit("redirect-completed", payload);
          } else {
            socket.emit("redirectCheckFailed", payload);
            socket.emit("redirect-failed", payload);
          }
          break;
        }
        case "whois": {
          const payload = {
            jobId: doc._id.toString(),
            whoisDbId: doc._id.toString(),
            recordId: doc._id.toString(),
            roomId,
            result: doc.result,
            status: doc.status,
            error: doc.error || null,
          };
          socket.emit("whois:result", payload);
          if (doc.status === "completed") {
            socket.emit("whoisLookupCompleted", payload);
            socket.emit("whoisLookup-completed", payload);
          } else {
            socket.emit("whoisLookupFailed", payload);
            socket.emit("whoisLookup-failed", payload);
          }
          break;
        }
      }
      return true;
    }
    return true; // Document found, but still processing/queued
  } catch (err) {
    console.error(`[SocketCatchup] Error checking doc ${docId} for ${serviceName}:`, err.message);
    return false;
  }
};

