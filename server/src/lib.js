import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import db from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    username: user.username,
    avatarUrl: user.avatar_url,
    isOnline: Boolean(user.is_online),
    lastSeen: user.last_seen,
    createdAt: user.created_at,
  };
}

export async function registerUser({ email, password, displayName }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const trimmedName = String(displayName || '').trim();

  if (!normalizedEmail || !password || !trimmedName) {
    throw new Error('Email, password, and display name are required.');
  }

  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters long.');
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    throw new Error('Email already registered.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = randomUUID();

  const insert = db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, username, avatar_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `);

  insert.run(userId, normalizedEmail, passwordHash, trimmedName, trimmedName.toLowerCase().replace(/\s+/g, '.'), null);

  return sanitizeUser(
    db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  );
}

export async function loginUser({ email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);

  if (!user) {
    throw new Error('Invalid credentials.');
  }

  const valid = await bcrypt.compare(String(password || ''), user.password_hash);
  if (!valid) {
    throw new Error('Invalid credentials.');
  }

  const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, user.id, token, expiresAt);

  return {
    token,
    user: sanitizeUser(user),
  };
}

export function getUserById(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return sanitizeUser(user);
}

export function getUserByEmail(email) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  return sanitizeUser(user);
}

export function getUsersByQuery(query) {
  const q = String(query || '').trim();
  const rows = db.prepare(`
    SELECT * FROM users
    WHERE lower(display_name) LIKE lower(?) OR lower(email) LIKE lower(?)
    ORDER BY display_name ASC
    LIMIT 25
  `).all(`%${q}%`, `%${q}%`);

  return rows.map(sanitizeUser);
}

export function createDirectConversation({ userId, otherUserId }) {
  if (!userId || !otherUserId) {
    throw new Error('Both users are required to create a conversation.');
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE id = ?').get(otherUserId);
  if (!existingUser) {
    throw new Error('The other user does not exist.');
  }

  const conversationId = randomUUID();
  const memberIds = [userId, otherUserId];

  db.prepare(
    `INSERT INTO conversations (id, type, created_by, created_at, updated_at) VALUES (?, 'direct', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
  ).run(conversationId, userId);

  for (const memberId of memberIds) {
    db.prepare(`
      INSERT OR IGNORE INTO conversation_members (id, conversation_id, user_id)
      VALUES (?, ?, ?)
    `).run(randomUUID(), conversationId, memberId);
  }

  return { id: conversationId };
}

export function getConversationForUser(userId) {
  return db.prepare(`
    SELECT c.*, cm.user_id AS member_id
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE cm.user_id = ?
    ORDER BY c.updated_at DESC
  `).all(userId);
}

export function getConversationsForUser(userId) {
  const conversations = db.prepare(`
    SELECT c.id, c.type, c.created_at, c.updated_at,
      (
        SELECT m.content FROM messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) AS last_message,
      (
        SELECT COUNT(*) FROM messages m
        LEFT JOIN message_receipts mr ON mr.message_id = m.id AND mr.user_id = ?
        WHERE m.conversation_id = c.id AND m.sender_id != ? AND mr.id IS NULL
      ) AS unread_count
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE cm.user_id = ?
    ORDER BY c.updated_at DESC
  `).all(userId, userId, userId);

  return conversations.map((conversation) => ({
    ...conversation,
    lastMessage: conversation.last_message,
    unreadCount: Number(conversation.unread_count || 0),
  }));
}

export function ensureConversationAccess(userId, conversationId) {
  const row = db.prepare(`
    SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?
  `).get(conversationId, userId);

  if (!row) {
    throw new Error('You do not have access to this conversation.');
  }
}

export function addMessage({ conversationId, senderId, text = '', type = 'text', attachments = [] }) {
  ensureConversationAccess(senderId, conversationId);

  const messageId = randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_id, type, content, created_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'sent')
  `).run(messageId, conversationId, senderId, type, text, createdAt);

  if (Array.isArray(attachments) && attachments.length > 0) {
    for (const attachment of attachments) {
      const attachmentId = randomUUID();
      db.prepare(`
        INSERT INTO attachments (id, message_id, file_name, mime_type, size, storage_path, url, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        attachmentId,
        messageId,
        attachment.fileName || 'file',
        attachment.mimeType || 'application/octet-stream',
        Number(attachment.size || 0),
        attachment.storagePath || '',
        attachment.url || '',
        senderId,
        createdAt
      );
    }
  }

  db.prepare(`
    UPDATE conversations SET updated_at = ? WHERE id = ?
  `).run(createdAt, conversationId);

  return {
    id: messageId,
    conversationId,
    senderId,
    type,
    content: text,
    createdAt,
    status: 'sent',
    attachments: attachments.map((attachment) => ({
      id: randomUUID(),
      fileName: attachment.fileName || 'file',
      mimeType: attachment.mimeType || 'application/octet-stream',
      size: Number(attachment.size || 0),
      url: attachment.url || '',
      storagePath: attachment.storagePath || '',
    })),
  };
}

export function getConversationMessages(conversationId, userId, { limit = 30, offset = 0 } = {}) {
  ensureConversationAccess(userId, conversationId);

  const rows = db.prepare(`
    SELECT m.*, u.display_name as sender_name, u.avatar_url as sender_avatar
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ?
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `).all(conversationId, Number(limit), Number(offset));

  return rows.reverse().map((message) => ({
    id: message.id,
    conversationId: message.conversation_id,
    senderId: message.sender_id,
    senderName: message.sender_name,
    senderAvatar: message.sender_avatar,
    type: message.type,
    content: message.content,
    createdAt: message.created_at,
    status: message.status,
    attachments: db.prepare('SELECT * FROM attachments WHERE message_id = ?').all(message.id),
  }));
}

export function getConversationMembers(conversationId) {
  return db.prepare(`
    SELECT u.id, u.email, u.display_name, u.avatar_url, u.is_online
    FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ?
  `).all(conversationId);
}

export function markMessageRead({ userId, messageId }) {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!message) return null;

  ensureConversationAccess(userId, message.conversation_id);

  db.prepare(`
    INSERT OR REPLACE INTO message_receipts (id, message_id, user_id, read_at, delivered_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), messageId, userId, new Date().toISOString(), new Date().toISOString());

  return { ok: true };
}

export function searchConversations(userId, query) {
  const q = `%${String(query || '').trim()}%`;
  return db.prepare(`
    SELECT DISTINCT c.*
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    LEFT JOIN messages m ON m.conversation_id = c.id
    WHERE cm.user_id = ? AND (
      lower(m.content) LIKE lower(?)
      OR c.id LIKE lower(?)
    )
    ORDER BY c.updated_at DESC
    LIMIT 20
  `).all(userId, q, q);
}

export function createAttachmentRecord({ messageId, fileName, mimeType, size, storagePath, uploadedBy, url }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO attachments (id, message_id, file_name, mime_type, size, storage_path, url, uploaded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `).run(id, messageId, fileName, mimeType, size, storagePath, url, uploadedBy);
  return { id, fileName, mimeType, size, storagePath, url };
}

export function getAttachmentById(id) {
  return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
}

export function createCallSession({ callerId, calleeId, type }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO call_sessions (id, caller_id, callee_id, type, status, started_at)
    VALUES (?, ?, ?, ?, 'ringing', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `).run(id, callerId, calleeId, type);
  return { id, callerId, calleeId, type, status: 'ringing' };
}

export function getCallSession(id) {
  return db.prepare('SELECT * FROM call_sessions WHERE id = ?').get(id);
}

export function updateCallSession(id, patch) {
  const current = getCallSession(id);
  if (!current) return null;

  const update = { ...current, ...patch };
  db.prepare(`
    UPDATE call_sessions SET status = ?, signaling_payload = ?, ended_at = ? WHERE id = ?
  `).run(update.status, update.signaling_payload ?? current.signaling_payload, update.ended_at ?? current.ended_at, id);

  return update;
}

export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = getUserById(payload.sub);
    return user;
  } catch {
    return null;
  }
}
