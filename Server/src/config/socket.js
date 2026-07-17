let io = null;

function initSocket(server) {
  const { Server } = require('socket.io');
  const origins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim());

  io = new Server(server, {
    cors: { origin: origins, credentials: true },
  });

  io.on('connection', (socket) => {
    const { userId, role } = socket.handshake.query || {};
    if (userId && (role === 'reservations' || role === 'admin' || role === 'sales' || role === 'Sales')) {
      socket.join(`sales-user:${userId}`);
    }
  });

  return io;
}

function getIo() {
  return io;
}

function emitSalesNotification(userId, payload) {
  if (!io) return;
  io.to(`sales-user:${userId}`).emit('sales:notification', payload);
  io.to(`sales-user:${userId}`).emit('NEW_NOTIFICATION', payload);
}

module.exports = { initSocket, getIo, emitSalesNotification };
