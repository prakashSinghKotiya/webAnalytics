
export const sendTtfbResult = (io, socket) => {
  socket.on("ttfb-job", ({ roomId }) => {
    if (roomId) {
      socket.join(roomId);
    }
  });

  socket.on("ttfb-job-global", ({ roomId }) => {
    if (roomId) {
      socket.join(roomId);
    }
  });
};

