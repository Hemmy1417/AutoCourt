# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

# DISPOSABLE render probe — never the deployment of record.
#
# Before a new host joins the anchor allowlist, measure what validators
# actually read from it: whether every validator can reach it, whether they
# all read identical text, and what that text is. The contract anchors a
# source by hashing gl.nondet.web.render(url, mode="text"), which is not the
# raw response body, so the exact rendered text is the thing to measure.

import genlayer as gl
from genlayer.types import *

import hashlib
import json

KEEP_CHARS = 60_000


class RenderProbe(gl.contract.Contract):

    readings: gl.storage.TreeMap[str, str]

    def __init__(self):
        pass

    @gl.public.write
    def probe(self, key: str, url: str) -> str:
        def fetch() -> dict:
            try:
                raw = gl.nondet.web.render(url, mode="text")
                body = str(raw or "")
            except Exception as e:
                return {"reachable": False, "digest": "", "length": 0,
                        "error": str(e)[:300], "text": ""}
            return {
                "reachable": bool(body.strip()),
                "digest": hashlib.sha256(body.encode("utf-8")).hexdigest(),
                "length": len(body),
                "error": "",
                "text": body[:KEEP_CHARS],
            }

        def validator_fn(leaders_res) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return False
            theirs = leaders_res.calldata
            if not isinstance(theirs, dict):
                return False
            mine = fetch()
            if mine["reachable"] != bool(theirs.get("reachable")):
                print(f"[DISAGREE] reachable mine={mine['reachable']} "
                      f"leader={theirs.get('reachable')} err={mine['error']}")
                return False
            if mine["digest"] != theirs.get("digest"):
                print(f"[DISAGREE] digest mine={mine['digest']} "
                      f"leader={theirs.get('digest')} len mine={mine['length']} "
                      f"leader={theirs.get('length')}")
                return False
            return True

        out = gl.vm.run_nondet(fetch, validator_fn)
        self.readings[key] = json.dumps(out, sort_keys=True)
        return f"{key}:{out['reachable']}:{out['length']}:{out['digest']}"

    @gl.public.view
    def reading(self, key: str) -> str:
        return self.readings.get(key) or ""
