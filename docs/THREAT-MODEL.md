# AutoCourt threat model

What this system eliminates, what it only detects, and what it honestly
cannot do. The one-line summary: **consensus removes anyone's authorship of
the judgment and the record, and every write belongs to the wallet that
signed it; intake is attributable and tamper-evident, not trustless.**

Since 14 Sep 2026 there is no operator in the path. The app is a static web
page: it reads the contract straight from the visitor's browser, and every
write is signed by the wallet of the person taking the step. There is no
server holding files, keys, sessions or a queue. This document is written
for that shape and for the deployment of record named in the README
(ruleset `autocourt-rules-5`); the full-stack build it replaced ran every
transaction through an operator's wallet, and its rows are gone with it.

## The parties

- **Seller**: the wallet that signs `create_assessment`. The contract records
  that wallet as seller of record and no other: a record cannot be opened in
  someone else's name. The seller declares the claims, owns 5 of the 8
  intake slots before sealing, and alone decides when intake closes. The
  judged party controls most of the record (the S27 hazard); the
  corroboration ladder prices this rather than pretending otherwise.
- **Buyer**: any other wallet that disputes a claim, uploads counter-evidence
  or asks the validators to fetch an independent source, always in its own
  name. A record is public, so a buyer needs its number, not an invitation.
- **Recorded party**: the seller, or any wallet with a dispute, an upload or
  a requested source on the record. Only a recorded party can ask for the
  panel, add appeal evidence or appeal.
- **Anyone else** can read every record and become a party by disputing a
  claim in its own name. It cannot seal, judge or appeal a record it has no
  part in.
- **Validators**: the GenLayer panel. No single validator, and not the
  leader, can author what the record says.

## Eliminated by design

| attack | why it cannot work |
|---|---|
| Anyone authors the verdict | The panel returns findings only; deterministic contract code, run identically inside every validator, derives every verdict, floor, flag, confidence and next action. No single machine's output decides anything. |
| A write in another wallet's name | Every account the contract records is the transaction's signer: the seller of record, each uploader, each disputer, each appellant, and the wallet that asked for each source (`added_by`). A client that names a different account is refused in words (`… must be the wallet that signs this transaction`), never recorded. Proven live with finalized refusals (README, "The wallet walls, live"). |
| A stranger closes or re-judges someone's record | Only the seller of record can seal. Only a recorded party can request adjudication, add appeal evidence or appeal. |
| One side crowds the other out of the record | Intake slots are split by side: before sealing the seller owns 5 and every other wallet shares 3; each appeal's 4 new slots split 2 and 2. The seller cannot spend the buyers' slots, and no buyer can spend the seller's. |
| Leader fabricates evidence content | Uploaded text is consensus calldata with its hash recomputed at entry by every validator; an independent source is fetched by EVERY validator itself and enters only if their bytes match the committed fingerprint. No leader-private byte exists in the record. |
| A source URL that names an allowlisted host but fetches another | The contract cuts the host where a browser does (at `/`, `?`, `#` or a backslash), refuses userinfo (`@`) and any character outside a plain hostname, and only then checks the allowlist, all before any validator fetches. Seven smuggling shapes are pinned in the direct suite, and one is refused live. |
| Fabricated-but-consistent dossier (the S39 shape) | Quotes must ground word-token-wise in the SHARED stored record, and each validator re-derives the leader's report from the leader's own findings. Adversarial tests replay exactly this forgery and the round is refused. |
| Rewriting or hiding history | Runs, manifests and items are append-only chain state; `get_verdict` names the standing run AND the total, so a superseded verdict cannot impersonate the standing one. |
| Silent verdict re-rolls | A second adjudication of an unchanged manifest is refused in the contract; a re-judgment is only reachable as a recorded, attributed, capped appeal. |
| Substituted bytes in an appeal | The manifest commits the normalized-text hash, not just the file hash, and recorded items are read from contract storage by id: there is no parameter through which replacement bytes could travel. An appeal never refetches a source. |
| Accusation laundering past the floor | Every floor keys on the `adverse` attribute: an accusation resting only on the accuser's own uploads lands at inspection or insufficient, whichever enum name it wears, and the rollback flag needs two distinct accounts or an independent source. |
| Answering an independent source with your own paperwork | Neither side's own uploads can turn an independent source into a conflict. Against `INDEPENDENT` support, an accuser's own contradiction caps the claim instead; against an `INDEPENDENT` contradiction, support that is only first-party is judged as absent from the derivation. Proven live: the recall record's appeal panel read the seller's signed declaration as support, and the claim stayed `CLAIM_CONTRADICTED`. |
| A stored trouble code passed off as a defect | The diagnostic flag needs the panel to find an observed effect of a recorded code's fault, and a support quote that names the code, in any spelling, does not count in code. The panel is told that a document which only lists, names or defines a code is not support, and that a report of normal operation means no. Proven live with controls: the same code raised the flag beside a report of symptoms and did not beside a normal road test or the code's bare definition. |
| A document passed off as another party's | An upload is recorded in its signer's name, and each item also carries its uploader's EIP-191 signature over both of its hashes, on the public record. The app verifies it on every view ("Signed by its uploader" or "Signature does not match these bytes"), and anyone can repeat the check from chain data alone. |

## Detectable after the fact

| attack | detection |
|---|---|
| Extraction that misstates a document | Extraction runs in the uploader's own browser, and what enters the record is the text they reviewed, redacted and signed. The file fingerprint and the text fingerprint both sit in the sealed manifest, so anyone holding the original can recompute both. The panel judges the recorded text, never the file. |
| Sybil accounts (one person, several wallets) | Same-account items never corroborate; first-party support can neither lift `VERIFIED` nor mint a conflict against an independent source; attribution by wallet makes patterns auditable. Priced and detectable, not prevented. |

## Honest limitations

- **The non-seller side is first come, first served.** The 3 intake slots
  before sealing, the 2 per appeal and the 8 disputing accounts are shared by
  every wallet that is not the seller. A seller running extra wallets could
  fill them before a genuine buyer arrives. That forges nobody's name and
  changes no derivation, and a record with its buyer side filled by strangers
  is itself visible on the record, but it can keep a real buyer's evidence
  out of the first packet.
- **The seller decides when intake closes.** A buyer who has not added
  evidence by the seal must bring it to an appeal, which needs a dispute
  first, and appeals are capped at the contract's run limit.
- **Identity is a wallet, and only a wallet.** A signature proves control of
  an address, nothing more; anyone can mint addresses, and identity beyond
  the registry-checked VIN is out of scope. What makes a second wallet
  worthless is the contract's floors, not a login.
- **A recall list speaks for a model year, not a car.** NHTSA's
  `recallsByVehicle` lists the recalls issued for a make, model and year. It
  can contradict "no recall was ever issued for this model"; it cannot say
  whether one particular car's recall was remedied. The panel is asked
  whether the record is sufficient, and a claim the source cannot settle
  lands short of a conclusive verdict.
- **A long source is judged in part.** Every validator hashes the first 8,000
  characters of the rendered page and the contract stores the first 6,000 of
  its normalized text. NHTSA's list for the 2003 Honda Accord is about 36,000
  characters, so the panel reads its first recalls, not all 24.
- **What counts as an observed effect is still the panel's reading.** The
  code refuses a support quote that names a recorded code; it cannot tell a
  paraphrase of the code's meaning from a real symptom. The question the
  panel is asked closes that gap in practice (three live controls agreed),
  not by construction.
- **Evidence is public, permanently.** Publishing an item writes its text
  after redaction, its label, readings, both fingerprints and the signature
  to a public chain. Redaction must happen before publishing and is
  impossible after. The publish step shows this verbatim and requires an
  explicit acknowledgement. Original files never leave the uploader's
  browser.
- **Extraction reads plain text and PDFs with embedded text.** Scanned
  PDFs and images enter as fingerprints with no text, and the panel is told
  their content is unknown. Nothing is fabricated to fill the gap.
- **Availability of independent sources.** A source's host outage, or
  bytes that no longer match the committed fingerprint, records the item
  `SOURCE_UNAVAILABLE` (never an adverse finding); a reachability split
  burns the round. The fingerprint is taken in the browser over the text
  GenVM's webdriver will render, which is exact for plain-text and JSON
  pages; an HTML page's rendering cannot be reproduced outside a browser, so
  there it is a best effort. The allowlist is a deployment constant visible
  in `get_config()`: `api.nhtsa.gov` and commit-pinned
  `raw.githubusercontent.com`, whose registry extract is fictional and
  stands in for registries no public API serves.
- **Studio Next is a test network.** Fees are paid in test GEN, which the
  app's wallet menu requests from the network's faucet.
