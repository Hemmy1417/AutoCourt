import { prisma } from "@autocourt/db";

import {
  clientIp,
  createSession,
  sessionCookie,
  verifyWalletSignature,
} from "../../../../lib/auth.js";
import {
  ApiError,
  badRequest,
  errorResponse,
  tooMany,
} from "../../../../lib/errors.js";
import { allowBoth } from "../../../../lib/ratelimit.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Step 2: the wallet's EIP-191 signature over the issued nonce proves
 * control of the address; the account is the address.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    if (!allowBoth("auth", null, clientIp(req))) throw tooMany();
    const body = await req.json().catch(() => null);
    const address = String(body?.address ?? "");
    const nonce = String(body?.nonce ?? "");
    const signature = String(body?.signature ?? "");
    if (!ADDRESS_RE.test(address) || !nonce || !signature)
      throw badRequest("address, nonce and signature are required");
    const ok = await verifyWalletSignature(address, nonce, signature);
    if (!ok) {
      throw new ApiError(
        401,
        "BAD_SIGNATURE",
        "the signature does not prove control of this wallet (or the " +
          "nonce expired — try again)",
      );
    }
    const walletAddress = address.toLowerCase();
    const displayName = String(body?.displayName ?? "").slice(0, 60);
    const user = await prisma.user.upsert({
      where: { walletAddress },
      create: { walletAddress, displayName },
      update: displayName ? { displayName } : {},
    });
    const token = await createSession(user.id);
    return Response.json(
      {
        id: user.id,
        walletAddress: user.walletAddress,
        displayName: user.displayName,
      },
      { headers: { "set-cookie": sessionCookie(token) } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
