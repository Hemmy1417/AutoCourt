/**
 * Dev-only signing sidecar for headless browser demos.
 *
 *   node scripts/dev-signer.mjs        (serves on :3199)
 *
 * The browser pane has no wallet extension, so a demo injects an
 * EIP-1193 provider that forwards `personal_sign` here. This holds the
 * demo seed keys and nothing else; it exists purely so a headless
 * browser can walk the real wallet sign-in path instead of the app
 * growing a sign-in bypass. NEVER run it against a real key, and never
 * deploy it — it is not imported by apps/ or packages/.
 */
import { createServer } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { SELLER_PK, BUYER_PK } from "./demo-keys.mjs";

const ACCOUNTS = {
  seller: privateKeyToAccount(SELLER_PK),
  buyer: privateKeyToAccount(BUYER_PK),
};
const PORT = 3199;

createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.method !== "POST") {
    return res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({
        seller: ACCOUNTS.seller.address,
        buyer: ACCOUNTS.buyer.address,
      }));
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const { who = "seller", message } = JSON.parse(body || "{}");
    const account = ACCOUNTS[who] ?? ACCOUNTS.seller;
    const signature = await account.signMessage({ message: String(message) });
    res.writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ address: account.address, signature }));
  } catch (e) {
    res.writeHead(400, { "content-type": "application/json" })
      .end(JSON.stringify({ error: String(e?.message ?? e) }));
  }
}).listen(PORT, () => {
  console.log(`[dev-signer] :${PORT} — seller ${ACCOUNTS.seller.address}`);
  console.log(`[dev-signer] demo keys only; never deployed, never a real wallet`);
});
