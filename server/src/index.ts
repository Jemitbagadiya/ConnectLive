import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import api from './routes/api.js';
import { verifyToken } from './utils/auth.js';
import Conversation from './models/Conversation.js';
import User from './models/User.js';

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map(s => s.trim());
const io = new Server(server, { cors: { origin: allowedOrigins, methods: ['GET', 'POST'] } });
app.set('io', io);
app.use(helmet());
app.use(cors({ origin: allowedOrigins, credentials: false }));
app.use(express.json({ limit: '20kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false }));
app.get('/health', (_req, res) => res.json({ ok: true, database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));
app.use('/api', api);
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err?.message || err);
  res.status(500).json({ error: 'Server error. Check the server configuration and logs.' });
});

io.use((socket, next) => {
  try {
    const token = String(socket.handshake.auth?.token || '');
    if (!token) return next(new Error('Authentication required'));
    socket.data.userId = verifyToken(token);
    next();
  } catch { next(new Error('Invalid or expired session')); }
});

io.on('connection', async socket => {
  const userId = String(socket.data.userId);
  socket.join(`user:${userId}`);
  await User.updateOne({ _id: userId }, { $set: { lastSeen: new Date() } }).catch(() => {});
  socket.on('conversation:join', async (conversationId: string) => {
    if (typeof conversationId !== 'string' || !mongoose.isValidObjectId(conversationId)) return;
    const conversation = await Conversation.findOne({ _id: conversationId, participants: userId }).catch(() => null);
    if (conversation) socket.join(`conversation:${conversationId}`);
  });
  socket.on('typing:start', async (conversationId: string) => {
    const c = await Conversation.findOne({ _id: conversationId, participants: userId }).catch(() => null);
    if (c) socket.to(`conversation:${conversationId}`).emit('typing:update', { conversationId, userId, typing: true });
  });
  socket.on('typing:stop', async (conversationId: string) => {
    const c = await Conversation.findOne({ _id: conversationId, participants: userId }).catch(() => null);
    if (c) socket.to(`conversation:${conversationId}`).emit('typing:update', { conversationId, userId, typing: false });
  });
  socket.on('disconnect', async () => {
    const remaining = await io.in(`user:${userId}`).fetchSockets().catch(() => []);
    if (!remaining.length) await User.updateOne({ _id: userId }, { $set: { lastSeen: new Date() } }).catch(() => {});
  });
});

const port = Number(process.env.PORT || 5000);
const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("MONGODB_URI is missing in server/.env");
}
mongoose.connect(uri).then(() => {
  server.listen(port, () => console.log(`ConnectLive API listening on http://localhost:${port}`));
}).catch(err => {
  console.error('MongoDB connection failed:', err.message);
  process.exit(1);
});
