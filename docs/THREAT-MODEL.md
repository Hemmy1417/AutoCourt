# AutoCourt threat model

What this system eliminates, what it only detects, and what it honestly
cannot do. The one-line summary: **consensus removes anyone's authorship of
the judgment and the record; intake is attributable and tamper-evident, not
trustless.**

Since 14 Sep 2026 there is no operator in the path. The app is a static web
page: it reads the contract straight from the visitor's browser, and every
write is signed by the wallet of the person taking the step. There is no
server holding files, keys, sessions or a queue. This document is written
for that shape; the full-stack build it replaced ran every transaction
through an operator's wallet, and its rows are gone with it.

## The parties

- **Seller**: the wallet named as seller of record when the record opens.
  Declares the claims and usually supplies most of the evidence. The judged
  party controls most of the record (the S27 hazard); the corroboration
  ladder prices this rather than pretending otherwise.
- **Buyer**: any other wallet that disputes a claim or adds counter-evidence
  in its own name. A record is public, so a buyer needs its number, not an
  invitation.
- **Anyone**: every write on the contract is open to any wallet. That is the
  honest consequence of having no operator, and the limitations below say
  what it allows.
- **Validators**: the GenLayer panel. No single validator, and not the
  leader, can author what the record says.

## Eliminated by design

| attack | why it cannot work |
|---|---|
| Anyone authors the verdict | The panel returns findings only; deterministic contract code, run identically inside every validator, derives every verdict, floor, flag, confidence and next action. No single machine's output decides anything. |
| Leader fabricates evidence content | Uploaded text is consensus calldata with its hash recomputed at entry by every validator; an independent source is fetched by EVERY validator itself and enters only if their bytes match the committed fingerprint. No leader-private byte exists in the record. |
| Fabricated-but-consistent dossier (the S39 shape) | Quotes must ground word-token-wise in the SHARED stored record, and each validator re-derives the leader's report from the leader's own findings. Adversarial tests replay exactly this forgery and the round is refused. |
| Rewriting or hiding history | Runs, manifests and items are append-only chain state; `get_verdict` names the standing run AND the total, so a superseded verdict cannot impersonate the standing one. |
| Silent verdict re-rolls | A second adjudication of an unchanged manifest is refused in the contract; a re-judgment is only reachable as a recorded, attributed, capped appeal. |
| Substituted bytes in an appeal | The manifest commits the normalized-text hash, not just the file hash, and recorded items are read from contract storage by id: there is no parameter through which replacement bytes could travel. |
| Accusation laundering past the floor | Every floor keys on the `adverse` attribute: an accusation resting only on the accuser's own uploads lands at inspection or insufficient, whichever enum name it wears, and the rollback flag needs two distinct accounts or an independent source. |
| A document passed off as another party's | Each uploaded item carries its uploader's EIP-191 signature over both of its hashes, on the public record. The app verifies it on every view ("Signed by its uploader" or "Signature does not match these bytes"), and anyone can repeat the check from chain data alone. |

## Detectable after the fact

| attack | detection |
|---|---|
| Extraction that misstates a document | Extraction runs in the uploader's own browser, and what enters the record is the text they reviewed, redacted and signed. The file fingerprint and the text fingerprint both sit in the sealed manifest, so anyone holding the original can recompute both. The panel judges the recorded text, never the file. |
| An item written in another account's name | The contract takes the uploader and disputer accounts as data. An item naming an account shows as "Unsigned" unless that account's signature covers it, and a dispute records the transaction's real sender (`address`) beside the account it names. |
| Sybil accounts (one person, two wallets) | Same-account items never corroborate; opposing-role uploads can never lift `VERIFIED` (only independent sources can); attribution by wallet makes patterns auditable. Priced and detectable, not prevented. |

## Honest limitations

- **Record writes are open to any wallet.** The contract checks no sender
  on sealing, evidence entry or adjudication. A stranger can seal an open
  record before its seller has finished, or spend its evidence slots, and
  anyone can ask the panel to judge a sealed packet. None of this can
  change a verdict's derivation or forge a signature, but it can disrupt a
  record. The earlier build hid this behind an operator wallet; the
  contract never enforced it. A future version would bind these writes to
  the seller's sender address.
- **Identity is a wallet, and only a wallet.** A signature proves control of
  an address, nothing more; anyone can mint addresses, and identity beyond
  the registry-checked VIN is out of scope. What makes a second wallet
  worthless is the contract's floors, not a login.
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
  GenVM's webdriver will render, which is exact for plain-text pages; an
  HTML page's rendering cannot be reproduced outside a browser, so there it
  is a best effort. The allowlist is a deployment constant visible in
  `get_config()`.
- **Studio Next is a test network.** Fees are paid in test GEN, which the
  app's wallet menu requests from the network's faucet.
