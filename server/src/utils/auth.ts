import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

export type AuthRequest = Request & { userId?: string };
export function signToken(userId: string) {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'development-only-change-me', { expiresIn: '7d' });
}
export function verifyToken(token: string): string {
  const secret = process.env.JWT_SECRET || 'development-only-change-me';
  const payload = jwt.verify(token, secret) as { userId: string };
  return payload.userId;
}
export function auth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Please log in.' });
  try { req.userId = verifyToken(token); next(); }
  catch { return res.status(401).json({ error: 'Session expired. Please log in again.' }); }
}
