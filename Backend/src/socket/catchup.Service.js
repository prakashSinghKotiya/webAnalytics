import { prisma } from "../config/db.prismaSQL.js";
import {
  resolveJobAndDbId,
  resolveServiceRecord,
} from "../Services/jobIdResolver.Service.js";

/**
 * Handles catchup requests when a client connects or reconnects.
 * Guarantees delivery even if the client connected after worker completed.
 * Fully supports both PostgreSQL database integer IDs and pg-boss UUIDs.
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
      if (!docId) continue;

      let serviceName = item.service ? item.service.toLowerCase() : null;

      // If service is unknown, resolve ID (checks pg-boss queue name if it is a UUID)
      if (!serviceName) {
        const res = await resolveJobAndDbId(docId);
        if (res.service) {
          serviceName = res.service;
        }
      }

      // Handle specific services
      if (serviceName === "ttfb") {
        await checkAndEmitTtfbDoc(socket, docId, userId, guestId, clientRoom);
        continue;
      }
      if (serviceName === "dns" || serviceName === "dnsrecord") {
        await checkAndEmitDnsDoc(socket, docId, userId, guestId, clientRoom);
        continue;
      }
      if (serviceName === "whois") {
        await checkAndEmitWhoisDoc(socket, docId, userId, guestId, clientRoom);
        continue;
      }
      if (serviceName === "redirect" || serviceName === "redirects") {
        await checkAndEmitRedirectDoc(socket, docId, userId, guestId, clientRoom);
        continue;
      }
      if (serviceName === "lighthouse") {
        await checkAndEmitLighthouseDoc(socket, docId, userId, guestId, clientRoom);
        continue;
      }

      // Fallback if service still cannot be determined: try services sequentially
      const { dbId } = await resolveJobAndDbId(docId);
      if (dbId && !Number.isNaN(dbId)) {
        if (await checkAndEmitTtfbDoc(socket, dbId, userId, guestId, clientRoom)) continue;
        if (await checkAndEmitDnsDoc(socket, dbId, userId, guestId, clientRoom)) continue;
        if (await checkAndEmitWhoisDoc(socket, dbId, userId, guestId, clientRoom)) continue;
        if (await checkAndEmitRedirectDoc(socket, dbId, userId, guestId, clientRoom)) continue;
        if (await checkAndEmitLighthouseDoc(socket, dbId, userId, guestId, clientRoom)) continue;
      }
    }
  } catch (err) {
    console.error("[SocketCatchup] Error handling catchup:", err);
  }
};

const checkAndEmitTtfbDoc = async (socket, docId, userId, guestId, clientRoom) => {
  try {
    const { doc } = await resolveServiceRecord({
      service: "ttfb",
      id: docId,
      userId,
      guestId,
    });
    if (!doc) return false;

    if (doc.status === "completed" || doc.status === "failed") {
      const roomId = doc.roomId || clientRoom;
      const payload = {
        jobId: `ttfb-${doc.id}`,
        ttfbdbId: doc.id.toString(),
        roomId,
        region: doc.region,
        result: doc.result,
        status: doc.status,
        error: doc.error || null,
      };
      socket.emit("ttfb:result", payload);
      socket.emit("ttfbCompleted", payload);
      return true;
    }
    return true;
  } catch (err) {
    console.error(`[SocketCatchup] Error checking TTFB doc ${docId}:`, err.message);
    return false;
  }
};

const checkAndEmitDnsDoc = async (socket, docId, userId, guestId, clientRoom) => {
  try {
    const { doc } = await resolveServiceRecord({
      service: "dns",
      id: docId,
      userId,
      guestId,
    });
    if (!doc) return false;

    if (doc.status === "completed" || doc.status === "failed") {
      const roomId = doc.roomId || clientRoom;
      const payload = {
        jobId: doc.id.toString(),
        dnsRecordId: doc.id.toString(),
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
      return true;
    }
    return true;
  } catch (err) {
    console.error(`[SocketCatchup] Error checking DNS doc ${docId}:`, err.message);
    return false;
  }
};

const checkAndEmitWhoisDoc = async (socket, docId, userId, guestId, clientRoom) => {
  try {
    const { doc } = await resolveServiceRecord({
      service: "whois",
      id: docId,
      userId,
      guestId,
    });
    if (!doc) return false;

    if (doc.status === "completed" || doc.status === "failed") {
      const roomId = doc.roomId || clientRoom;
      const payload = {
        jobId: doc.id.toString(),
        whoisDbId: doc.id.toString(),
        recordId: doc.id.toString(),
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
      return true;
    }
    return true;
  } catch (err) {
    console.error(`[SocketCatchup] Error checking WHOIS doc ${docId}:`, err.message);
    return false;
  }
};

const checkAndEmitRedirectDoc = async (socket, docId, userId, guestId, clientRoom) => {
  try {
    const { doc } = await resolveServiceRecord({
      service: "redirect",
      id: docId,
      userId,
      guestId,
    });
    if (!doc) return false;

    if (doc.status === "completed" || doc.status === "failed") {
      const roomId = doc.roomId || clientRoom;
      const payload = {
        jobId: doc.id.toString(),
        redirectCheckId: doc.id.toString(),
        recordId: doc.id.toString(),
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
      return true;
    }
    return true;
  } catch (err) {
    console.error(`[SocketCatchup] Error checking Redirect doc ${docId}:`, err.message);
    return false;
  }
};

const checkAndEmitLighthouseDoc = async (socket, docId, userId, guestId, clientRoom) => {
  try {
    const { doc } = await resolveServiceRecord({
      service: "lighthouse",
      id: docId,
      userId,
      guestId,
    });
    if (!doc) return false;

    if (doc.status === "completed" || doc.status === "failed") {
      const roomId = doc.roomId || clientRoom;
      const payload = {
        jobId: doc.id.toString(),
        lighthousedbId: doc.id.toString(),
        roomId,
        result: doc.result,
        status: doc.status,
        error: doc.error || null,
      };
      socket.emit("lighthouse:result", payload);
      socket.emit("lighthouseCompleted", payload);
      socket.emit("Lighthouse-completed", payload);
      return true;
    }
    return true;
  } catch (err) {
    console.error(`[SocketCatchup] Error checking Lighthouse doc ${docId}:`, err.message);
    return false;
  }
};
