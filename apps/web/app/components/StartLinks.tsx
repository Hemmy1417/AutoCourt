"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, type Me } from "./api";

/**
 * The landing page's two calls to action, which must know whether you are
 * already signed in.
 *
 * They used to point at /auth unconditionally, so a signed-in visitor who
 * clicked "Start an assessment" was thrown back to the connect-wallet
 * screen — every single time. The session was fine; the link was wrong.
 *
 * While the session is still being checked both links point at /auth with
 * a `next`, which is correct for a signed-out visitor and harmless for a
 * signed-in one, because /auth now forwards an existing session straight
 * through instead of asking again.
 */
export function StartLinks() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    api<Me>("/api/me")
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const start = me ? "/vehicles/new" : "/auth?next=/vehicles/new";
  const report = me ? "/dashboard" : "/auth?next=/dashboard";

  return (
    <div className="row" style={{ marginTop: 28 }}>
      <Link href={start} className="btn btn-primary">
        Start an assessment
      </Link>
      <Link href={report} className="btn btn-ghost">
        {me ? "Open my assessments" : "I was sent a report"}
      </Link>
    </div>
  );
}
