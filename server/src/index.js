import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import http from 'node:http';
import mime from 'mime-types';

import db from './db.js';
import {
  registerUser,
  loginUser,
  getUserById,
  getUsersByQuery,
  createDirectConversation,
  getConversationsForUser,
  getConversationMessages,
  addMessage,
  markMessageRead,
  createAttachmentRecord,
  getAttachmentById,
  createCallSession,
  getCallSession,
  updateCallSession,
  verifyToken,
} from './lib.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const PORT = Number(process.env.PORT || 4000);
const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_LIMIT_MB || 25) * 1024 * 1024;
const uploadRoot = path.resolve(process.cwd(), 'uploads');
const pendingUploads = new Map();
fs.mkdirSync(uploadRoot, { recursive: true });

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.CLIENT_URL || true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
const messageLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
app.use('/api/', authLimiter);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => {
    const safeName = `${Date.now()}-${randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/', 'video/', 'application/pdf', 'text/plain', 'application/zip'];
    const isAllowed = allowed.some((type) => file.mimetype.startsWith(type) || file.mimetype === type);
    if (!isAllowed) {
      return cb(new Error('Unsupported file type.'));
    }
    cb(null, true);
  },
});

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Session expired or invalid.' });
  }

  req.user = user;
  next();
}

function attachUserInfo(rows) {
  return rows.map((item) => ({
    ...item,
    user: item.user ? { ...item.user } : undefined,
  }));
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'messaging-server' });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const user = await registerUser({
      email: req.body.email,
      password: req.body.password,
      displayName: req.body.displayName,
    });
    res.status(201).json({ user });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const result = await loginUser({ email: req.body.email, password: req.body.password });
    res.json(result);
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: getUserById(req.user.id) });
});

app.get('/api/users/search', authMiddleware, (req, res) => {
  const query = req.query.q || '';
  res.json({ users: getUsersByQuery(query) });
});

app.get('/api/users/:id', authMiddleware, (req, res) => {
  res.json({ user: getUserById(req.params.id) });
});

app.get('/api/conversations', authMiddleware, (req, res) => {
  const rows = getConversationsForUser(req.user.id);
  res.json({ conversations: rows });
});

app.post('/api/conversations', authMiddleware, (req, res) => {
  try {
    const otherUserId = req.body.otherUserId;
    if (!otherUserId) {
      return res.status(400).json({ error: 'otherUserId is required.' });
    }

    if (otherUserId === req.user.id) {
      return res.status(400).json({ error: 'You cannot start a conversation with yourself.' });
    }

    const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(otherUserId);
    if (!targetUser) {
      return res.status(404).json({ error: 'The selected user was not found.' });
    }

    const existing = db.prepare(`
      SELECT c.id
      FROM conversations c
      JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
      JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
      WHERE c.type = 'direct'
      LIMIT 1
    `).get(req.user.id, otherUserId);

    if (existing) {
      return res.json({ conversation: { id: existing.id } });
    }

    const conversation = createDirectConversation({ userId: req.user.id, otherUserId });
    res.status(201).json({ conversation });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/conversations/:id/messages', authMiddleware, (req, res) => {
  const limit = Number(req.query.limit || 50);
  const offset = Number(req.query.offset || 0);
  const messages = getConversationMessages(req.params.id, req.user.id, { limit, offset });
  res.json({ messages });
});

app.post('/api/conversations/:id/messages', authMiddleware, messageLimiter, (req, res) => {
  try {
    const payload = req.body || {};
    const uploadIds = payload.uploadIds || [];
    if (!Array.isArray(uploadIds)) {
      return res.status(400).json({ error: 'uploadIds must be an array.' });
    }

    const attachments = uploadIds.map((uploadId) => {
      const pending = pendingUploads.get(uploadId);
      if (!pending || pending.userId !== req.user.id) {
        throw new Error('An uploaded file is missing or does not belong to this account.');
      }

      return pending.attachment;
    });

    const message = addMessage({
      conversationId: req.params.id,
      senderId: req.user.id,
      text: payload.text || '',
      type: payload.type || 'text',
      attachments,
    });

    uploadIds.forEach((uploadId) => pendingUploads.delete(uploadId));

    io.to(`conversation:${req.params.id}`).emit('message:new', {
      ...message,
      sender: getUserById(req.user.id),
    });

    return res.status(201).json({ message });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/messages/:id/read', authMiddleware, (req, res) => {
  const result = markMessageRead({ userId: req.user.id, messageId: req.params.id });
  res.json({ ok: Boolean(result) });
});

app.post('/api/uploads', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const uploadId = randomUUID();
  const attachment = {
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    storagePath: path.relative(process.cwd(), req.file.path),
  };
  pendingUploads.set(uploadId, { userId: req.user.id, attachment });

  res.status(201).json({ attachment: { uploadId, ...attachment } });
});

app.get('/api/attachments/:id', authMiddleware, (req, res) => {
  const attachment = db.prepare(`
    SELECT a.*, m.conversation_id, m.sender_id
    FROM attachments a
    JOIN messages m ON m.id = a.message_id
    WHERE a.id = ?
  `).get(req.params.id);

  if (!attachment) {
    return res.status(404).json({ error: 'Attachment not found.' });
  }

  const hasAccess = db.prepare(`
    SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?
  `).get(attachment.conversation_id, req.user.id);

  if (!hasAccess) {
    return res.status(403).json({ error: 'You do not have access to this file.' });
  }

  const resolved = path.resolve(process.cwd(), attachment.storage_path);
  const relativePath = path.relative(uploadRoot, resolved);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return res.status(400).json({ error: 'Invalid attachment path.' });
  }

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'File no longer exists.' });
  }

  const mimeType = mime.lookup(attachment.file_name) || attachment.mime_type || 'application/octet-stream';
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.file_name)}"`);
  res.sendFile(resolved);
});

app.post('/api/calls/start', authMiddleware, (req, res) => {
  const call = createCallSession({ callerId: req.user.id, calleeId: req.body.calleeId, type: req.body.type || 'audio' });
  io.to(`user:${req.body.calleeId}`).emit('call:incoming', {
    callId: call.id,
    callerId: req.user.id,
    type: call.type,
  });
  res.status(201).json({ call });
});

app.post('/api/calls/:id/answer', authMiddleware, (req, res) => {
  const call = getCallSession(req.params.id);
  if (!call) {
    return res.status(404).json({ error: 'Call session not found.' });
  }

  const updated = updateCallSession(req.params.id, { status: req.body.accepted ? 'connected' : 'rejected' });
  io.to(`user:${call.caller_id}`).emit('call:status', { callId: call.id, status: updated.status });
  return res.json({ call: updated });
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) {
    return next(new Error('Authentication required.'));
  }

  const user = verifyToken(token);
  if (!user) {
    return next(new Error('Invalid session.'));
  }

  socket.user = user;
  next();
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  socket.join(`user:${userId}`);
  socket.emit('presence:online', { userId });
  socket.broadcast.emit('presence:update', { userId, online: true });

  socket.on('conversation:join', ({ conversationId }) => {
    socket.join(`conversation:${conversationId}`);
  });

  socket.on('typing:start', ({ conversationId }) => {
    socket.to(`conversation:${conversationId}`).emit('typing:start', { userId, conversationId });
  });

  socket.on('typing:stop', ({ conversationId }) => {
    socket.to(`conversation:${conversationId}`).emit('typing:stop', { userId, conversationId });
  });

  socket.on('call:offer', ({ toUserId, offer }) => {
    io.to(`user:${toUserId}`).emit('call:offer', { fromUserId: userId, offer });
  });

  socket.on('call:answer', ({ toUserId, answer }) => {
    io.to(`user:${toUserId}`).emit('call:answer', { fromUserId: userId, answer });
  });

  socket.on('call:ice-candidate', ({ toUserId, candidate }) => {
    io.to(`user:${toUserId}`).emit('call:ice-candidate', { fromUserId: userId, candidate });
  });

  socket.on('disconnect', () => {
    socket.broadcast.emit('presence:update', { userId, online: false });
  });
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File exceeds the ${process.env.UPLOAD_LIMIT_MB || 25}MB limit.` });
  }

  if (error.message === 'Unsupported file type.') {
    return res.status(400).json({ error: error.message });
  }

  console.error(error);
  return res.status(500).json({ error: 'An unexpected server error occurred.' });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Change PORT in .env or stop the current process and try again.`);
    process.exit(1);
  }

  throw error;
});

server.listen(PORT, () => {
  console.log(`Messaging server listening on http://localhost:${PORT}`);
});
