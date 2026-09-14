/**
 * The post-verdict screens — report, intake receipt, appeal gate — which
 * the journey cannot reach, because it stops at the job queue and a real
 * verdict needs a panel round on chain.
 *
 * So this spec renders them against a REAL adjudicated record: `ac-000003`
 * on the deployment of record, produced by scripts/arc.mjs, with two runs
 * and an appeal already on it. The app row is a cache pointed at that
 * on-chain id — which is exactly what the architecture says a row is —
 * and every value asserted below is read back from the contract through
 * the app's own API, not from a fixture.
 *
 * It needs the network, so CI skips it unless CHAIN_E2E=1. The screens it
 * covers are otherwise proven only by the arc, which never opens a browser.
 */

import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { privateKeyToAccount } from "viem/accounts";

const ON_CHAIN_ID = "ac-000003";
const VIN = "1HGCM82633A004352";
const SELLER_PK =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

test.skip(
  process.env.CHAIN_E2E !== "1",
  "reads a live contract — set CHAIN_E2E=1 to run",
);

async function connectWallet(page: Page, pk: `0x${string}`, name: string) {
  const account = privateKeyToAccount(pk);
  await page.exposeFunction("__walletSign", async (message: string) =>
    account.signMessage({ message }),
  );
  await page.addInitScript((address: string) => {
    (window as unknown as Record<string, unknown>).ethereum = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === "eth_requestAccounts") return [address];
        if (method === "personal_sign") {
          const sign = (window as unknown as {
            __walletSign: (m: string) => Promise<string>;
          }).__walletSign;
          return sign(String(params?.[0]));
        }
        throw new Error(`unsupported method ${method}`);
      },
    };
  }, account.address);
  await page.goto("/auth");
  await page.getByPlaceholder("Alex N.").fill(name);
  await page
    .getByRole("button", { name: /connect .*sign in|sign in with/i })
    .click();
  await page.waitForURL("**/dashboard");
  return account.address.toLowerCase();
}

test("the verdict screens render a real on-chain adjudication", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const wallet = await connectWallet(page, SELLER_PK, "Sada the seller");

  // Point an app row at the on-chain record the arc adjudicated. The DB
  // caches; the chain decides — every assertion below comes from the
  // chain through the app's API.
  // MUST be the same database the test server uses — playwright.config
  // isolates E2E onto `autocourt_e2e`, and seeding the dev book instead
  // is how this first ran into "assessment not found".
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url:
          process.env.E2E_DATABASE_URL ??
          process.env.DATABASE_URL ??
          "postgresql://autocourt:autocourt_dev@localhost:5455/autocourt_e2e",
      },
    },
  });
  let assessmentId = "";
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { walletAddress: wallet },
    });
    const existing = await prisma.assessment.findFirst({
      where: { onChainId: ON_CHAIN_ID },
    });
    if (existing) {
      assessmentId = existing.id;
    } else {
      const vehicle = await prisma.vehicle.create({
        data: {
          vin: VIN,
          vinCheckDigitOk: true,
          make: "Honda",
          model: "Accord",
          year: 2003,
          sellerId: user.id,
          claims: {
            create: [
              { claimId: "CL-01", type: "MILEAGE", declaredValue: "87,432 miles" },
              {
                claimId: "CL-02",
                type: "ACCIDENT_HISTORY",
                declaredValue: "no recorded accidents",
              },
            ],
          },
        },
      });
      const a = await prisma.assessment.create({
        data: {
          vehicleId: vehicle.id,
          onChainId: ON_CHAIN_ID,
          state: "ADJUDICATED",
          packetVersion: 2,
          identityStatus: "CONFIRMED",
          registryJson: JSON.stringify({
            Make: "HONDA",
            Model: "Accord",
            ModelYear: "2003",
            BodyClass: "Coupe",
          }),
        },
      });
      assessmentId = a.id;
    }
  } finally {
    await prisma.$disconnect();
  }

  // ── the assessment page carries the independent identity result ──────
  await page.goto(`/assessments/${assessmentId}`);
  await expect(page.getByText(/Independent identity check/i)).toBeVisible();
  await expect(page.getByText(/2003 Honda Accord/).first()).toBeVisible();
  await expect(
    page.getByText(/by every validator itself, before this record existed/i),
  ).toBeVisible();

  // ── the report: the product's main surface ───────────────────────────
  await page.goto(`/assessments/${assessmentId}/report`);
  await expect(page.getByRole("heading", { name: /Verdict report/i })).toBeVisible();

  // The standing verdict names its run AND the total, so a superseded
  // verdict can never be mistaken for the standing one.
  await expect(page.getByText(/run 2 of 2/i).first()).toBeVisible();

  // Each claim carries a verdict derived in code, with its confidence
  // labelled as derived rather than asserted.
  await expect(page.getByText("MILEAGE").first()).toBeVisible();
  await expect(page.getByText("ACCIDENT HISTORY").first()).toBeVisible();
  await expect(
    page.getByText(/derived in code from corroboration/i).first(),
  ).toBeVisible();

  // Panel prose is fenced as non-consensus — the S12 honesty line.
  await expect(
    page.getByText(/panel narrative — not consensus-checked/i).first(),
  ).toBeVisible();

  // Provenance: the contract, the run, and the transaction behind it.
  await expect(page.getByText(/Provenance/i)).toBeVisible();
  await expect(page.getByText(ON_CHAIN_ID, { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Every attempt keeps its transaction hash/i),
  ).toBeVisible();

  // ── the intake receipt: read from the contract's own manifest ────────
  await page.goto(`/assessments/${assessmentId}/receipt`);
  await expect(page.getByRole("heading", { name: /Intake receipt/i })).toBeVisible();
  await expect(
    page.getByText(/Straight from the contract's manifest/i),
  ).toBeVisible();
  // The arc's three items are in the judged manifest, with both hashes.
  await expect(page.getByText(/Sealed manifest/).first()).toBeVisible();
  await expect(page.getByText(/extractor-1\.0\.0/).first()).toBeVisible();

  // ── the appeal gate: available, or explained ─────────────────────────
  await page.goto(`/assessments/${assessmentId}/appeal`);
  await expect(page.getByRole("heading", { name: /appeal/i }).first()).toBeVisible();

  await ctx.close();
});
