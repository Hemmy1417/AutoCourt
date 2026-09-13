/**
 * Self-contained auth: argon2id password hashes, signed HttpOnly session
 * cookies backed by DB Session rows. No vendor, no secret in the client.
 * Account identity is app-attested — the trust docs say so plainly — and
 * the contract's same-account rules are what make a second inbox
 * worthless, not this file.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { prisma } from "@autocourt/db";

import { unauthorized } from "./errors.js";

const SESSION_COOKIE = "ac_session";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET must be set (≥16 chars)");
  }
  return s;
}

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(
  stored: string,
  password: string,
): Promise<boolean> {
  try {
    return await argonVerify(stored, password);
  } catch {
    return false;
  }
}

export function signToken(sessionId: string, key = secret()): string {
  const mac = createHmac("sha256", key).update(sessionId).digest("base64url");
  return `${sessionId}.${mac}`;
}

export function verifyToken(token: string, key = secret()): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const sessionId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac("sha256", key)
    .update(sessionId)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return sessionId;
}

export async function createSession(userId: string): Promise<string> {
  const id = randomBytes(24).toString("base64url");
  await prisma.session.create({
    data: {
      id,
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return signToken(id);
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
    SESSION_TTL_MS / 1000
  }${secure}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export interface AuthedUser {
  id: string;
  email: string;
  displayName: string;
  sessionId: string;
}

export async function userFromRequest(req: Request): Promise<AuthedUser | null> {
  const cookies = req.headers.get("cookie") ?? "";
  const m = cookies.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!m || !m[1]) return null;
  const sessionId = verifyToken(decodeURIComponent(m[1]));
  if (!sessionId) return null;
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.displayName,
    sessionId,
  };
}

export async function requireUser(req: Request): Promise<AuthedUser> {
  const user = await userFromRequest(req);
  if (!user) throw unauthorized();
  return user;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? "local").trim();
}
