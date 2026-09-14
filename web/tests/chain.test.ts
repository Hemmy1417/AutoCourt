import { describe, expect, it } from "vitest";

import { CHAIN_HEX, isTransient, isUnknownChainError, sameAddress, toChainHex, walletErrorMessage } from "../lib/chain";
import { CONTRACT_ADDRESS, DEPLOYMENT_OF_RECORD, formatGen } from "../lib/config";

describe("the chain the wallet is asked for", () => {
  it("spells Studio Next's id the way EIP-695 wants it", () => {
    expect(toChainHex(61997)).toBe("0xf22d");
    expect(CHAIN_HEX).toBe("0xf22d");
    expect(() => toChainHex(0)).toThrow();
  });

  it("recognises 'unknown chain' at every depth MetaMask and friends put it", () => {
    expect(isUnknownChainError({ code: 4902 })).toBe(true);
    // Measured on MetaMask against Studio Next: the 4902 is nested.
    expect(isUnknownChainError({ code: -32603, data: { originalError: { code: 4902 } } })).toBe(true);
    expect(isUnknownChainError({ message: 'Unrecognized chain ID "0xf22d".' })).toBe(true);
    expect(isUnknownChainError({ code: 4001, message: "User rejected" })).toBe(false);
  });

  it("puts wallet refusals in words", () => {
    expect(walletErrorMessage({ code: 4001 })).toMatch(/declined/);
    expect(walletErrorMessage({ code: -32002 })).toMatch(/already has a request open/);
  });

  it("treats rate limits and dropped connections as passing", () => {
    expect(isTransient(new Error("Rate limit exceeded: 30 requests per minute"))).toBe(true);
    expect(isTransient(new Error("TypeError: Failed to fetch"))).toBe(true);
    expect(isTransient(new Error("[EXPECTED] unknown assessment"))).toBe(false);
  });

  it("compares accounts without regard to case", () => {
    expect(sameAddress("0xAbC0000000000000000000000000000000000001", "0xabc0000000000000000000000000000000000001")).toBe(true);
    expect(sameAddress("", "")).toBe(false);
  });
});

describe("configuration", () => {
  it("reads the deployment of record", () => {
    expect(CONTRACT_ADDRESS).toBe(DEPLOYMENT_OF_RECORD);
  });

  it("formats GEN from atto without floating point", () => {
    expect(formatGen(5n * 10n ** 18n)).toBe("5.000");
    expect(formatGen("1234500000000000000")).toBe("1.234");
    expect(formatGen("not a number")).toBe("0");
  });
});
