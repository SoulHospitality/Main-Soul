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
    if (
      userId &&
      (role === 'reservations' ||
        role === 'reservations_web' ||
        role === 'reservations_manual' ||
        role === 'admin' ||
        role === 'finance' ||
        role === 'sales' ||
        role === 'Sales')
    ) {
      socket.join(`sales-user:${userId}`);
    }
  });

  return io;
}

function getIo() {
  return io;
}

function emitSalesNotification(userId, payload) {
  if (!io || !userId) return;
  const room = `sales-user:${userId}`;
  io.to(room).emit('sales:notification', payload);
  io.to(room).emit('pms:notification', payload);
  io.to(room).emit('NEW_NOTIFICATION', payload);
}

module.exports = { initSocket, getIo, emitSalesNotification };
