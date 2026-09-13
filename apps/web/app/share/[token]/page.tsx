"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, ApiFailure } from "../../components/api";
import { ErrorNotice, Spinner } from "../../components/bits";

// Screen 12 — the shareable assessment view: redeeming the link grants
// buyer access, then lands on the same derived report every party sees.
export default function ShareRedeem() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [state, setState] = useState<
    "working" | "auth" | "gone" | "error"
  >("working");
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<{ assessmentId: string }>(`/api/share/${token}`, {
          method: "POST",
        });
        router.replace(`/assessments/${r.assessmentId}`);
      } catch (e) {
        if (e instanceof ApiFailure && e.status === 401) setState("auth");
        else if (e instanceof ApiFailure && (e.status === 410 || e.status === 404)) {
          setState("gone");
          setError(e);
        } else {
          setState("error");
          setError(e);
        }
      }
    })();
  }, [token, router]);

  if (state === "working")
    return (
      <div className="row" style={{ justifyContent: "center", padding: 80 }}>
        <Spinner />
        <span className="muted">opening the shared assessment…</span>
      </div>
    );

  if (state === "auth")
    return (
      <section className="section" style={{ maxWidth: 480, margin: "0 auto" }}>
        <div className="card" style={{ textAlign: "center", padding: 34 }}>
          <h2>A seller shared a verdict with you</h2>
          <p className="muted" style={{ marginTop: 10 }}>
            Sign in (or create an account) to open it. Your account is what
            lets you add counter-evidence and dispute claims — on the
            record, in your own name.
          </p>
          <Link
            className="btn btn-primary"
            style={{ marginTop: 18 }}
            href={`/auth?next=/share/${token}`}
          >
            Sign in to continue
          </Link>
        </div>
      </section>
    );

  if (state === "gone")
    return (
      <section className="section">
        <div className="empty">
          This share link is no longer valid — it was revoked or its
          wall-clock window expired. Ask the seller for a fresh one.
          Anything already adjudicated remains public on the chain
          regardless of this link.
        </div>
      </section>
    );

  return <ErrorNotice error={error} />;
}
