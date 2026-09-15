<p align="center">
  <img src="web/app/icon.svg" width="72" alt="AutoCourt" />
</p>

<h1 align="center">AutoCourt</h1>

<p align="center">
  Used-vehicle claims, adjudicated. A seller declares the claims, evidence
  goes on a public record — both sides — a validator panel judges it, and
  deterministic public code derives every verdict. Nobody authors the outcome.
</p>

---

## The deployment of record

AutoCourt reads and writes one deployment of record: `0xa59D87e6ECdde32e940Ae060D146FcB85F9F7dE3`.

| | |
|---|---|
| Live app | [auto-court-web.vercel.app](https://auto-court-web.vercel.app) |
| Contract | [`0xa59D87e6ECdde32e940Ae060D146FcB85F9F7dE3`](https://explorer-studio-dev.genlayer.com/address/0xa59D87e6ECdde32e940Ae060D146FcB85F9F7dE3) |
| Network | GenLayer Studio Next, chain 61997 |
| RPC | `https://studio-next.genlayer.com/api` |
| Source | [`contracts/autocourt_assessment.py`](contracts/autocourt_assessment.py), ruleset `autocourt-rules-5` — byte-verified: `cd web && node scripts/deploy.mjs verify 0xa59D87e6…7dE3` reports byte-for-byte identity (sha256 `98cd2ff0…9551`); deploy tx `0x1e6c035300ce060d3a97bad31ed519f3079a936eeff467fb69f2a29d1660a931` |
| Anchor allowlist | `["api.nhtsa.gov", "raw.githubusercontent.com"]` — NHTSA's public recall records, and commit-pinned GitHub raw standing in for registries no public API serves; visible in `get_config()`, and `VERIFIED` is reachable only through a source |
| Superseded | `0xFCDd0624…57D0` (the same source; a Studio Next outage left three of its first four records half-finished), `0x081Fe3bE…35A7` (a stored trouble code could raise the diagnostic flag on its own), `0xb13808bC…0854` (replaced before its first record by the floor the recall proof found), `0xE26B3C4A…7998` (writes open to any wallet), and before it `0x283E59d0…3c30`, `0xE9d81837…C6a9`, `0x214821A6…5555`. Records do not carry across deployments: the app and this README show only the deployment of record's. Why each deployment was replaced is measured in [PROBE-REPORT](docs/PROBE-REPORT.md) |

## The app

One web app in [`web/`](web), live at
[auto-court-web.vercel.app](https://auto-court-web.vercel.app), that talks to
the contract directly. There is no server, database, queue or key behind
it:

- **Reads** go from the visitor's browser straight to Studio Next, typed and
  paced under the RPC's measured limit of 30 contract reads a minute per IP.
  Every page renders from the contract's own views, so what you see is the
  record, not a copy of it.
- **Writes** are signed by the connected wallet. Each one sizes its fee
  deposit, surfaces a refusal in the contract's own words before anything is
  signed (asking again if the network drops the check, and only then pricing
  the write without it, when the chain refuses it instead), confirms by
  reading the record back, and says "finalized" only when the transaction
  reports it.
- **Evidence never leaves your browser as a file.** It is read, fingerprinted
  and redacted there; what you publish is the text you reviewed, both
  fingerprints, your typed readings and your wallet's signature over them.
- **Independent sources are one click for the common case.** The record page
  fills in NHTSA's recall list for the listed make, model and year, and
  fingerprints it the way the validators will render it.
- **Test GEN** for fees comes from the wallet menu, which asks Studio Next's
  faucet for the connected address.

The screens: the records list, list a vehicle, the record (claims and
disputes, evidence, independent sources, the next step), the verdict report,
claim-by-claim evidence with quotes, the intake receipt, and the appeal. Every
act a wallet cannot take on a record is shown with the contract's reason in
words, and each upload card says how many intake slots that wallet's side has
left.

AutoCourt was first built full stack, with an operator wallet sending every
transaction through a job queue. The rebuild as a dApp (14 Sep) removed the
operator, which exposed that the contract accepted writes from any wallet;
the contract was redeployed the same day with every write bound to its signer,
and again on 15 Sep, when a live control showed that a scanner report listing
a fault code could raise the diagnostic flag on its own.

## What the contract owns, and what it refuses to

Each party extracts, redacts and signs their own evidence and writes it from
their own wallet; that part is the party's testimony, made attributable by the
signature and tamper-evident by dual hashes in the sealed manifest. Everything
downstream is consensus:

- **Every write is the signer's.** The seller of record, each uploader, each
  disputer, each appellant and the wallet that asks for each independent
  source is the wallet that signed the transaction; a claimed account that
  differs is refused in words. Only the seller seals. Only a recorded party
  (the seller, a disputer, an uploader or a source's requester) can ask for
  the panel, add appeal evidence or appeal. Intake slots are split by side:
  the seller owns 5 of the 8 before sealing and every other wallet shares 3,
  and each appeal's 4 split 2 and 2.
- **The contract checks the listing's core claim itself.** Before a record
  exists, every validator decodes the VIN at the public federal registry
  (NHTSA vPIC) and must agree on what it read. This is the one fact on an
  AutoCourt record that no party supplies, and it runs on every assessment.
  A mismatch caps every claim below `VERIFIED` and takes the headline; an
  unreachable or undecodable registry is recorded as absence, never as an
  accusation.
- **Evidence is corroborated where it enters the record.** Uploaded text
  arrives as calldata with its hash recomputed at entry by every validator;
  independent sources are fetched by every validator itself, from a host the
  contract parses strictly before it checks the allowlist. No leader-private
  byte exists anywhere. "Add an independent source" is the only path to
  `VERIFIED`.
- **Uploaders attest to their own bytes.** The uploading wallet signs both of
  an item's hashes, and the signature sits on the public record beside them.
  The app checks it on every view, and anyone can repeat the check from
  chain data alone. Unsigned items are shown AS unsigned.
- **The model returns findings; code derives every verdict.** The panel
  outputs per-claim, per-item findings with quotes that must ground
  word-token-wise in the recorded text. Deterministic code, run identically
  inside every validator, derives the corroboration class of every edge,
  every claim verdict, the flags, the rollup, confidence and next action.
- **Floors key on attributes, never names.** A claim backed only by its own
  side's uploads cannot reach `VERIFIED`; an accusation resting only on the
  accuser's uploads cannot become `CLAIM_CONTRADICTED`; neither side's own
  uploads can turn an independent source into a conflict; the rollback flag
  needs two distinct wallets or an independent source; and a stored trouble
  code raises the diagnostic flag only when the evidence describes an effect
  of the fault, never because a document names the code.
- **Appeals re-read the recorded bytes.** Recorded items are referenced by id
  and read from contract storage: there is no parameter through which
  replacement bytes could travel, and a source is never refetched. Prior runs
  are immutable.
- **Verdict-shopping is unrepresentable.** A second adjudication of an
  unchanged packet is refused; a re-judgment is only reachable as a recorded,
  attributed, capped appeal.

## The verdict model

| kind | values |
|---|---|
| claim verdicts (one per claim) | `VERIFIED` · `PARTIALLY_VERIFIED` · `CLAIM_CONTRADICTED` · `CONFLICTING_EVIDENCE` · `INSUFFICIENT_EVIDENCE` · `PHYSICAL_INSPECTION_REQUIRED` · `INCONCLUSIVE` |
| code-derived flags | `mileage_conflict` · `odometer_rollback_indicated` · `diagnostic_concern_supported` · `vehicle_identity_mismatch` |
| assessment rollup (fixed precedence) | identity mismatch ≻ `POSSIBLE_ODOMETER_ROLLBACK` ≻ `MILEAGE_CONFLICT` ≻ `MATERIAL_CONCERN` ≻ `DIAGNOSTIC_CONCERN_SUPPORTED` ≻ … |
| statuses, never verdicts | `SOURCE_UNAVAILABLE` (an independent source, or the registry, all validators agreed was gone or did not match) |
| identity, from the registry | `CONFIRMED` · `MISMATCH` · `UNDECODABLE` · `SOURCE_UNAVAILABLE` |

Corroboration ladder, derived in-contract per (claim, item, direction) edge:
`INDEPENDENT` (every-validator fetch) > `ADVERSE` (recorded opposing stake,
distinct wallet) > `FIRST_PARTY`. Items from one wallet are one voice.
`VERIFIED` requires `INDEPENDENT`.

## Lifecycle

```
seller opens ──► evidence enters ──► disputes recorded ──► SEAL
 (claims; VIN    (per-item writes in   (in the disputer's    (seller only;
  decoded by      the signer's name,    own name)             manifest root
  every           slots split by side;                        recomputed over
  validator)      sources fetched by                          stored items)
                  every validator)                                 │
                                                                   ▼
        appeal ◄── ADJUDICATED ◄───────────────────────────── panel round
   (a recorded party;   │                            (asked for by a recorded
    new items tagged;   ├──► report · claim-by-claim ·  party; findings +
    recorded bytes      │    intake receipt             grounded quotes;
    re-read; ≤4 runs)   ▼                               verdicts in code)
                  the standing verdict names its run AND the total
```

## Live on the deployment of record

Six proofs, run 15 Sep 2026 through the same modules the browser runs, with
fresh wallets funded from the faucet:
`cd web && AUTOCOURT_LIVE=1 npx vitest run tests/live/<file>`. Every row
below is an assertion its test fails without, unless it is marked
*observed*. Every transaction listed FINALIZED under `MAJORITY_AGREE`, and in
none of them did a voting validator disagree. Explorer:
`https://explorer-studio-dev.genlayer.com/tx/<hash>`.

### A claim against NHTSA's recall list

`ac-000002`, [`web/tests/live/recall-record.test.ts`](web/tests/live/recall-record.test.ts).
The seller lists a 2003 Honda Accord and declares *"No safety recall has ever
been issued for the 2003 Honda Accord"*. A buyer's wallet disputes it and asks
every validator to fetch NHTSA's recall list for that make, model and year —
a record neither party wrote.

| step | who signs | asserted | tx |
|---|---|---|---|
| open the record | seller | the registry confirms the listed vehicle; the seller of record is the signing wallet | `0xc3626c92fb730cbac4e3acdf9e47ba268108a084ddb6d6dca97401b37b53c4d8` |
| dispute the claim | buyer | recorded in the buyer's name | `0x0fb2a0f9f6bccb98736930861aaa40e47001f4c9817f97879186b59e4dcd7416` |
| NHTSA's recall list | buyer | `api.nhtsa.gov/recalls/recallsByVehicle?make=Honda&model=Accord&modelYear=2003` enters `EXTRACTED` under the fingerprint the app took over the rendered page (`5b463894…efc7690`); the stored text hash recomputes; `added_by` is the buyer | `0x8900ac8f6d8c0b4838ef9671af1478faaf99d80e207ae1e9b506dfc4c0e9ac69` |
| seal | seller | the root the app computed is the sealed manifest's | `0xbc9ba2bf2e96884d6922cd0caea2bc65aa31ec2f7e0e85b76b9c5c38a3f19238` |
| adjudicate | buyer, a recorded party | **`CLAIM_CONTRADICTED` / HIGH** on `INDEPENDENT` evidence; next action raise it with the seller; headline `MATERIAL_CONCERN` | `0x15422bbdb11479a0b5aa3ed492282d9e380b23e5c986c441e2dc5d28ad8ca5b1` |
| the seller's signed declaration | seller | enters as appeal evidence, judged at packet version 2 | `0x166b50f684b86cee5b82d361a846be40008a2815b371604fa9246e9c173312c1` |
| appeal | seller | run 2 is an appeal in the seller's name; the NHTSA entry in the manifest is unchanged, so the appeal judged the recorded bytes; the claim **stays `CLAIM_CONTRADICTED`** on `INDEPENDENT` evidence | `0x01aae173aa866049ba8972264885374d803c66d81d44c17494ff787d3aadd362` |

*Observed*: the appeal panel read the seller's declaration as support
(`FIRST_PARTY`). Under an earlier ruleset those findings derived
`CONFLICTING_EVIDENCE`: a seller could answer a public recall list with their
own paperwork. That asymmetry was found while designing this proof and fixed
([PROBE-REPORT](docs/PROBE-REPORT.md#signed-writes-and-the-floor-the-recall-proof-found-14-sep)).

### A possible odometer rollback

`ac-000003`, [`web/tests/live/rollback-record.test.ts`](web/tests/live/rollback-record.test.ts).
The seller's March invoice reads 87,432 miles. A buyer's wallet uploads an
auction export dated May, two months later, reading 62,000, and disputes the
mileage claim.

| step | who signs | asserted | tx |
|---|---|---|---|
| open the record | seller | the registry confirms the listed 2003 Honda Accord | `0xa2bf30fed82beb30e687f6a02bd873594139b6c0d99b51a51f61b5a1cb803dd4` |
| March invoice, 87,432 miles typed in | seller | recorded in the seller's name, its reading a typed row | `0xd1b56037ea835fb89289a9fff7712c8bd6f8b6db0f7712a191b097cdaab011f8` |
| May auction export, 62,000 miles typed in | buyer | recorded in the buyer's name, its reading a typed row | `0x7d7c3b6aa6dbf9e0b94b82c7370831925ebb08dbf226b076113bcb296d9b5e7f` |
| dispute the mileage claim | buyer | recorded in the buyer's name | `0xeb4584411fe212d180355fa87973a96d2df3ef65da17b19a7b4a0a32c860798e` |
| seal | seller | sealed | `0xae61c9c8911bb6b537cf7bb212aeea3549546b07e3e7c5c036d2bd7350e23f1d` |
| adjudicate | buyer | the code computes the mileage conflict from the typed rows; the panel finds nothing in the record that explains it (`NOT_EXPLAINED`); with the readings from two wallets, `odometer_rollback_indicated` is raised and the headline is **`POSSIBLE_ODOMETER_ROLLBACK`**; the claim is neither `VERIFIED` nor `CLAIM_CONTRADICTED` | `0xc918ca3fcd43ba7242731fda90efbf5fad32721d8a010d04bbdade2c17680513` |

*Observed*: the mileage claim derived `PHYSICAL_INSPECTION_REQUIRED` / LOW,
with each side's own paperwork on it, one for and one against.

### A trouble code, with and without an effect

`ac-000004` to `ac-000006`, [`web/tests/live/diagnostic-record.test.ts`](web/tests/live/diagnostic-record.test.ts).
Three records that differ in one document: a buyer's pre-purchase scanner
report carrying the same stored code, P0128, typed in as a trouble code. A
stored code is never meant to be a defect on its own; the flag needs the
evidence to describe an effect of the fault.

| record | the scanner report | asserted | adjudication tx |
|---|---|---|---|
| `ac-000004` | the code, and a road test on which the gauge stayed low, the heater blew lukewarm and the warning light was on | the contract stores the code normalized (`p0128` → `P0128`) in the buyer's name; **`diagnostic_concern_supported`**, headline **`DIAGNOSTIC_CONCERN_SUPPORTED`**, no claim adverse | `0xb183e959e55a07a35becc813b90bab83f4b470d0bc5226f55930f486c3a6713a` |
| `ac-000005` | the same code, and a road test on which everything read normally | the flag is **not** raised | `0x61ea5d780c28ed922764dddbe1a5131f2ba90700cf674913ec80ea75d5e450cf` |
| `ac-000006` | the code and its definition, nothing else | the flag is **not** raised | `0xccbeefec3596be42a3ed85bb4969921adaf74f1c4bac342000556767511daf2b` |

The second record is the one that failed before: on the previous deployment
the same report raised the flag, with every voting validator agreeing. `autocourt-rules-5` tells the panel that only an observed
effect counts, and refuses in code any support quote that names the code
([PROBE-REPORT](docs/PROBE-REPORT.md#the-diagnostic-flag-a-normal-road-test-raised-15-sep)).

### A record at its run limit

`ac-000007`, [`web/tests/live/run-limit.test.ts`](web/tests/live/run-limit.test.ts).
One adjudication and three appeals, each after something new, and then the
limit.

| step | who signs | asserted | tx |
|---|---|---|---|
| open, invoice, seal | seller | the registry confirms the vehicle; the packet seals | `0xbe92e8922c6d191a2760df8e976ee1047a7f46975e578f4d32bf1d625c315a0e` · `0x3930db18f313ba62633cb29d35b69795951806149ddf293f512a399ff1e96aab` · `0x850498ab285c8b5f284074972b552a09b80062861377287624db5dac20c7bd4c` |
| run 1 | seller | an adjudication over packet version 1 | `0x5583ee276ea99e0cd561b42735aa71367c615ed2f903ca0a80629bea25665853` |
| ask the panel again, same packet | seller, sent without simulation | refused on chain: `[EXPECTED] run 1 already judged this exact packet; a re-judgment is an appeal (readjudicate)`; still one run | `0x9b98dacacc0914234cf8b0ad0a2939cd2c01e9188d0617d51f9a7496c6baa7f5` |
| a fresh dispute, then run 2 | buyer | an appeal in the buyer's name over packet version 2 | `0xd4f700033d492a5ec324042562dd0f5ca71f59cf5429339bfc2107fa2981f17e` · `0xca5d550c534f30ba03f3d213151b74bfa5d1a32de43814a178957408f576b238` |
| a fresh dispute, then run 3 | buyer, then seller | an appeal in the seller's name over version 3 | `0xe44c5c10034657e6ef88a6282312cb6bf5b06e09d59b45363645680552875e9d` · `0x0b11a17c8fff48d9d84f66b215da7f4b0b128d3faea73cb1e6e4f1414e59fe4b` |
| a fresh dispute, then run 4 | buyer | an appeal in the buyer's name over version 4 | `0x5e0a42c9ef12013f12b30244df927f54202988f0cd8eb37f34edcccd4b5fa94a` · `0x598563d49e6e9e9fd6287abc8fdb03b87d2d255c17affa94074dbe094f843033` |
| a fresh dispute, then a fifth run | buyer, the fifth sent without simulation | the app offers the appeal to neither party, saying the verdict is final; the contract refuses it on chain: `[EXPECTED] the record holds at most 4 runs`; still four runs, standing run 4 of 4; run 1 reads back byte for byte | `0x1ed695fb64ca63b29fb079609ed3647a9006d0dcac8eb64c10a81577a57d8eed` · `0xf53e55e27e83726e1c90cd554aecd66269e97a764eaf78a8b3bd45a207b8e9fa` |

*Observed*: all four runs headlined `PARTIALLY_VERIFIED`: the seller's own
invoice supports the claim, and nothing independent does.

### The wallet walls

`ac-000009`, [`web/tests/live/signer-walls.test.ts`](web/tests/live/signer-walls.test.ts).
A stranger's wallet sends each forbidden write straight to the chain, priced
with the plain fee estimate and never simulated, so nothing but the contract
stands in its way. Each one FINALIZED with the leader's execution in `ERROR`
and the contract's own sentence, decoded from the leader receipt:

| the stranger tries to | the contract's sentence | tx |
|---|---|---|
| open a record naming the seller's wallet as seller | `[EXPECTED] seller_account must be the wallet that signs this transaction` | `0xe1d4fcb430083ca85aabb72b4480519bb8c14804b1d673b803bd5a2b0bc87ef0` |
| dispute a claim in another wallet's name | `[EXPECTED] the disputing account must be the wallet that signs this transaction` | `0xcecdf24a8dbc09d681625b83e239d2556b2575f3b8f111baf44d90eead2cbc0a` |
| upload a document attributed to the seller | `[EXPECTED] uploader_account must be the wallet that signs this transaction` | `0x9c8ba4762c03f758212936b92e9d5f67831c45ec6133a3532d4c22adc46e4da8` |
| add a source at `https://raw.githubusercontent.com:x@evil.example/…` | `[EXPECTED] anchor url must name a plain host` | `0x2f1cf20294b69e32c50f71f52ea1cfa2a76e699de8f6e35e80c33137617f08d2` |
| seal the seller's packet | `[EXPECTED] only the seller of record can seal the packet` | `0x302b0889d530abcdc27a2aab8fdf69a0eb3df1334e18a404ffd8969fc1928416` |
| ask for the panel with no part in the record | `[EXPECTED] only a recorded party may request adjudication` | `0xd2e07ed9682582c011ad50764a7327012cf4f7ff074f4c3d73e0831141ef9dcf` |

Also asserted: no refused write changed the record (no new assessment, no
item, still `OPEN`, still no run), and the app's own path stopped the same
seal in its fee simulation with the contract's sentence and sent nothing.

The positive controls, and the record's identity:

| step | who signs | asserted | tx |
|---|---|---|---|
| open the record | seller | the VIN is a real motor coach's, listed as a 2019 Meridian GT Wagon: every validator's registry read is `MISMATCH` (1989 MOTOR COACH INDUSTRIES) | `0xb9f9f05e982ada4a1821eca6b6890554cd8c4b40c849300135c520fb6c6147a9` |
| the seller's invoice | seller | enters in the seller's name | `0x8437a39c16934a90dcbeb2bc3fc2c5460aac8d5936973d7e4d28cf64587250c4` |
| seal | seller | sealed | `0xcdad36c476e03b9710cf2309ff38fb66e3c1587bcaeeac21e00761d9705b2303` |
| dispute, in its own name | stranger | recorded under the stranger's own wallet, which makes it a party | `0x28e04b28cdbf9c2550ba779c681005b231c1084688b7c8270e72e84e646fee51` |
| adjudicate | the same stranger | the request refused above goes through; `vehicle_identity_mismatch` raised, headline `MATERIAL_CONCERN`, no claim `VERIFIED` | `0xb454cd54b4526be34d80cc5a329e59f21d3540328359398f642be10458b47f2d` |

`ac-000008` was opened by a first run of this proof that passed the first four
walls and then stopped. The network dropped the app's simulation of the
stranger's seal, the app priced that write without it and sent it, and the
contract refused it on chain
(`0x063bff72d867022fcc14624382b1093a3d4aa45cff246efd8709fee4052e6354`). The
refusal belonged before the wallet, so the app now asks a dropped simulation
again before it sends anything unchecked. That record remains on chain,
unfinished.

### A clean record

`ac-000001`, [`web/tests/live/clean-record.test.ts`](web/tests/live/clean-record.test.ts).
The case a buyer hopes to find.

| step | asserted | tx |
|---|---|---|
| open the record | the registry confirms the listed 2003 Honda Accord: `CONFIRMED` | `0x39339cc2a10aea072ec9c2968731e550c6fba9de53bd253392660f4e4937ff8c` |
| the seller's signed invoice | read back from the chain, the signature verifies against the on-chain hashes | `0x3802e685e7448c1bab246e612cf16026afc8c634e740cee7221e5e3732c13759` |
| this repository's registry extract | `EXTRACTED` under the rendered text's fingerprint (`4308ed17…682eb6`); the stored text hash recomputes; no uploader, `added_by` the seller | `0xd37b62bd64c3fe5286a2b7b7a21fdbf9cba7116318a2ee4b9a2c6c294fd7b210` |
| seal | the root computed in the app is the root the contract sealed | `0xe5bbeaedafc5521994109c23507dc9f0d5f9b49ef46630ca20fc78c101c9a202` |
| adjudicate | mileage claim **`VERIFIED` / HIGH**, supported by `INDEPENDENT` (and `FIRST_PARTY`), nothing against it; headline **`VERIFIED`**; no flag raised | `0x3352c28c444002fcbe1538566e8001c5b5605c6152fc418ae0aefba4b4e2e5d5` |

## The independent source, and what hashing it taught

`submit_anchor_item` is the only lane where the contract fetches: every
validator reads the page itself, and the item enters only if the bytes it
hashed match the fingerprint the adder committed.

**The finding.** GenVM's `render(url, mode="text")` does not return a text
file's raw bytes. Its webdriver takes the page's `innerText` and normalizes
whitespace line by line (read from the GenVM source, function
`normalizeWhitespace`). The registry extract committed to this repository has
its readings in columns separated by two spaces, so a fingerprint taken over
the raw file can never match what a validator hashes:

| fingerprint taken over | sha256 | on the deployment of record |
|---|---|---|
| the file's raw bytes | `83a9bc85…fb0e3` | no validator computes it, so a source committed under it enters `SOURCE_UNAVAILABLE` and is never judged |
| the text every validator renders | `4308ed17…682eb6` | the clean record's source entered **`EXTRACTED`** under it (`ac-000001`, tx `0xd37b62bd…7b210`) |

The file is commit-pinned
([`fixtures/registry/1HGCM82633A004352.txt`](fixtures/registry/1HGCM82633A004352.txt)
at `76a39ee`, a fictional extract the fixture's README explains). The app
fingerprints what the validators will render
([`web/lib/evidence/anchor.ts`](web/lib/evidence/anchor.ts)), and a unit test
pins that function to the digest above. Before NHTSA's host went on the
allowlist, a disposable probe had every validator render this file and
NHTSA's recall list and agree, and the same function reproduced every digest
([PROBE-REPORT, "The render probe"](docs/PROBE-REPORT.md#the-render-probe-14-sep-can-every-validator-read-a-real-authority)).

## Running it

```bash
cd web
npm ci
npm run dev
```

Open `http://localhost:3000` with a browser wallet (MetaMask or any EVM
wallet). The app adds GenLayer Studio Next to the wallet when you connect, and
the wallet menu gets you test GEN. No environment variables are needed: the
deployment of record is the default, and
[`web/.env.example`](web/.env.example) shows the `NEXT_PUBLIC_*` values that
override it.

## Deploying it

Vercel, with the project's **Root Directory set to `web`**. No environment
variables and no secrets are required; the build is `next build`, and CI runs
the same `npm ci` and build on every push.

## Tests

| suite | count | what it proves |
|---|---|---|
| `pytest tests/direct` | 161 | the whole contract against a runtime-strict stub: every write bound to its signer and each wall named (seal, adjudication, appeal evidence, appeal, slots by side, URL smuggling), floors in both directions including the mirror floor, walls, appeals, forged-leader replays (a fabricated-but-consistent dossier is refused because its quotes do not ground), every equivalence lesson pinned in both directions — decision cut, sufficiency materiality, citation materiality, explanation shadings — and the independent identity check and uploader attestation, and the diagnostic flag's rule that only an observed effect of a fault counts. Mutation-checked: the signer walls (14 of 14 mutants killed), the mirror floor (6 of 6) and the diagnostic rule (8 of 8) |
| `cd web && npm run test` | 94 | the browser's half: the independent-source fingerprint pinned to the digest validators computed on chain, each rule of GenVM's whitespace normalization, and code-point capping; NHTSA's recall URL encoded so no listing's words can move it; the manifest root against a golden from the contract's own function; act availability across states × roles (S40) mirroring the contract's signer and slot rules, with every limit read from `get_config()` (13 of 13 mutants killed); the write lifecycle against a fake client — a refusal stopped in the simulation with the contract's sentence and nothing sent, a simulation the network dropped asked again before anything is sent unchecked (3 of 3 mutants killed), a finalized refusal and an undetermined round reported as such, no finality claimed that was not seen, no zero deposit; read pacing under the RPC's limit; VIN, OBD-II and mileage code; extraction honesty; the chain helpers |
| `AUTOCOURT_LIVE=1 npx vitest run tests/live` | 6 live | the recall record, the rollback, the trouble code with its two controls, the run limit, the wallet walls and the clean record on the deployment of record (above), skipped without the flag; `AUTOCOURT_CONTRACT` points them at a disposable deployment first |
| `npm run verify` | gate | one contract address in the app's default, `web/.env.example` and this README |
| `genvm-lint` | clean | AST-level GenVM validity |

## The docs

[ARCHITECTURE.md](docs/ARCHITECTURE.md) — what is built ·
[STANDARDS-MAP.md](docs/STANDARDS-MAP.md) — why it must be built that way ·
[THREAT-MODEL.md](docs/THREAT-MODEL.md) — eliminated / detectable / honest limits ·
[PROBE-REPORT.md](docs/PROBE-REPORT.md) — the measurements ·
[design-review-findings.md](docs/design-review-findings.md) — the 38 pre-code
findings this build answers

## Honest limits

- **Evidence is public, permanently.** Redaction happens before publishing,
  because afterwards it is impossible; the publish step says so and requires
  an acknowledgement.
- **The buyer side is first come, first served.** The 3 intake slots every
  non-seller wallet shares, and the 8 disputing accounts, can be filled by
  wallets a seller controls before a genuine buyer arrives. That forges no
  one's name and changes no derivation, but it can keep a buyer's evidence
  out of the first packet; the seller also decides when intake closes.
- **Make matching is deliberately forgiving** ("Mercedes" matches
  "MERCEDES-BENZ"), because a false mismatch accuses an honest seller. An
  abbreviation the registry does not share, "VW" against "VOLKSWAGEN", reads
  as a mismatch, which is why a mismatch caps a claim rather than alleging
  fraud.
- **What counts as a fault's effect is still the panel's reading.** The code
  refuses a support quote that names a recorded code; it cannot tell a
  paraphrase of the code's meaning from a real symptom. The question the panel
  is asked closes that gap in practice, as the two live controls show, not by
  construction.
- **Wallets are self-attested identity**; the contract's floors, not a login,
  make a second wallet worthless.
- **A recall list speaks for a model year, not a car.** NHTSA's list can
  contradict "no recall was ever issued for this model"; it cannot say
  whether one car's recall was remedied. Every validator hashes the first
  8,000 characters of a source and the panel reads the first 6,000, so a
  long list is judged in part.
- **Extraction reads plain text and PDFs with embedded text.** Scans and
  images enter as fingerprints with no text, and the panel is told so.
- **Commit-pinned GitHub raw stands in for registries** no public API serves,
  and its registry extract is fictional; a production deployment would list
  actual registries beside NHTSA.
