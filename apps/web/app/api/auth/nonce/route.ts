import { clientIp, issueNonce, signInMessage } from "../../../../lib/auth.js";
import { badRequest, errorResponse, tooMany } from "../../../../lib/errors.js";
import { allowBoth } from "../../../../lib/ratelimit.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Step 1 of wallet sign-in: a short-lived nonce bound to the address. */
export async function POST(req: Request): Promise<Response> {
  try {
    if (!allowBoth("auth", null, clientIp(req))) throw tooMany();
    const body = await req.json().catch(() => null);
    const address = String(body?.address ?? "");
    if (!ADDRESS_RE.test(address))
      throw badRequest("a 0x wallet address is required");
    const nonce = issueNonce(address);
    return Response.json({
      nonce,
      message: signInMessage(address, nonce),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
