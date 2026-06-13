import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, IUser } from '../../models/User.js';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/errorHandler.js';
import { ensureWallet, grantCredits } from '../billing/wallet.service.js';
import { getSettings } from '../../models/Setting.js';

export async function signup(name: string, email: string, password: string): Promise<{ token: string; user: Partial<IUser> }> {
  const existing = await User.findOne({ email });
  if (existing) throw new AppError(409, 'Email already registered');

  if (password.length < 8) throw new AppError(400, 'Password must be at least 8 characters');

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ name, email, passwordHash });

  // Every user gets a wallet at signup, plus a one-time free promo grant so they
  // can try a few interviews before paying. The amount is configurable (settings
  // doc) and can be changed without a redeploy. Promo lands in the top-up bucket
  // so it persists (doesn't reset on a subscription cycle).
  await ensureWallet(user.id).catch((e) => console.error('wallet init failed:', e));
  try {
    const settings = await getSettings();
    if (settings.promoEnabled && settings.signupPromoCredits > 0) {
      await grantCredits({
        userId: user.id, type: 'promo_grant', amount: settings.signupPromoCredits,
        idempotencyKey: `promo:${user.id}`, reason: `signup promo (${settings.signupPromoCredits} free min)`, bucket: 'topup',
      });
    }
  } catch (e) {
    console.error('signup promo grant failed:', e);
  }

  const token = signToken(user.id);
  return { token, user: sanitize(user) };
}

export async function login(email: string, password: string): Promise<{ token: string; user: Partial<IUser> }> {
  const user = await User.findOne({ email });
  if (!user) throw new AppError(401, 'Invalid email or password');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new AppError(401, 'Invalid email or password');

  const token = signToken(user.id);
  return { token, user: sanitize(user) };
}

export async function getMe(userId: string): Promise<Partial<IUser>> {
  const user = await User.findById(userId).select('-passwordHash');
  if (!user) throw new AppError(404, 'User not found');
  return sanitize(user);
}

function signToken(userId: string): string {
  return jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

function sanitize(user: IUser): Partial<IUser> {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    preferences: user.preferences,
    createdAt: user.createdAt,
  };
}
