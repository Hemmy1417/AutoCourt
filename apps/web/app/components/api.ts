"use client";

/** Client fetch with the API's typed error envelope surfaced verbatim. */

export interface Me {
  id: string;
  walletAddress: string;
  displayName: string;
}

export function shortAddress(a: string | null | undefined): string {
  if (!a) return "—";
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export class ApiFailure extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const jsonBody = Boolean(init?.body) && !(init?.body instanceof FormData);
  const res = await fetch(path, {
    credentials: "same-origin",
    ...(jsonBody ? { headers: { "content-type": "application/json" } } : {}),
    ...init,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiFailure(
      res.status,
      String(body?.code ?? "ERROR"),
      String(body?.message ?? `request failed (${res.status})`),
      body?.details ?? null,
    );
  }
  return body as T;
}

export function shortHash(h: string | null | undefined, n = 10): string {
  if (!h) return "—";
  return h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-6)}` : h;
}

export const EXPLORER = "https://explorer-studio-dev.genlayer.com";
