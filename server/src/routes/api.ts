import { Router } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { auth, signToken, type AuthRequest } from '../utils/auth.js';

const router = Router();
const safeUser = (u: any) => ({ id: String(u._id), name: u.name, email: u.email, lastSeen: u.lastSeen });

router.post('/auth/register', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Name must be 2–60 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (await User.findOne({ email })) return res.status(409).json({ error: 'An account with this email already exists.' });
    const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), connections: [] });
    return res.status(201).json({ token: signToken(String(user._id)), user: safeUser(user) });
  } catch (e: any) { if (e?.code === 11000) return res.status(409).json({ error: 'Email already registered.' }); next(e); }
});

router.post('/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Invalid email or password.' });
    return res.json({ token: signToken(String(user._id)), user: safeUser(user) });
  } catch (e) { next(e); }
});

router.get('/auth/me', auth, async (req: AuthRequest, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: safeUser(user) });
  } catch (e) { next(e); }
});

router.get('/users/search', auth, async (req: AuthRequest, res, next) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Enter an email address.' });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'No registered user found with that email.' });
    if (String(user._id) === req.userId) return res.status(400).json({ error: 'You cannot add yourself.' });
    res.json({ user: safeUser(user) });
  } catch (e) { next(e); }
});

router.post('/connections', auth, async (req: AuthRequest, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const other = await User.findOne({ email });
    if (!other) return res.status(404).json({ error: 'No registered user found with that email.' });
    if (String(other._id) === req.userId) return res.status(400).json({ error: 'You cannot add yourself.' });
    await User.updateOne({ _id: req.userId }, { $addToSet: { connections: other._id } });
    await User.updateOne({ _id: other._id }, { $addToSet: { connections: new mongoose.Types.ObjectId(req.userId) } });
    let conversation = await Conversation.findOne({ participants: { $all: [req.userId, other._id], $size: 2 } });
    if (!conversation) conversation = await Conversation.create({ participants: [req.userId, other._id] });
    res.status(201).json({ user: safeUser(other), conversationId: String(conversation._id) });
  } catch (e) { next(e); }
});

router.get('/conversations', auth, async (req: AuthRequest, res, next) => {
  try {
    const conversations = await Conversation.find({ participants: req.userId }).sort({ lastMessageAt: -1 });
    const result = await Promise.all(conversations.map(async c => {
      const otherId = c.participants.find(p => String(p) !== req.userId);
      const other = otherId ? await User.findById(otherId) : null;
      const latest = await Message.findOne({ conversationId: c._id }).sort({ createdAt: -1 });
      return { id: String(c._id), user: other ? safeUser(other) : null, lastMessage: latest?.text || c.lastMessage || '', lastMessageAt: latest?.createdAt || c.lastMessageAt };
    }));
    res.json({ conversations: result.filter(x => x.user) });
  } catch (e) { next(e); }
});

router.get('/conversations/:id/messages', auth, async (req: AuthRequest, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid conversation ID.' });
    const conversation = await Conversation.findOne({ _id: req.params.id, participants: req.userId });
    if (!conversation) return res.status(403).json({ error: 'You do not have access to this conversation.' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const query: any = {
      conversationId: conversation._id,
      deletedFor: { $ne: new mongoose.Types.ObjectId(req.userId) },
    };
    if (req.query.before) query.createdAt = { $lt: new Date(String(req.query.before)) };
    const messages = await Message.find(query).sort({ createdAt: -1 }).limit(limit);
    res.json({
  messages: messages.reverse().map(m => ({
      id: String(m._id),
      conversationId: String(m.conversationId),
      senderId: String(m.senderId),
      text: m.text,
      messageType: m.messageType || 'text',
      attachment: m.attachment || null,
      replyTo: m.replyTo ? String(m.replyTo) : null,
      reactions: (m.reactions || []).map((r: any) => ({
        userId: String(r.userId),
        emoji: r.emoji,
      })),
      readBy: m.readBy.map(String),
      isDeletedForEveryone: m.isDeletedForEveryone,
      createdAt: m.createdAt,
    })),
  });
  } catch (e) { next(e); }
});

router.post('/conversations/:id/messages', auth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const text = String(req.body.text || '').trim();
    const replyTo = req.body.replyTo;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid conversation ID.' });
    }

    if (!text || text.length > 4000) {
      return res.status(400).json({
        error: 'Message must contain 1–4000 characters.',
      });
    }

    const conversation = await Conversation.findOne({
      _id: id,
      participants: req.userId,
    });

    if (!conversation) {
      return res.status(403).json({
        error: 'You do not have access to this conversation.',
      });
    }

    // Validate the message being replied to.
    let replyMessage: any = null;

    if (replyTo !== undefined && replyTo !== null && replyTo !== '') {
      if (!mongoose.isValidObjectId(replyTo)) {
        return res.status(400).json({ error: 'Invalid reply message ID.' });
      }

      replyMessage = await Message.findOne({
        _id: replyTo,
        conversationId: conversation._id,
        isDeletedForEveryone: { $ne: true },
      });

      if (!replyMessage) {
        return res.status(404).json({
          error: 'Reply message not found.',
        });
      }
    }

    const message = await Message.create({
      conversationId: conversation._id,
      senderId: req.userId,
      text,
      messageType: 'text',
      replyTo: replyMessage?._id || null,
      readBy: [new mongoose.Types.ObjectId(req.userId)],
    });

    conversation.lastMessage = text;
    conversation.lastMessageAt = new Date();
    await conversation.save();

    const payload = {
      id: String(message._id),
      conversationId: String(message.conversationId),
      senderId: String(message.senderId),
      text: message.text,
      messageType: message.messageType,
      attachment: message.attachment || null,
      replyTo: message.replyTo ? String(message.replyTo) : null,
      reactions: [],
      readBy: message.readBy.map(String),
      isDeletedForEveryone: message.isDeletedForEveryone,
      createdAt: message.createdAt,
    };

    const io = req.app.get('io');
    io.to(`conversation:${String(conversation._id)}`).emit('message:new', payload);

    return res.status(201).json({ message: payload });
  } catch (e) {
    next(e);
  }
});

/**
 * ADD OR UPDATE AN EMOJI REACTION
 * One reaction per user per message.
 * Sending the same emoji again removes the reaction.
 */
router.patch(
  '/conversations/:id/messages/:messageId/reaction',
  auth,
  async (req: AuthRequest, res, next) => {
    try {
      const { id, messageId } = req.params;
      const emoji = typeof req.body.emoji === 'string'
        ? req.body.emoji.trim()
        : '';

      if (
        !mongoose.isValidObjectId(id) ||
        !mongoose.isValidObjectId(messageId)
      ) {
        return res.status(400).json({ error: 'Invalid ID.' });
      }

      if (!emoji || emoji.length > 16) {
        return res.status(400).json({ error: 'Invalid emoji.' });
      }

      const conversation = await Conversation.findOne({
        _id: id,
        participants: req.userId,
      });

      if (!conversation) {
        return res.status(403).json({
          error: 'You do not have access to this conversation.',
        });
      }

      const message = await Message.findOne({
        _id: messageId,
        conversationId: conversation._id,
        isDeletedForEveryone: { $ne: true },
      });

      if (!message) {
        return res.status(404).json({ error: 'Message not found.' });
      }

      const userId = String(req.userId);
      const existingIndex = (message.reactions || []).findIndex(
        (reaction: any) => String(reaction.userId) === userId
      );

      let action: 'added' | 'removed' = 'added';

      if (existingIndex >= 0) {
        const existingReaction = message.reactions[existingIndex];

        if (existingReaction.emoji === emoji) {
          message.reactions.splice(existingIndex, 1);
          action = 'removed';
        } else {
          existingReaction.emoji = emoji;
        }
      } else {
        message.reactions.push({
          userId: new mongoose.Types.ObjectId(userId),
          emoji,
        });
      }

      await message.save();

      const reactions = (message.reactions || []).map((reaction: any) => ({
        userId: String(reaction.userId),
        emoji: reaction.emoji,
      }));

      const payload = {
        conversationId: String(conversation._id),
        messageId: String(message._id),
        reactions,
      };

      const io = req.app.get('io');
      io.to(`conversation:${String(conversation._id)}`).emit(
        'message:reaction-updated',
        payload
      );

      return res.json({ ok: true, action, reactions });
    } catch (e) {
      next(e);
    }
  }
);

router.post('/conversations/:id/read', auth, async (req: AuthRequest, res, next) => {
  try {
    const conversation = await Conversation.findOne({ _id: req.params.id, participants: req.userId });
    if (!conversation) return res.status(403).json({ error: 'You do not have access to this conversation.' });
    await Message.updateMany({ conversationId: conversation._id, senderId: { $ne: req.userId }, readBy: { $ne: new mongoose.Types.ObjectId(req.userId) } }, { $addToSet: { readBy: new mongoose.Types.ObjectId(req.userId) } });
    const io = req.app.get('io');
    io.to(`conversation:${String(conversation._id)}`).emit('messages:read', { conversationId: String(conversation._id), userId: req.userId });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/**
 * DELETE FOR ME
 * Hides a message only for the authenticated user.
 */
router.patch(
  '/conversations/:id/messages/:messageId/delete-for-me',
  auth,
  async (req: AuthRequest, res, next) => {
    try {
      const { id, messageId } = req.params;

      if (
        !mongoose.isValidObjectId(id) ||
        !mongoose.isValidObjectId(messageId)
      ) {
        return res.status(400).json({ error: 'Invalid ID.' });
      }

      const conversation = await Conversation.findOne({
        _id: id,
        participants: req.userId,
      });

      if (!conversation) {
        return res.status(403).json({
          error: 'You do not have access to this conversation.',
        });
      }

      const message = await Message.findOne({
        _id: messageId,
        conversationId: conversation._id,
      });

      if (!message) {
        return res.status(404).json({ error: 'Message not found.' });
      }

      await Message.updateOne(
        { _id: message._id },
        { $addToSet: { deletedFor: new mongoose.Types.ObjectId(req.userId) } }
      );
      // Notify the authenticated user's connected clients only.
      const io = req.app.get('io');
      io.to(`user:${req.userId}`).emit('message:deleted-for-me', {
        conversationId: String(conversation._id),
        messageId: String(message._id),
        userId: req.userId,
      });

      return res.json({ ok: true, messageId: String(message._id) });
    } catch (e) {
      next(e);
    }
  }
);

/**
 * DELETE FOR EVERYONE
 * Only the original sender can delete a message for everyone.
 */
router.patch(
  '/conversations/:id/messages/:messageId/delete-for-everyone',
  auth,
  async (req: AuthRequest, res, next) => {
    try {
      const { id, messageId } = req.params;

      if (
        !mongoose.isValidObjectId(id) ||
        !mongoose.isValidObjectId(messageId)
      ) {
        return res.status(400).json({ error: 'Invalid ID.' });
      }

      const conversation = await Conversation.findOne({
        _id: id,
        participants: req.userId,
      });

      if (!conversation) {
        return res.status(403).json({
          error: 'You do not have access to this conversation.',
        });
      }

      const message = await Message.findOne({
        _id: messageId,
        conversationId: conversation._id,
      });

      if (!message) {
        return res.status(404).json({ error: 'Message not found.' });
      }

      if (String(message.senderId) !== req.userId) {
        return res.status(403).json({
          error: 'You can only delete your own message for everyone.',
        });
      }

      message.text = 'This message was deleted';
      message.isDeletedForEveryone = true;
      await message.save();

      const io = req.app.get('io');
      io.to(`conversation:${String(conversation._id)}`).emit(
        'message:deleted-for-everyone',
        {
          conversationId: String(conversation._id),
          messageId: String(message._id),
          text: 'This message was deleted',
          isDeletedForEveryone: true,
        }
      );

      return res.json({ ok: true, messageId: String(message._id) });
    } catch (e) {
      next(e);
    }
  }
);

export default router;
