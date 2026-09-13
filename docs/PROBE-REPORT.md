# Calldata probe report — Studio Next, 13 Sep 2026

The release gate "bounds frozen only after the probe" (STANDARDS-MAP,
release-gate table) demanded a disposable-deploy measurement of the real
write-argument envelope on the target network before `get_config()` bounds
were trusted. Run with `scripts/probe-calldata.mjs` and
`scripts/probe-stage1-retry.mjs`, from ephemeral faucet-funded accounts.
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

Not probed here: the adjudication round itself (LLM consensus). That is
the separate validator-diversity diagnostic pass, run on a disposable
deploy before the canonical one (STANDARDS-MAP §5), with `[DISAGREE]` /
`[DOWNGRADE]` stdout as its instrument.
