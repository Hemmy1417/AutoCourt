# AutoCourt threat model

What this system eliminates, what it only detects, and what it honestly
cannot do. Written before the app shipped (brief §17; design review,
trust-story lens). The one-line summary: **consensus removes the
operator's authorship of the judgment and the record; intake is
tamper-evident, not trustless.**

## The parties

- **Seller** — creates the listing, declares claims, uploads most
  evidence. The judged party controls most of the record (the S27
  hazard); the corroboration ladder prices this rather than pretending
  otherwise.
- **Buyer** — reaches the assessment through a share link, uploads
  counter-evidence, records disputes.
- **Operator** — runs the app: authenticates accounts, stores files,
  extracts text, assembles packets, submits transactions from its wallet.
- **Validators** — the GenLayer panel; no single validator (or the
  leader) can author what the record says.

## Eliminated by design

| attack | why it cannot work |
|---|---|
| Operator (or anyone) authors the verdict | The panel returns findings only; deterministic contract code — run identically inside every validator — derives every verdict, floor, flag, confidence and next action. No single machine's output decides anything. |
| Leader fabricates evidence content | Uploaded bytes are consensus calldata (every validator reads the same bytes, hash recomputed at entry); anchor bytes are fetched by EVERY validator itself at entry. No leader-private byte exists in the record. |
| Fabricated-but-consistent dossier (the S39 shape) | Quotes must ground word-token-wise in the SHARED stored record, and each validator re-derives the leader's report from the leader's own findings. Adversarial tests replay exactly this forgery and the round is refused. |
| Rewriting or hiding history | Runs, manifests and items are append-only chain state; `get_verdict` names the standing run AND the total, so a superseded verdict cannot impersonate the standing one. |
| Silent verdict re-rolls | A second adjudication of an unchanged manifest is refused in the contract; a re-judgment is only reachable as a recorded, attributed, capped appeal. |
| Altered re-extraction smuggled into an appeal | The manifest commits the NORMALIZED-TEXT hash (not just the file hash), and appeal items tagged RECORDED are read from contract storage by id — there is no parameter through which replacement bytes could travel. |
| Accusation laundering past the floor | Every floor keys on the `adverse` attribute: an accusation resting only on the accuser's own uploads lands at inspection/insufficient — whichever enum name it wears — and the rollback flag needs two distinct accounts or an anchor item. |

## Detectable after the fact (by the party wronged)

| attack | detection |
|---|---|
| Operator alters or truncates extraction | Dual hashes + pinned extractor version in the on-chain manifest; originals stay downloadable to parties of the run; `scripts/verify-extraction` recomputes the text hash from the original. Detectable, not prevented — the app is the sole extractor of uploaded files. |
| Operator omits a party's evidence or dispute | The intake receipt (`/api/assessments/:id/receipt`) shows every party their items against the CONTRACT's manifest: "in the judged record" or not. An invariant test guards the surface. |
| Sybil accounts (one person, two inboxes) | Same-account items never corroborate; opposing-role uploads can never lift `VERIFIED` (only `INDEPENDENT` anchors can); on-chain attribution makes patterns auditable. Priced and detectable — not prevented. |

## Honest limitations

- **The operator can refuse service.** AutoCourt is not
  censorship-resistant: only the operator's wallet submits transactions,
  so the operator can stall an assessment or an appeal. It cannot forge
  or alter one. (A submit-from-own-wallet path is a possible future.)
- **Account identity is app-attested.** Email+password accounts prove
  nothing about real-world identity; identity beyond the code-validated
  VIN is out of scope.
- **Extraction fidelity is testimony.** Every validator faithfully
  judges whatever the operator's pipeline produced (see detection row
  above).
- **Adjudicated evidence is public, permanently.** The normalized text
  of every packet item, the claim values, both hashes and the panel's
  findings live on a public chain. Redaction must precede submission and
  is impossible after; share-link revocation governs only the app's
  copy. The consent step states this verbatim before anything is
  submitted; original files are never published — only their sha256.
- **No antivirus scanning of uploads.** Files are magic-byte sniffed,
  stored under hash-derived names, and extracted text is rendered as
  plain text only — but uploaded binaries are not scanned for malware,
  and downloading an original is at the downloader's risk.
- **Availability of anchors.** An anchor host outage degrades that item
  to `SOURCE_UNAVAILABLE` (never an adverse finding); a reachability
  split burns the round. The allowlist is a deployment constant visible
  in `get_config()` — an empty allowlist makes `VERIFIED` honestly
  unreachable, and the config says so.
