/**
 * Wallet-based auth: an account IS an address. Sign-in is an EIP-191
 * personal_sign over a server-issued nonce; sessions are signed HttpOnly
 * cookies backed by DB rows. No vendor, no password, no secret in the
 * client. Identity stays self-attested (anyone can mint wallets) — the
 * contract's same-account rules and the VERIFIED-requires-INDEPENDENT
 * floor are what make a second wallet worthless, and the docs say so.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { verifyMessage } from "viem";
import { prisma } from "@autocourt/db";

import { unauthorized } from "./errors.js";

const SESSION_COOKIE = "ac_session";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET must be set (≥16 chars)");
  }
  return s;
}

function hmac(data: string, key = secret()): string {
  return createHmac("sha256", key).update(data).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/* ── nonce (stateless, HMAC-sealed, short-lived) ─────────────────────── */

export function issueNonce(address: string): string {
  const body = `${address.toLowerCase()}.${Date.now()}.${randomBytes(8).toString("base64url")}`;
  return `${Buffer.from(body).toString("base64url")}.${hmac(body)}`;
}

export function nonceAddress(nonce: string): string | null {
  const dot = nonce.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = Buffer.from(nonce.slice(0, dot), "base64url").toString();
  if (!safeEqual(nonce.slice(dot + 1), hmac(body))) return null;
  const [address, ts] = body.split(".");
  if (!address || !ts) return null;
  if (Date.now() - Number(ts) > NONCE_TTL_MS) return null;
  return address;
}

/** The exact text the wallet signs — shown verbatim in the wallet UI. */
export function signInMessage(address: string, nonce: string): string {
  return (
    "AutoCourt sign-in\n\n" +
    `wallet: ${address.toLowerCase()}\n` +
    `nonce: ${nonce}\n\n` +
    "Signing proves control of this wallet. No transaction is sent and " +
    "no fee is paid."
  );
}

export async function verifyWalletSignature(
  address: string,
  nonce: string,
  signature: string,
): Promise<boolean> {
  const bound = nonceAddress(nonce);
  if (!bound || bound !== address.toLowerCase()) return false;
  try {
    return await verifyMessage({
      address: address as `0x${string}`,
      message: signInMessage(address, nonce),
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

/* ── sessions ────────────────────────────────────────────────────────── */

export function signToken(sessionId: string, key = secret()): string {
  return `${sessionId}.${hmac(sessionId, key)}`;
}

export function verifyToken(token: string, key = secret()): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const sessionId = token.slice(0, dot);
  return safeEqual(token.slice(dot + 1), hmac(sessionId, key))
    ? sessionId
    : null;
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
  walletAddress: string;
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
    walletAddress: session.user.walletAddress,
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
