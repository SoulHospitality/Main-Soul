let io = null;

const NOTIF_ROLES = new Set([
  'reservations',
  'reservations_web',
  'reservations_manual',
  'reservations_manager',
  'admin',
  'finance',
  'finance_manager',
  'sales',
  'Sales',
]);

function initSocket(server) {
  const { Server } = require('socket.io');
  const jwt = require('jsonwebtoken');
  const origins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  io = new Server(server, {
    cors: {
      origin: origins.includes('*') ? true : origins,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (String(socket.handshake.headers?.authorization || '').startsWith('Bearer ')
          ? String(socket.handshake.headers.authorization).slice(7)
          : null) ||
        socket.handshake.query?.token;
      if (!token || !process.env.JWT_SECRET) {
        return next(new Error('Unauthorized'));
      }
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.kind && payload.kind !== 'staff' && payload.kind !== 'sales') {
        return next(new Error('Unauthorized'));
      }
      socket.staff = {
        id: payload.sub || payload.id,
        role: payload.role,
      };
      if (!socket.staff.id) return next(new Error('Unauthorized'));
      return next();
    } catch {
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.staff?.id;
    const role = socket.staff?.role;
    if (userId && NOTIF_ROLES.has(role)) {
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
