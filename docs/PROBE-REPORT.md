# Calldata probe report — Studio Next, 13 Sep 2026

The release gate "bounds frozen only after the probe" (STANDARDS-MAP,
release-gate table) demanded a disposable-deploy measurement of the real
write-argument envelope on the target network before `get_config()` bounds
were trusted. Run with `web/scripts/probe-calldata.mjs` and
`web/scripts/probe-stage1-retry.mjs`, from ephemeral faucet-funded accounts.
Both contracts below are **disposable** — neither is the deployment of
record, and nothing references them outside this report.

## Network

| | |
|---|---|
| chain | 61997 (GenLayer Studio Next) |
| rpc | `https://studio-next.genlayer.com/api` |
| probe contract | `0x17e1eCe561Ae496B12AC709c406247a83315010A` (`contracts/probe_calldata.py`) |
| disposable real deploy | `0xE71760C2097A6DBc92124ca73eECf390AB7609C9` (`contracts/autocourt_assessment.py`, empty allowlist) |

## Measurements

Raw ladder against the probe contract (`store(blob)`; each row one
write transaction, read back by digest):

| write arg size | outcome | tx |
|---|---|---|
| 8,000 chars | FINALIZED, leader SUCCESS, read-back byte-consistent | `0xa677ae5f9e9fbd02a04f13a78df353ff7aa2a6433f0f373c4ef5f8c978c8a82d` |
| 10,000 chars | FINALIZED, leader SUCCESS, read-back byte-consistent | `0xce0d51b2504d5dcb92c42859d722f6cf1fecad72a9ac2d092aa1a6bb87d39695` |

The real contract's own write shape, on its disposable deploy:

| write | outcome | tx |
|---|---|---|
| `create_assessment` (2 claims) | FINALIZED, SUCCESS | (probe log, first run) |
| `submit_evidence_text`, **6,559-char JSON argument** (6,000-char text + metadata + observation row) | FINALIZED, leader SUCCESS; `get_item_text` read back **byte-identical**; `get_config` served `per_item_text_cap: 6000` | `0xf3b382ee17ecfb7ede2491376c9ae16ed1b84d27c4905d01b17d70081b420c93` |

One first-run rung (a 2,000-char store) failed with a **local** `fetch
failed` from this machine's transport — not an RPC refusal — which is why
the ladder was re-run; the retry script hardened status polls (idempotent)
against transient HTML answers while keeping every write single-attempt.

## Conclusion

The worst-case AutoCourt write is an item entry of ~7.6KB JSON (6,000-char
text + 12 observation rows + 24 diagnostic codes + metadata). The network
finalized 8,000- and 10,000-char write arguments and the real 6,559-char
item shape with byte-identical read-back, so every bound in
`get_config()` sits inside the measured envelope with headroom. Bounds
are frozen as shipped: `PER_ITEM_TEXT_CAP 6000`, `PER_WRITE_JSON_CAP
8000` (see ARCHITECTURE §4.6).

## The validator-diversity diagnostic pass (same day)

The adjudication round was then measured the same way — on disposable
deploys, before anything canonical — and it caught a real defect:

| round | contract | tx | outcome |
|---|---|---|---|
| first attempt | `0xE71760C2…09C9` | `0xa05d867e0f0a825576eadafde13e6e61e34ac76e8d185cbbb4feb9e75512d8dd` | **UNDETERMINED · MAJORITY_DISAGREE** — validators refused the leader, and no diagnostic line said why |
| after the fix | `0x49E7Ae72dFC015ea3ea12451Bd1adb702259eC35` | `0x2860cc2f114655e43228c50fc7cd8cea088aad2d442d75cb86e1dc602e984544` | **FINALIZED · MAJORITY_AGREE · leader SUCCESS** — standing run 1, rollup PARTIALLY_VERIFIED, both claims floored at FIRST_PARTY support exactly as the deterministic spec derives |

The defect: equivalence compared judgment SHADINGS — exact severity
bands, three-way sufficiency, and the set of ABSENT rows — which model
families split on while agreeing on every decision. The fix narrowed
equivalence to the decision cut the derivation actually reads (direction
per edge, severe/not, sufficient/not, explanation states, diagnostic
bools), dropped ABSENT rows at the boundary, and added `[DISAGREE]`
prints at every refusal point so the next split names itself. Five
direct tests pin both directions: shadings never burn a round, cuts
always refuse one.

## The materiality round (the prints paying for themselves)

The first canonical deploy (`0x214821A6F32fb35CCaa2CfaAC11087850fe95555`)
opened its live arc and round 1 split again — tx
`0x82db066b54f11db7496e6b0a91b0aa23c351cf68c36815044837780ea14bc7df`,
MAJORITY_DISAGREE — and this time three validators PRINTED the reason:
`[DISAGREE] derived report differs`, with both canonical reports in the
stdout. They differed in exactly one bit: CL-01's stored
`record_sufficient` (one family judged the record sufficient, one did
not) **while every derived verdict, flag, confidence and next action was
identical**. The sufficiency cut is consulted at exactly two gates
(VERIFIED, and CONTRADICTED-vs-INCONCLUSIVE); when neither gate is live
it is immaterial metadata, and where it IS material its effect is fully
absorbed into the verdict — which is compared anyway.

Fix: the report no longer stores the raw cut, and the validator no
longer compares it separately — consensus is required on what has a
consequence, and only that. Two direct tests pin both directions
(immaterial difference survives; the same difference with an INDEPENDENT
anchor on the record moves the VERIFIED gate and refuses). A changed
contract is a new address: `0xE9d81837Ca4af3bdbCE3393556597D308f6aC6a9`
succeeded it, and `0x214821A6…5555` is recorded here as superseded.

## The citation round (the same lesson's third face)

`0xE9d81837…C6a9` carried its arc through both acts cleanly — the sale
record derived PARTIALLY_VERIFIED with every floor holding, the rollback
record derived POSSIBLE_ODOMETER_ROLLBACK from typed rows — and then the
APPEAL round split: tx
`0xbdb157ca0d4e8a3a3919b4f640a699c80c1af274aaa644d09a4e3191f9b556b1`,
UNDETERMINED · MAJORITY_DISAGREE, three validators printing
`[DISAGREE] derived report differs` with both reports in stdout. The two
reports differed in ONE token: this validator read the buyer's history
record as also supporting the mileage claim (`"supporting":
["E-HIST","E-SVC"]` vs the leader's `["E-SVC"]`) — same account voices,
same class projection, same verdict, same confidence, same rollup. The
derivation consumes citations only through the deduped CLASS projection;
a marginal citation is judgment shading with nothing derived at stake,
and the report was storing it (and the validator separately comparing
edge sets) anyway.

Fix, completing the principle: the report stores the class projections
and drops raw citation id lists (the run's stored findings keep the
citations as leader-authored panel narrative); the validator's separate
shading comparisons — edge sets, per-edge direction and severity,
explanation states, diagnostic bools — are removed, because every
consequence of every one of them flows through the derived report, which
is compared exactly and re-derived from the leader's own inputs. What
stays outside the report comparison is exactly what a rerun cannot vouch
for: every non-ABSENT leader finding must still carry quotes that ground
in the shared stored record (the fabricated-dossier gate). Four direct
tests pin both directions for citations and for explanation shadings,
and two scratch-copy mutants (old report shape; old explanation
comparison) each fail exactly their intended test.

The deployment of record is
**`0x283E59d0DaA5080Ac0DC8371B7D44f04f8163c30`** (byte-verified, source
sha256 `3aef79ec…f0d8`); `0xE9d81837…C6a9` is recorded here as
superseded, its two clean acts and its diagnosing appeal round intact on
the explorer.


## The seam pass (the pipeline bug only a running stack could catch)

With the browser journey green on an isolated database, the same flow was
driven through the API on the LIVE stack — server, Postgres, and the
drain loop against the deployment of record — and the first attempt
crashed on-chain: evidence writes arrived with `assessment_id: None`,
dying inside TreeMap lookup (`TypeError: '<' not supported between
'NoneType' and 'str'`, decoded from the leader receipt). The cause was
sequencing: the drain ran CREATE and its dependent jobs in one pass, but
the on-chain id was injected into payloads only AFTER the pass. The fix
is structural — a job that addresses the record resolves its on-chain id
from the assessment row at drain time, and if it is still unknown,
releases its lease and waits for the next pass rather than submitting a
write the contract can only crash on. (The same receipts also showed the
refusal-sentence decoder had to read `leader_receipt.result` — the arc's
lesson, swept into `packages/genlayer-client` the same day.)

Rerun after the fix, `scripts/seam-pass.mjs` (a script of the full-stack build, at commit `76a39ee`): two fresh wallets signed in
over EIP-191, listed, uploaded, disputed, consented and submitted through
the exact API the browser drives — then the drain carried every write:

| write | tx |
|---|---|
| create → `ac-000006` | `0x919ac419fc7bfebabb70fcadad11cbee308037db32e4abffd648db97db71e96a` |
| seller invoice | `0x0814e534831edb9d404f896e34c8c140400e816166618ab9cf6ee244b32ff1cd` |
| buyer history | `0x701a111d3874a952aa3d2b188789c0d5117d19eb21aaba60e9e20c13ee6178f1` |
| buyer dispute | `0x4ad284aab4cbeb64f98d4d3effdaa4334891f6e08219315bd514422214634939` |
| seal | `0x07d71766be2006800b97ca5872191b696259a11d9d7b6810b35f6439f67c46f3` |

Every job DONE, and the intake receipt confirmed the party's item inside
the on-chain manifest. `ac-000006` sits SEALED on the record — a record
created by the app's own pipeline, not by a test script talking to the
contract directly.


## The independent identity check (the answer to "is GenLayer forced here?")

The sharpest critique of this design was its own: when uploaded evidence
rides in calldata, every validator reads identical bytes, so byte
agreement is *structural* rather than earned. Private documents cannot be
fetched by validators — that part is physics — but the listing's most
basic claim can be, and now is.

`create_assessment` is nondeterministic. Before a record exists, every
validator decodes the VIN at the public federal registry
(`vpic.nhtsa.dot.gov`, free, no key) and must agree on the seven identity
fields it extracted. Only those fields cross into consensus; the decode
carries 150+, most of them empty or incidental. The endpoint was verified
fetchable and byte-stable across repeated calls before a line was
written — a VIN decode is a lookup, not a feed.

| VIN | identity fields digest | stable across calls |
|---|---|---|
| `1HGCM82633A004352` | `cff5e84294e5dc98…` | yes |
| `1M8GDM9AXKP042788` | `90bb8791bc0783c0…` | yes |

Live on `0xE26B3C4A36EC1a83Aa4814a9CA44e4b6a7EB7998`, four validators
apiece:

| listing | declared | registry | result | tx |
|---|---|---|---|---|
| honest | 2003 Honda Accord | 2003 HONDA Accord (Coupe) | CONFIRMED | `0x629fce9a7e6813096accfffe563862b105a84f11a7dc91fe9cb7c6b3d848a30d` |
| false | 2019 Meridian GT Wagon | 1989 MOTOR COACH INDUSTRIES (Bus) | MISMATCH | `0xf8180b706a3db89404156bc27b972ef37d2b6a0264898f4ea588f35505ee6c0b` |

Why this matters more than the anchor lane: anchors are optional items a
party chooses to attach, so a record without one is simply uncorroborated.
The registry check runs on **every** assessment, and it interrogates the
claimant's own core assertion. A MISMATCH caps every claim below
`VERIFIED` and takes the headline; UNDECODABLE and SOURCE_UNAVAILABLE are
recorded as absence and never behave like accusations, because a registry
outage must not indict a seller.

Four mutants were run against the new guards in a scratch copy — cap
removed, headline removed, validator no longer comparing registry fields,
signature shape unchecked — and each was killed by its intended test.

## The uploader's attestation

The second honest gap was intake: the operator authenticates, extracts and
assembles, so the packet was the operator's testimony. Now the wallet that
uploads an item signs its `text_sha256`, and the signature rides onto the
public record beside the hash it covers.

The contract cannot recover a secp256k1 address and does not need to:
because the record is public, anyone can verify forever that the bytes on
chain are the ones that account signed. Intake becomes *attributable*
rather than merely tamper-evident — the operator can still assemble a
packet, but cannot substitute a document for one a party signed. Unsigned
items are accepted and recorded AS unsigned; refusing them would trade an
honest gap for a hidden one.

What remains uncovered, permanently: a private uploaded document can never
be fetched by validators, and no amount of consensus changes that. It is a
stated limitation, not a solved problem.

## The render probe (14 Sep): can every validator read a real authority?

Adding NHTSA's recall records to the anchor allowlist freezes a host into a
deployment, so it was measured first. A disposable probe contract
([`contracts/probe_render.py`](../contracts/probe_render.py), driven by
[`web/scripts/probe-render.mjs`](../web/scripts/probe-render.mjs)) had every
validator call `gl.nondet.web.render(url, mode="text")` inside
`run_nondet` and agree on the digest of what it read, then compared that
digest with the app's own fingerprint function run over the same URL.

Probe contract `0xA0383DDDE408fC3a2C2e182ee42096F4D9F7de18` (deploy
`0xad958c76cf2ea1b300a51cd519a781b191b1d2283acb41e4e75f634759d8f1ea`). Every
round FINALIZED under MAJORITY_AGREE with the leader in SUCCESS:

| source | served | validators' rendered text | app reproduces it | tx |
|---|---|---|---|---|
| this repository's registry extract at `76a39ee` | 682 chars | 678 chars, `4308ed17…682eb6` | yes | `0xeab8968ffd4ecb5a11dbe42b8538a7fe25f5a60040331dca49df3d87bbfb8d27` |
| NHTSA `recallsByVehicle`, 2003 Honda Accord | 36,156 chars | 36,018 chars, `7da01a7c…e5888a0` | yes | `0x53829677d71434c7f9a5b85356ddcffea6f31cc76cbcb558b1163e3d1fc4c1d2` |
| NHTSA `campaignNumber` 15V320000 | 112,912 chars | 112,512 chars, `98ecc3da…438c9c78` | yes | `0x5adb6661c23b4dcdaf1600a0b5fe81003ccd9a8fb4124b0e90cd6ee9c51d0904` |

The digests here are over the whole rendered page; the contract hashes only
its first 8,000 characters, which the app's function caps identically. The
recall API answers browsers too (`Access-Control-Allow-Origin` echoes the
calling origin), so the app can take the fingerprint where the adder is.

## Signed writes, and the floor the recall proof found (14 Sep)

Two deployments followed the probe.

**`0xb13808bC01Bd6DB90e4AdEE39F2f4e0191aD0854`** (`autocourt-rules-3`, deploy
`0x5b4694b94010e8ac98098ec6f97bdf56159f6b1f7fae5a63c4a84b50ee228900`):
every recorded account bound to the signer, the seal kept with the seller,
judgment and appeal kept with recorded parties, intake slots split by side,
strict anchor host parsing, and `api.nhtsa.gov` on the allowlist. Direct
suite 152, and every new guard mutation-checked: 14 mutants, 14 killed.

Writing the recall proof exposed an asymmetry before that deployment held a
single record. The derivation stopped an accuser's own upload from turning
`INDEPENDENT` support into `CONFLICTING_EVIDENCE`, but not the mirror: support
that was only `FIRST_PARTY` against an `INDEPENDENT` contradiction derived
`CONFLICTING_EVIDENCE`. A seller could have answered NHTSA's recall list with
a signed declaration of their own and turned a contradiction into a
conflict. Fixed as one branch in `_derive_claim`, two direct tests, and six
mutants (branch removed, any first-party support, any qualifying
contradiction, no source needed, sufficiency ignored, ruleset not bumped),
all killed.

**`0x081Fe3bEb829226E0C8E95f5f81146132E9C35A7`** (`autocourt-rules-4`, deploy
`0xa7878647ddd54832d74829b730aee43320cd98a7d6fa244e3e6d25cbd435cbc8`) is the
deployment of record. Its source is byte-identical to the repository's
(sha256 `7cf6b22ce1f943c48c87b8fb1c730186288a9262949c819d802da91e9d02db28`).

The recall proof then exercised the fixed branch live. On `ac-000002`'s
appeal the leader's panel read the seller's declaration as support, and the
claim derived `CLAIM_CONTRADICTED` / HIGH with support `[FIRST_PARTY]` and
contradiction `[INDEPENDENT]`; under `autocourt-rules-3` the same findings
derive `CONFLICTING_EVIDENCE`. One of the four voting validators disagreed,
and its `[DISAGREE]` print shows why: it read the same declaration as
undercutting the claim, deriving support `[]` and contradiction
`[ADVERSE, INDEPENDENT]`. Its verdict, confidence, next action and headline
were identical to the leader's. The round finalized `MAJORITY_AGREE` (tx
`0x2bf0489fe7a6d2d4c74b7019ee7a1da98c24481d3e23c3acf5e062539d5adccc`), so
nothing was lost, but it is the citation-round lesson in a new place: the
report's class sets are inside equivalence, and a class that changes no
decision can still split a validator. Recorded here as observed, not fixed.
