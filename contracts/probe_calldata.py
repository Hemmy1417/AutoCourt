# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

# DISPOSABLE calldata probe — never the deployment of record.
#
# The design review's demand: measure the real write-argument ceiling on
# the target network BEFORE freezing get_config() bounds, on a throwaway
# deploy. This contract accepts one bounded blob per write and reads it
# back by digest, so the probe script can walk sizes upward until the
# transport refuses, then verify what the chain actually stored.

import genlayer as gl
from genlayer.types import *

import hashlib

PROBE_CAP = 64_000


class CalldataProbe(gl.contract.Contract):

    blobs: gl.storage.TreeMap[str, str]

    def __init__(self):
        pass

    @gl.public.write
    def store(self, blob: str) -> str:
        if len(blob) > PROBE_CAP:
            raise gl.vm.UserError("[EXPECTED] over the probe cap")
        digest = hashlib.sha256(blob.encode("utf-8")).hexdigest()
        self.blobs[digest] = blob
        return f"{len(blob)}:{digest}"

    @gl.public.view
    def stored_length(self, digest: str) -> int:
        b = self.blobs.get(digest)
        return len(b) if b is not None else -1
