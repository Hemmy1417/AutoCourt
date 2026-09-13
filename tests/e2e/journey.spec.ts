/**
 * The complete seller-to-buyer journey (brief §16), on seeded fixture
 * files with known content: connect wallets → list the vehicle → build
 * the record → redact → consent → share → buyer disputes and counters →
 * submit → revoked link answers 410.
 *
 * Wallets are real signers (viem local accounts) behind a minimal
 * EIP-1193 stub, so the EIP-191 sign-in path runs for real. The chain
 * boundary is the job queue; the live arc proves the chain half.
 */

import { expect, test, type Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SELLER_PK =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const BUYER_PK =
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";

const invoicePath = fileURLToPath(new URL("fixtures/invoice.txt", import.meta.url));
const historyPath = fileURLToPath(new URL("fixtures/history.txt", import.meta.url));

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
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await page.waitForURL("**/dashboard");
  return account.address.toLowerCase();
}

test("the seller-to-buyer journey holds end to end", async ({ browser }) => {
  const sellerCtx = await browser.newContext();
  const seller = await sellerCtx.newPage();
  await connectWallet(seller, SELLER_PK, "Sada the seller");

  // List the vehicle with two claims.
  await seller.goto("/vehicles/new");
  await seller.getByPlaceholder("1M8GDM9AXKP042788").fill("1M8GDM9AXKP042788");
  await seller.getByPlaceholder("Meridian").fill("Meridian");
  await seller.getByPlaceholder("GT Wagon").fill("GT Wagon");
  await seller.getByPlaceholder("2019").fill("2019");
  await seller.getByPlaceholder("87,432 miles").fill("87,432 miles");
  await seller.getByRole("button", { name: "Add claim" }).click();
  const selects = seller.locator("select");
  await selects.nth(1).selectOption("ACCIDENT_HISTORY");
  await seller
    .locator('input[placeholder="minor oil seep at valve cover, disclosed"], input[placeholder="excellent; no rust; original paint"]')
    .last()
    .fill("no recorded accidents");
  await seller.getByRole("button", { name: "Open the assessment" }).click();
  await seller.waitForURL("**/assessments/**");
  const dossierUrl = seller.url();

  // Upload the invoice fixture; its bytes are the record's identity.
  await seller.setInputFiles('input[type="file"]', invoicePath);
  await seller.locator("select").last().selectOption("SERVICE_INVOICE");
  await seller.getByPlaceholder("March service invoice").fill("March invoice");
  await seller.getByRole("button", { name: "Upload to the record" }).click();
  await expect(seller.getByText("E-001")).toBeVisible();
  await expect(seller.getByText("consent pending").first()).toBeVisible();

  // The submit gate names the missing consent instead of failing silently.
  await expect(
    seller.getByText(/still need the publicity consent/),
  ).toBeVisible();

  // Redact the card number BEFORE consent (afterwards it is impossible).
  await seller.getByRole("button", { name: "Review text" }).click();
  await expect(seller.getByText(/card ending 4417/)).toBeVisible();

  // Typed rows: the reading the contract recomputes conflicts from.
  await seller.getByRole("button", { name: /Diagnostics/ }).click();
  await seller.locator('input[type="date"]').last().fill("2026-03-07");
  await seller.getByPlaceholder("odometer").fill("87432");
  await seller.getByPlaceholder("where in the document").fill("odometer line");
  await seller.getByRole("button", { name: "Save typed rows" }).click();
  await expect(seller.getByText("2026-03-07: 87,432 miles")).toBeVisible();

  // Consent (the verbatim publicity statement gates the packet).
  await seller.getByRole("button", { name: "Consent for the packet" }).click();
  await expect(
    seller.getByText(/Adjudicated evidence is public/),
  ).toBeVisible();
  await seller.getByRole("checkbox").check();
  await seller.getByRole("button", { name: /Consent E-001/ }).click();
  await expect(seller.getByText("consented").first()).toBeVisible();

  // Share link — shown exactly once.
  await seller.getByRole("button", { name: "Create a share link" }).click();
  const linkEl = seller.locator(".copyable");
  await expect(linkEl).toBeVisible();
  const shared = await linkEl.getAttribute("title");
  expect(shared).toContain("/share/");
  const sharePath = new URL(shared!).pathname;

  // The buyer arrives through the link, disputes, and counters.
  const buyerCtx = await browser.newContext();
  const buyer = await buyerCtx.newPage();
  await connectWallet(buyer, BUYER_PK, "Bode the buyer");
  await buyer.goto(sharePath);
  await buyer.waitForURL("**/assessments/**");
  await expect(buyer.getByText("shared with you").first()).toBeVisible();

  await buyer.getByRole("button", { name: "Dispute…" }).click();
  await buyer.getByRole("checkbox").last().check();
  await buyer
    .getByPlaceholder("odometer looks off against the history")
    .fill("history looks thin");
  await buyer.getByRole("button", { name: "Record the dispute" }).click();
  await expect(buyer.getByText(/disputed by 1 party/)).toBeVisible();

  await buyer.setInputFiles('input[type="file"]', historyPath);
  await buyer.locator("select").last().selectOption("VEHICLE_HISTORY_RECORD");
  await buyer.getByRole("button", { name: "Upload to the record" }).click();
  await expect(buyer.getByText("E-002")).toBeVisible();
  await buyer.getByRole("button", { name: "Consent for the packet" }).click();
  await buyer.getByRole("checkbox").last().check();
  await buyer.getByRole("button", { name: /Consent E-002/ }).click();

  // The seller submits: state advances and the journey stepper says so.
  await seller.reload();
  await seller.getByRole("button", { name: "Submit for adjudication" }).click();
  await expect(seller.getByText("SUBMITTED").first()).toBeVisible();
  // Evidence upload is now closed, with the reason in words (S40).
  await expect(seller.getByText(/sealed while adjudication/)).toBeVisible();

  // Revocation: the link dies with 410, and says what that does NOT undo.
  await seller.goto("/settings");
  await seller.getByRole("button", { name: "Revoke" }).click();
  await expect(seller.getByText(/revoked/).first()).toBeVisible();
  const strangerCtx = await browser.newContext();
  const stranger = await strangerCtx.newPage();
  await connectWallet(stranger,
    "0x47c99abed3324a2707c28affff1267e45918ec8c3f20b8aa892e8b065d2942dd",
    "Third wheel");
  await stranger.goto(sharePath);
  await expect(
    stranger.getByText(/revoked|expired/).first(),
  ).toBeVisible();

  await sellerCtx.close();
  await buyerCtx.close();
  await strangerCtx.close();
});
