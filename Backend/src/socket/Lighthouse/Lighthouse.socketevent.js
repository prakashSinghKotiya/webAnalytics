export const LighthouseConnection = (io, socket) => {
  socket.on("Lighthouse-job", ({ roomId }) => {
    if (roomId) {
      socket.join(roomId);
    }
  });

  socket.on("lighthouse-job", ({ roomId }) => {
    if (roomId) {
      socket.join(roomId);
    }
  });
};