"""Building the record: create, evidence entry, disputes, seal — every
bound enforced, every refusal sentence naming its rule."""

import json

import pytest

from conftest import (BUYER, BUYER_ADDR, SELLER, SELLER_ADDR, VIN,
                      as_, build_assessment, claims, err, hist_item, item,
                      sha, svc_item, vehicle)


def test_create_assessment_records_the_vehicle_and_claims(module, c):
    as_(module, SELLER_ADDR)
    aid = c.create_assessment(json.dumps(vehicle()), json.dumps(claims()))
    assert aid == "ac-000001"
    a = json.loads(c.get_assessment(aid))
    assert a["state"] == "OPEN"
    assert a["vin"] == VIN
    assert a["vin_check_digit_ok"] is True
    assert [cl["claim_id"] for cl in a["claims"]] == ["CL-01", "CL-02"]
    assert a["seller_account"] == SELLER
    assert a["seller_address"] == SELLER_ADDR


def test_malformed_vin_is_refused(module, c):
    v = vehicle()
    v["vin"] = VIN[:-1]  # 16 chars
    with pytest.raises(err(module), match="VIN must be 17"):
        c.create_assessment(json.dumps(v), json.dumps(claims()))


def test_vin_with_forbidden_letter_is_refused(module, c):
    v = vehicle()
    v["vin"] = "1M8GDM9AXKP04278I"  # I is not in the VIN alphabet
    with pytest.raises(err(module), match="no I, O, Q"):
        c.create_assessment(json.dumps(v), json.dumps(claims()))


def test_failed_check_digit_is_a_recorded_fact_not_a_refusal(module, c):
    """A genuine European VIN can fail the North-American check digit;
    conflating format and check digit would call a real vehicle fake."""
    v = vehicle()
    v["vin"] = "1M8GDM9A1KP042788"  # position 9 altered: format ok, check no
    aid = c.create_assessment(json.dumps(v), json.dumps(claims()))
    a = json.loads(c.get_assessment(aid))
    assert a["vin_check_digit_ok"] is False


def test_claim_bounds(module, c):
    with pytest.raises(err(module), match="declare 1-12 claims"):
        c.create_assessment(json.dumps(vehicle()), json.dumps([]))
    too_many = [{"type": "CONDITION", "declared_value": f"v{i}"}
                for i in range(13)]
    with pytest.raises(err(module), match="declare 1-12 claims"):
        c.create_assessment(json.dumps(vehicle()), json.dumps(too_many))
    with pytest.raises(err(module), match="unknown type"):
        c.create_assessment(json.dumps(vehicle()), json.dumps(
            [{"type": "VIBES", "declared_value": "immaculate"}]))
    with pytest.raises(err(module), match="declared_value"):
        c.create_assessment(json.dumps(vehicle()), json.dumps(
            [{"type": "CONDITION", "declared_value": ""}]))


def test_evidence_text_hash_is_recomputed_at_entry(module, c):
    """The declared text hash must cover the supplied bytes — corroboration
    where the evidence ENTERS the record, by construction."""
    aid = build_assessment(module, c, items=[], seal=False)
    bad = json.loads(svc_item())
    bad["text_sha256"] = sha("some other bytes entirely")
    with pytest.raises(err(module), match="does not match the supplied"):
        c.submit_evidence_text(aid, json.dumps(bad))


def test_evidence_item_is_stored_with_both_hashes(module, c):
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    a = json.loads(c.get_assessment(aid))
    [it] = a["items"]
    assert it["evidence_id"] == "E-SVC"
    assert len(it["file_sha256"]) == 64 and len(it["text_sha256"]) == 64
    assert it["extractor_version"] == "extractor-1.0.0"
    stored = json.loads(c.get_item_text(aid, "E-SVC"))
    assert "Odometer reading 87,432 miles" in stored["text"]


def test_text_over_cap_is_refused(module, c):
    aid = build_assessment(module, c, items=[], seal=False)
    big = "x " * 3001  # 6002 chars
    with pytest.raises(err(module), match="1-6000"):
        c.submit_evidence_text(aid, item("E-BIG", big,
                                         text_hash=sha(big)))


def test_unextracted_item_carries_no_text_and_is_stored_honestly(module, c):
    aid = build_assessment(module, c, items=[], seal=False)
    with_text = json.loads(item("E-VID", "sneaky text",
                                declared_class="VIDEO",
                                status="UNEXTRACTED"))
    with_text["text"] = "sneaky text"
    with pytest.raises(err(module), match="carries no text"):
        c.submit_evidence_text(aid, json.dumps(with_text))
    ok = item("E-VID", "", declared_class="VIDEO", status="UNEXTRACTED",
              text_hash=sha(""))
    c.submit_evidence_text(aid, ok)
    a = json.loads(c.get_assessment(aid))
    assert a["items"][0]["status"] == "UNEXTRACTED"


def test_duplicate_evidence_id_is_refused(module, c):
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    with pytest.raises(err(module), match="already recorded"):
        c.submit_evidence_text(aid, svc_item())


def test_item_cap_before_sealing(module, c):
    aid = build_assessment(module, c, items=[], seal=False)
    for i in range(8):
        text = f"Document number {i} with some content to record."
        c.submit_evidence_text(aid, item(f"E-{i:02d}", text))
    with pytest.raises(err(module), match="at most 8 items"):
        c.submit_evidence_text(aid, item("E-09", "one too many here"))


def test_evidence_after_seal_names_the_appeal_path(module, c):
    aid = build_assessment(module, c)
    with pytest.raises(err(module), match="submit_appeal_evidence"):
        c.submit_evidence_text(aid, item("E-LATE", "late arrival text"))


def test_declared_class_outside_taxonomy_is_refused(module, c):
    aid = build_assessment(module, c, items=[], seal=False)
    with pytest.raises(err(module), match="taxonomy"):
        c.submit_evidence_text(aid, item("E-X", "text here",
                                         declared_class="TRUST_ME_REPORT"))


def test_seller_cannot_dispute_their_own_claims(module, c):
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    with pytest.raises(err(module), match="cannot dispute their own"):
        c.record_dispute(aid, SELLER, json.dumps(["CL-01"]), "")


def test_dispute_must_name_recorded_claims(module, c):
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    with pytest.raises(err(module), match="recorded claim ids"):
        c.record_dispute(aid, BUYER, json.dumps(["CL-99"]), "")


def test_dispute_is_recorded_with_its_context(module, c):
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    as_(module, BUYER_ADDR)
    c.record_dispute(aid, BUYER, json.dumps(["CL-02"]), "odometer looks off")
    a = json.loads(c.get_assessment(aid))
    [d] = a["disputes"]
    assert d["account"] == BUYER
    assert d["claim_ids"] == ["CL-02"]
    assert d["after_runs"] == 0
    assert d["address"] == BUYER_ADDR


def test_seal_recomputes_the_root_from_stored_items(module, c):
    aid = build_assessment(module, c, items=[svc_item(), hist_item()],
                           seal=False)
    with pytest.raises(err(module), match="hash to [0-9a-f]{64}"):
        c.submit_assessment(aid, "0" * 64)
    stored = [json.loads(c.items[f"{aid}|{eid}"])
              for eid in json.loads(c.item_index[aid])]
    root = module._manifest_root(stored)
    assert c.submit_assessment(aid, root) == root
    m = json.loads(c.get_manifest(aid, 1))
    assert m["root"] == root
    # Every manifest entry binds the judged bytes: id, file hash, TEXT
    # hash, extractor version.
    for entry in m["entries"]:
        assert len(entry) == 4
        assert len(entry[1]) == 64 and len(entry[2]) == 64


def test_seal_requires_items_and_happens_once(module, c):
    as_(module, SELLER_ADDR)
    aid = c.create_assessment(json.dumps(vehicle()), json.dumps(claims()))
    with pytest.raises(err(module), match="at least one evidence item"):
        c.submit_assessment(aid, "0" * 64)
    aid2 = build_assessment(module, c)
    stored = [json.loads(c.items[f"{aid2}|{eid}"])
              for eid in json.loads(c.item_index[aid2])]
    with pytest.raises(err(module), match="only an OPEN assessment"):
        c.submit_assessment(aid2, module._manifest_root(stored))


def test_observation_rows_are_bounded_and_typed(module, c):
    aid = build_assessment(module, c, items=[], seal=False)
    bad_unit = json.loads(svc_item())
    bad_unit["observations"][0]["odometer_unit"] = "FURLONGS"
    with pytest.raises(err(module), match="MILES or KM"):
        c.submit_evidence_text(aid, json.dumps(bad_unit))
    negative = json.loads(svc_item())
    negative["observations"][0]["odometer_reading"] = -5
    with pytest.raises(err(module), match="non-negative"):
        c.submit_evidence_text(aid, json.dumps(negative))
    crowded = json.loads(svc_item())
    crowded["observations"] = [{"doc_date": "2026-01-01"}] * 13
    with pytest.raises(err(module), match="at most 12 observation"):
        c.submit_evidence_text(aid, json.dumps(crowded))


def test_diagnostic_codes_are_normalized_in_code(module, c):
    aid = build_assessment(module, c, items=[], seal=False)
    raw = json.loads(item("E-DIAG", "Scanner dump: P0301 misfire noted.",
                          declared_class="DIAGNOSTIC_SCANNER_REPORT"))
    raw["diagnostic_codes"] = ["p0301", "P0301", "X9999", "P030", "U0420"]
    raw["text_sha256"] = sha(raw["text"])
    c.submit_evidence_text(aid, json.dumps(raw))
    stored = json.loads(c.get_item_text(aid, "E-DIAG"))
    assert stored["diagnostic_codes"] == ["P0301", "U0420"]


def test_get_config_publishes_every_bound(module, c, c_bare):
    cfg = json.loads(c.get_config())
    for key in ("max_claims", "max_items_at_submission",
                "max_new_items_per_appeal", "per_item_text_cap",
                "total_judged_text_cap", "max_runs_per_assessment",
                "quote_min", "quote_cap", "max_quotes", "note_cap",
                "anchor_fetch_cap", "anchor_allowlist",
                "mileage_tolerance_bps", "claim_types", "claim_verdicts",
                "rollups", "ruleset"):
        assert key in cfg, key
    assert cfg["verified_reachable"] is True
    # An empty allowlist is a valid deployment in which VERIFIED is
    # honestly unreachable — and the config says so.
    assert json.loads(c_bare.get_config())["verified_reachable"] is False


def test_unknown_assessment_is_refused(module, c):
    with pytest.raises(err(module), match="unknown assessment"):
        c.get_assessment("ac-999999")
