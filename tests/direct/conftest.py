"""Direct-mode harness: the real contract module run against a stub
`genlayer` that is AS STRICT AS the runtime where it matters — DynArray
refuses user construction, validator functions actually run, and a
validator returning False surfaces as a failed round rather than a settled
state.

The stub mirrors the v0.6 SDK the contract targets (`import genlayer as
gl`, `gl.contract.Contract`, `gl.storage.*`, `gl.vm.run_nondet`, UserError
carrying its text in `.data`).

Three things are mocked with intent:

  THE WEB. `gl.nondet.web.render(url)` answers from a page table the test
  fills (`page(url, text)`); a URL not in the table is unreachable, and
  `page_once` serves a page to the leader and then goes dark, so a test
  can force a reachability split. Every fetch is LOGGED (`fetches()`), so
  a test can prove an appeal read the stored record and did NOT refetch.

  THE PANEL. Successive exec_prompt calls walk a queue and the last entry
  repeats, so a test can hand the leader and the validator different
  answers and prove the comparison logic notices.

  THE LEADER. `forge_leader(value)` makes the next run_nondet present a
  fabricated leader result to the validator INSTEAD of running the leader
  function — the forged-leader replay that proves a validator refuses a
  result its own work does not corroborate.
"""

import importlib.util
import json
import pathlib
import sys
import types

import pytest

CONTRACT_PATH = (pathlib.Path(__file__).resolve().parents[2]
                 / "contracts" / "autocourt_assessment.py")

SELLER_ADDR = "0x1111111111111111111111111111111111111111"
BUYER_ADDR = "0x2222222222222222222222222222222222222222"
STRANGER_ADDR = "0x5555555555555555555555555555555555555555"

# Every account the contract records is the wallet that signed the write, so
# the fixtures' accounts ARE the wallets that send.
SELLER = SELLER_ADDR
BUYER = BUYER_ADDR


def account(n):
    """A distinct wallet address for the n-th extra party."""
    return "0x" + format(0xA000 + n, "040x")

# The published ISO 3779 example VIN whose check digit is X.
VIN = "1M8GDM9AXKP042788"

REG_HOST = "registry.example.gov"
REG_URL = f"https://{REG_HOST}/vin/{VIN}"
REG_PAGE = ("NATIONAL VEHICLE REGISTRY EXTRACT. VIN 1M8GDM9AXKP042788. "
            "Registered mileage reading 87,401 miles recorded 2026-02-10. "
            "No accident flag on file for this vehicle.")

SVC_TEXT = ("SERVICE INVOICE 2026-03-07. Vehicle VIN 1M8GDM9AXKP042788. "
            "Odometer reading 87,432 miles at service. Replaced front "
            "brake pads and rotors. Next service due at 92,000 miles.")
HIST_TEXT = ("VEHICLE HISTORY RECORD. No accident records found for this "
             "vehicle. Odometer reported 86,900 miles on 2026-01-15. Two "
             "previous owners on record.")

# The public VIN registry the contract decodes at creation. Tests set the
# answer; by default the demo VIN decodes consistently with the listing.
def registry_url(vin=None):
    return ("https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/"
            f"{vin or VIN}?format=json")


_PAGES = {}
_ONCE = {}
_DEAD = set()
_FETCHES = []
_PANEL = []
_PANEL_CALLS = [0]
_PROMPTS = []
_FORGED = []
_DOWNGRADES = []
_DISAGREEMENTS = []


class _UserError(Exception):
    """v0.6 shape: the text lives in .data; str() returns it so that
    pytest.raises(match=...) reads the message."""

    def __init__(self, data):
        super().__init__(data)
        self.data = data

    def __str__(self):
        return str(self.data)


class _VMError:
    def __init__(self, message):
        self.message = message


class _Return:
    def __init__(self, calldata):
        self.calldata = calldata


def _run_nondet(leader_fn, validator_fn):
    """gl.vm.run_nondet: the leader runs (or a forged result stands in);
    the validator sees Return(value) or the leader's UserError and answers
    a bool. False (or an escaping exception) is a disagreement — the round
    fails and nothing is written."""
    if _FORGED:
        forged = _FORGED.pop(0)
        try:
            ok = validator_fn(_Return(forged))
        except Exception:
            ok = False
        if not ok:
            raise _UserError(
                "[LLM_ERROR] validators did not agree with the leader")
        return forged
    try:
        value = leader_fn()
    except _UserError as e:
        try:
            agreed = validator_fn(e)
        except Exception:
            agreed = False
        if agreed:
            raise _UserError(e.data)
        raise _UserError(
            "[LLM_ERROR] validators disagreed with the leader's failure")
    except Exception as e:
        try:
            agreed = validator_fn(_VMError(str(e)))
        except Exception:
            agreed = False
        if agreed:
            raise _UserError(str(e))
        raise _UserError(
            "[LLM_ERROR] validators disagreed with the leader's failure")
    try:
        ok = validator_fn(_Return(value))
    except Exception:
        ok = False
    if not ok:
        raise _UserError("[LLM_ERROR] validators did not agree with the leader")
    return value


class _TreeMap(dict):
    def __class_getitem__(cls, item):
        return cls

    def get(self, k, default=None):
        return super().get(k, default)


class _U256(int):
    def __new__(cls, v):
        return super().__new__(cls, int(v))


class _DynArrayMeta(type):
    def __getitem__(cls, item):
        return cls


class _DynArray(list, metaclass=_DynArrayMeta):
    """Refuses user construction exactly like the runtime."""

    def __init__(self, *args, **kwargs):
        raise TypeError("this class can't be instantiated by user")

    @classmethod
    def _from_storage(cls, items=()):
        obj = list.__new__(cls)
        list.__init__(obj, items)
        return obj


class _Address(str):
    def __new__(cls, v):
        return super().__new__(cls, str(v))


class _ViewDeco:
    def __call__(self, fn):
        return fn


class _WriteDeco:
    payable = staticmethod(lambda fn: fn)

    def __call__(self, fn):
        return fn


class _Public:
    view = _ViewDeco()
    write = _WriteDeco()


class _NondetWeb:
    @staticmethod
    def post(url, body=None, headers=None):
        raise AssertionError(f"unexpected POST: {url}")

    @staticmethod
    def get(url, **kw):
        raise AssertionError(f"unexpected GET: {url}")

    @staticmethod
    def render(url, mode="text"):
        _FETCHES.append(url)
        for dead in _DEAD:
            if dead in url:
                raise RuntimeError("source unreachable")
        if url in _ONCE:
            remaining = _ONCE[url]
            if remaining["serves"] > 0:
                remaining["serves"] -= 1
                return remaining["text"]
            raise RuntimeError("source unreachable")
        if url in _PAGES:
            return _PAGES[url]
        raise RuntimeError("source unreachable")


def _exec_prompt(prompt, response_format=None):
    _PROMPTS.append(prompt)
    if not _PANEL:
        raise AssertionError("test ran the panel without panel_says()")
    idx = min(_PANEL_CALLS[0], len(_PANEL) - 1)
    _PANEL_CALLS[0] += 1
    answer = _PANEL[idx]
    if isinstance(answer, BaseException):
        raise answer
    return answer


def _print_hook(*args, **kwargs):
    line = " ".join(str(a) for a in args)
    if "[DOWNGRADE]" in line:
        _DOWNGRADES.append(line)
    if "[DISAGREE]" in line:
        # The contract prints the reason at every refusal point; a test
        # that cannot read them debugs a split by guesswork.
        _DISAGREEMENTS.append(line)


def _install():
    gl = types.ModuleType("genlayer")
    gl.IS_IN_VM = False
    gl.public = _Public()
    gl.contract = types.SimpleNamespace(Contract=type("Contract", (), {}))
    gl.storage = types.SimpleNamespace(TreeMap=_TreeMap, DynArray=_DynArray,
                                       allow=lambda cls: cls)
    gl.vm = types.SimpleNamespace(UserError=_UserError, VMError=_VMError,
                                  Return=_Return, run_nondet=_run_nondet)
    gl.nondet = types.SimpleNamespace(web=_NondetWeb(),
                                      exec_prompt=_exec_prompt)
    gl.message = types.SimpleNamespace(sender_address=SELLER_ADDR, value=0)

    gl_types = types.ModuleType("genlayer.types")
    gl_types.u256 = _U256
    gl_types.Address = _Address
    gl_types.__all__ = ["u256", "Address"]
    gl.types = gl_types

    sys.modules["genlayer"] = gl
    sys.modules["genlayer.types"] = gl_types
    return gl


def _load():
    _install()
    spec = importlib.util.spec_from_file_location(
        "autocourt_contract", CONTRACT_PATH)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.print = _print_hook  # [DOWNGRADE] lines are assertable
    return m


@pytest.fixture
def module():
    return _load()


def _fresh_instance(module, allowlist):
    inst = module.AutoCourtAssessment.__new__(module.AutoCourtAssessment)
    for name in ("assessments", "items", "item_index", "disputes",
                 "manifests", "runs", "counters"):
        setattr(inst, name, _TreeMap())
    inst.assessment_ids = _DynArray._from_storage()
    inst.anchor_allowlist = _DynArray._from_storage()
    inst.__init__(json.dumps(allowlist))
    return inst


@pytest.fixture
def c(module):
    """A contract with the registry host allowlisted (VERIFIED reachable)."""
    _reset()
    return _fresh_instance(module, [REG_HOST])


@pytest.fixture
def c_bare(module):
    """A contract with an EMPTY allowlist (VERIFIED honestly unreachable)."""
    _reset()
    return _fresh_instance(module, [])


def _reset():
    _PAGES.clear()
    _ONCE.clear()
    _DEAD.clear()
    _FETCHES.clear()
    _PANEL.clear()
    _PANEL_CALLS[0] = 0
    _PROMPTS.clear()
    _FORGED.clear()
    _DOWNGRADES.clear()
    _DISAGREEMENTS.clear()
    page(REG_URL, REG_PAGE)
    registry_says()


# ── helpers ──────────────────────────────────────────────────────────────────

def as_(module, who):
    module.gl.message.sender_address = who


def err(module):
    return module.gl.vm.UserError


def page(url, text):
    _PAGES[url] = text


def registry_says(make="MERIDIAN", model="GT Wagon", year="2019",
                  body_class="Wagon", plant="UNITED STATES (USA)",
                  vehicle_type="PASSENGER CAR", error_code="0", vin=None):
    """Register the federal registry's answer for a VIN. Defaults decode
    the demo VIN consistently with the demo listing (CONFIRMED)."""
    page(registry_url(vin), json.dumps({"Count": 1, "Results": [{
        "Make": make, "Model": model, "ModelYear": year,
        "BodyClass": body_class, "PlantCountry": plant,
        "VehicleType": vehicle_type, "ErrorCode": error_code,
        "Note": "incidental field outside consensus",
    }]}))


def registry_unreachable(vin=None):
    _PAGES.pop(registry_url(vin), None)


def page_once(url, text, serves=1):
    """Serve `text` for the first `serves` fetches, then unreachable — the
    reachability-split fixture."""
    _ONCE[url] = {"text": text, "serves": serves}


def dead(fragment):
    _DEAD.add(fragment)


def fetches():
    return list(_FETCHES)


def clear_fetches():
    _FETCHES.clear()


def prompts():
    return list(_PROMPTS)


def downgrades():
    return list(_DOWNGRADES)


def disagreements():
    """Every [DISAGREE] line a validator printed while refusing."""
    return list(_DISAGREEMENTS)


def panel_says(*answers):
    """Queue panel answers; the last repeats. Leader consumes the first,
    the validator the next."""
    _PANEL.clear()
    _PANEL.extend(answers)
    _PANEL_CALLS[0] = 0


def forge_leader(value):
    """The next run_nondet presents this fabricated leader result to the
    validator instead of running the leader function."""
    _FORGED.append(value)


def sha(text):
    import hashlib
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ── canonical fixture data ───────────────────────────────────────────────────

def vehicle(seller=SELLER):
    return {"vin": VIN, "make": "Meridian", "model": "GT Wagon",
            "year": 2019, "seller_account": seller}


def claims():
    return [
        {"type": "MILEAGE", "declared_value": "87,432 miles"},
        {"type": "ACCIDENT_HISTORY", "declared_value":
            "no recorded accidents"},
    ]


def item(eid, text, uploader=SELLER, role="SELLER",
         declared_class="SERVICE_INVOICE", observations=None,
         diagnostic_codes=None, status="EXTRACTED", file_hash=None,
         text_hash=None, label="Party document"):
    return json.dumps({
        "evidence_id": eid,
        "declared_class": declared_class,
        "declared_label": label,
        "uploader_account": uploader,
        "uploader_role": role,
        "file_sha256": file_hash or sha("original-bytes-of-" + eid),
        "text_sha256": text_hash or sha(text),
        "extractor_version": "extractor-1.0.0",
        "status": status,
        "text": text if status == "EXTRACTED" else "",
        "observations": observations or [],
        "diagnostic_codes": diagnostic_codes or [],
        "capture_date": "2026-03-07",
    })


def svc_item(eid="E-SVC", uploader=SELLER, role="SELLER"):
    return item(eid, SVC_TEXT, uploader=uploader, role=role,
                declared_class="SERVICE_INVOICE",
                observations=[{"doc_date": "2026-03-07",
                               "odometer_reading": 87432,
                               "odometer_unit": "MILES",
                               "source_field": "odometer line"}])


def hist_item(eid="E-HIST", uploader=BUYER, role="BUYER"):
    return item(eid, HIST_TEXT, uploader=uploader, role=role,
                declared_class="VEHICLE_HISTORY_RECORD",
                observations=[{"doc_date": "2026-01-15",
                               "odometer_reading": 86900,
                               "odometer_unit": "MILES",
                               "source_field": "odometer line"}])


def anchor_item(eid="E-REG", url=REG_URL, expected=None):
    return json.dumps({
        "evidence_id": eid,
        "declared_class": "EXTERNAL_SOURCE_RESULT",
        "declared_label": "National registry extract",
        "url": url,
        "expected_sha256": expected or sha(REG_PAGE),
    })


def submit_as_uploader(module, c, aid, item_json):
    """Send an uploaded item from the wallet it names, as a real client does."""
    as_(module, json.loads(item_json).get("uploader_account") or SELLER_ADDR)
    return c.submit_evidence_text(aid, item_json)


def build_assessment(module, c, items=None, disputes=None, seal=True):
    """create → items → disputes → seal. Returns the assessment id."""
    as_(module, SELLER_ADDR)
    aid = c.create_assessment(json.dumps(vehicle()), json.dumps(claims()))
    for it in (items if items is not None else [svc_item(), hist_item()]):
        submit_as_uploader(module, c, aid, it)
    for d in (disputes or []):
        as_(module, d["account"])
        c.record_dispute(aid, d["account"], json.dumps(d["claim_ids"]),
                         d.get("note", ""))
    as_(module, SELLER_ADDR)
    if seal:
        stored = [json.loads(c.items[f"{aid}|{eid}"])
                  for eid in json.loads(c.item_index[aid])]
        root = module._manifest_root(stored)
        c.submit_assessment(aid, root)
    return aid


def finding(cid, eid, status, severity="MODERATE", quotes=None):
    return {"claim_id": cid, "evidence_id": eid, "status": status,
            "severity": severity, "quotes": quotes or []}


def panel_answer(findings=None, sufficiency=None, explanations=None,
                 diagnostic=None, unresolved=None):
    """A complete, valid panel answer for the canonical two-item record:
    the service invoice supports the mileage claim, the history record
    supports both claims. Quotes ground word-token-wise in the fixture
    texts."""
    if findings is None:
        findings = [
            finding("CL-01", "E-SVC", "SUPPORTED", "MODERATE",
                    ["Odometer reading 87,432 miles at service"]),
            finding("CL-01", "E-HIST", "SUPPORTED", "MINOR",
                    ["Odometer reported 86,900 miles on 2026-01-15"]),
            finding("CL-02", "E-HIST", "SUPPORTED", "MODERATE",
                    ["No accident records found for this vehicle"]),
        ]
    return {
        "findings": findings,
        "sufficiency": sufficiency or {"CL-01": "SUFFICIENT",
                                       "CL-02": "SUFFICIENT"},
        "explanations": explanations or {},
        "diagnostic": diagnostic or {"supported": False},
        "unresolved_questions": unresolved or {
            "CL-01": "An independent registry reading would settle this.",
            "CL-02": "None material."},
    }
