# AutoCourt — founding architecture decisions

Product: evidence-based used-vehicle verification. A seller lists a vehicle
and declares claims; evidence accumulates from both sides; a GenLayer
Intelligent Contract adjudicates the claims against the evidence and the app
renders a claim-by-claim verdict a buyer can trust — including the honest
outcomes: insufficient, conflicting, inspection-required.

Every decision below is downstream of [STANDARDS-MAP.md](STANDARDS-MAP.md).
Read that first; this file says *what* is built, that one says *why it must
be built that way*.

## 0. Scope ruling — the brief's two halves

The build prompt contains a full-stack product definition (AutoCourt) and,
appended, the standalone-contract master operating template whose §1.5 says
"contract-only by default, do not add a dashboard/backend". These conflict on
scope. Ruling, recorded so it is a decision and not an accident:

- the **product half governs scope** — its own words: "This is a full-stack
  product build, not a standalone Intelligent Contract repository";
- the **master template governs contract discipline** — Direct Mode testing,
  forged-leader validation, GenVM lint, deployment evidence, source parity,
  finality language, freeze rule. Those sections are applied to
  `contracts/autocourt_assessment.py` exactly as if it were a standalone
  submission.

## 1. Network and chain facts

| | |
|---|---|
| Network | GenLayer StudioNet |
| Chain id | 61999 |
| RPC | `https://studio.genlayer.com/api` |
| Explorer | `https://explorer-studio.genlayer.com` (`/address/<a>`, `/tx/<h>`) |
| Runner | pin the current proven `py-genlayer` runner at contract-writing time; the `# { "Depends": ... }` header and its trailing blank line are load-bearing |

The deployment of record, once it exists, is named in exactly one way across
`.env.example`, README, CI and docs (S37 gate).

## 2. Stack

- **Monorepo, npm workspaces.** `apps/web` (Next.js App Router, TypeScript —
  UI **and** API route handlers), `apps/worker` (Node entry point that drains
  the job queue in local/long-lived deployments), `packages/*` for everything
  either consumes: `shared-types`, `validation`, `evidence`,
  `genlayer-client`, `db`. One lockfile, one `tsc`, one test runner (vitest)
  for TS; pytest for the contract.
- **PostgreSQL + Prisma.** `infrastructure/docker/docker-compose.yml` runs
  Postgres 16 locally; `DATABASE_URL` in env. Migrations committed.
- **Evidence files** go through a storage adapter (`packages/evidence`):
  `LocalDiskStorage` in dev (`var/evidence/`, gitignored), interface-shaped
  so an S3-compatible store slots in without touching the domain. Files are
  hashed (sha256) at upload; the hash, not the path, is the identity.
- **Extraction** is adapter-shaped too: PDF text extraction and plain text
  are real; OCR ships as an interface with a null default that records
  `extraction_status = UNAVAILABLE` — an image without OCR is *unextracted
  evidence the panel is told about*, never silently dropped and never
  fabricated (brief §16: "evidence is never silently discarded").
- **Auth**: self-contained email+password (argon2id) with signed HttpOnly
  session cookies. No auth vendor, no secrets in the client. Roles are
  contextual: a user is a seller on vehicles they created and a buyer on
  assessments shared with them.
- **Background work**: assessment jobs are DB rows. `packages/worker-core`
  exposes `runPendingJobs()`; `apps/worker` loops it locally; in serverless
  deployment an authenticated route triggers the same function. The GenLayer
  transaction is submitted once and then *polled* — a crash between submit
  and record is recovered by re-reading the chain, never by resubmitting
  blind (the arc lessons: a lost response is not a refusal).

## 3. The evidence pipeline (deterministic side)

```
upload → size/type validation → sha256 → store original
      → extract text (bounded) → normalize → EvidenceItem row
```

At assessment time the app builds the **packet**:

- vehicle facts (VIN code-validated: format + ISO 3779 check digit),
- the claim set (each claim typed: mileage, accident history, condition,
  defect disclosure, service history — with the seller's declared values),
- per-item evidence entries: id, declared type (disclosed as the uploader's
  claim — S31), uploader role, capture/upload timestamps, sha256, bounded
  normalized text (or `UNEXTRACTED`), corroboration class **derived in
  code** (FIRST_PARTY / COUNTERPARTY / CORROBORATED — S27/S34),
- deterministic pre-findings the code can compute without judgment: mileage
  sequence across dated documents (a later date with lower mileage is a
  code-detected conflict candidate, the panel weighs it), duplicate-hash
  detection, VIN echoes in text mismatching the subject VIN,
- the manifest: sorted `(id, sha256)` pairs and their root hash.

Numbers and dates are formatted by code into the exact strings the panel
reads. The model never converts a unit (CredenceLend's hundredfold lesson).

## 4. The contract (`contracts/autocourt_assessment.py`)

One canonical deployable contract. Surface (names final, signatures refined
at implementation):

| method | kind | does |
|---|---|---|
| `submit_assessment(packet_json)` | write, deterministic | validates bounds + structure, stores the packet and its manifest root, returns `ac-NNNNNN`; immutable once stored |
| `adjudicate(id)` | write, nondet | one panel round over the **stored** packet; findings validated at the boundary; verdicts derived in code; run recorded |
| `readjudicate(id, delta_packet_json)` | write, nondet | appeal: new run over recorded items (hash-verified against the stored manifest, tagged RECORDED) plus NEW items; prior runs immutable |
| `get_assessment(id)` / `get_run(id, n)` / `get_verdict(id)` | views | the record, machine-readable |
| `get_stats()` / `get_config()` | views | counters; every bound the writes enforce, so the frontend never guesses a limit |

- **No contract-side fetch of party-controlled URLs.** All evidence content
  arrives via calldata — identical for every validator by construction
  (S39 §1 of the standards map).
- **Panel output = per-claim findings only** (status, severity, evidence-id
  citations, verbatim grounding quotes). Deterministic code validates every
  field (S16), checks every quote appears in the cited item's stored text
  (S19-adjacent grounding), applies the corroboration floors (S34), the
  sufficiency gate on every conclusive verdict (S22), and derives the
  claim-level and overall verdicts by fixed precedence (S7).
- **Equivalence** covers per-claim status, severity band, cited evidence-id
  sets, mileage-conflict flags, inspection-required — the fields the derived
  report reads. Prose free. Disagreements print the dissenter's quotes.
- **Failure fails closed** (S5): malformed model output → the run records a
  rejected adjudication, state does not advance, previous record stands.
- Everything bounded: claims, items, per-item chars, packet bytes, runs per
  assessment.

## 5. Data model (Prisma, the domain rows the brief names)

`User, Vehicle, VehicleClaim, Assessment, EvidenceItem, EvidenceExtraction,
DiagnosticObservation, InspectionFinding, AssessmentFinding, AdjudicationRun,
Appeal, AuditEvent, ShareLink` — relationships per the brief; every
AdjudicationRun stores the packet manifest root, the tx hash, and renders
from the **contract view as source of truth** (DB caches, chain decides).
Share links are signed, expiring, revocable. Audit events are append-only.

## 6. Verdict model

The brief's full enum is implemented in `packages/shared-types` and mirrored
in the contract: `VERIFIED, PARTIALLY_VERIFIED, CLAIM_CONTRADICTED,
MATERIAL_CONCERN, MILEAGE_CONFLICT, POSSIBLE_ODOMETER_ROLLBACK,
DIAGNOSTIC_CONCERN_SUPPORTED, CONFLICTING_EVIDENCE, INSUFFICIENT_EVIDENCE,
PHYSICAL_INSPECTION_REQUIRED, SOURCE_UNAVAILABLE, INCONCLUSIVE, REJECTED` —
with the derivation precedence documented next to the code that implements
it, and the corroboration floors deciding which of these a given evidence
profile can even reach. Diagnostic codes are never auto-failures (brief §14):
`DIAGNOSTIC_CONCERN_SUPPORTED` requires symptom/context support in the
findings, and safety-critical concerns always set the inspection bit.

## 7. State machines

**Assessment**: `DRAFT → SUBMITTED → PROCESSING → ADJUDICATED | FAILED`;
`ADJUDICATED --appeal--> PROCESSING (new run)`; `FAILED --retry--> PROCESSING`.
Every non-terminal state has a named mover and a timeout exit (S26).
**Evidence after a verdict** never mutates the verdict; it enables a new run
(S33 shape). **Share link**: `ACTIVE → REVOKED | EXPIRED` (wall-clock, S13).

## 8. What is deliberately absent

Payments, escrow, bonds, ownership transfer, marketplace mechanics, "AI
score" gauges, autonomous mechanical diagnosis, safety certification (brief
§3). No pooled funds → the money standards are consciously N/A (standards
map, final table). The verdict is the product; GenLayer is load-bearing
because no single operator's model should author what a buyer relies on —
remove GenLayer and one party's backend becomes the authority on every
claim, which is precisely the trust failure the product exists to remove.

## 9. Delivery order

1. Contract + direct-mode suite (the heart; adversarial from day one)
2. Packages: shared-types, validation, evidence pipeline, db schema
3. API + worker (upload → packet → submit → poll → record)
4. UI (design direction to be chosen with the user before this phase)
5. GenVM lint, deployment to StudioNet, live evidence, integration tests
6. Docs per brief §17, release gates, clean-clone check, submission prep
