"""The independent identity check, and the uploader's own attestation.

These are the two places AutoCourt stops relying on what a party handed
it: the VIN is decoded from a public registry by every validator itself,
and the wallet that uploaded a document signs the bytes it uploaded.
"""

import json

import pytest

from conftest import (SELLER, SELLER_ADDR, as_, build_assessment, claims,
                      err, fetches, finding, forge_leader, item,
                      page_once, panel_answer, panel_says, prompts,
                      registry_says, registry_unreachable, registry_url,
                      sha, svc_item, vehicle)


# ── what the registry said, derived in code ──────────────────────────────

def test_matching_registry_confirms_identity(module, c):
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    a = json.loads(c.get_assessment(aid))
    assert a["identity_status"] == "CONFIRMED"
    assert a["registry_fields"]["Make"] == "MERIDIAN"
    assert a["registry_fields"]["ModelYear"] == "2019"
    # Only the identity fields cross into consensus.
    assert "Note" not in a["registry_fields"]


def test_every_validator_fetches_the_registry_itself(module, c):
    """Leader AND validator each decode the VIN — the fetch is not relayed
    by one node to the others."""
    as_(module, SELLER_ADDR)
    c.create_assessment(json.dumps(vehicle()), json.dumps(claims()))
    assert fetches().count(registry_url()) == 2


def test_registry_contradicting_the_listing_is_a_mismatch(module, c):
    """The demo VIN really does decode to a 1989 bus at the live registry;
    a seller calling it a 2019 wagon is caught by a source neither party
    controls."""
    registry_says(make="MOTOR COACH INDUSTRIES", model="102C3 Intercity",
                  year="1989", body_class="Bus", vehicle_type="BUS")
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    a = json.loads(c.get_assessment(aid))
    assert a["identity_status"] == "MISMATCH"


def test_wrong_year_alone_is_a_mismatch(module, c):
    registry_says(year="2014")
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    assert json.loads(c.get_assessment(aid))["identity_status"] == "MISMATCH"


def test_make_comparison_forgives_spelling_not_substance(module):
    """A false mismatch accuses an honest seller, so make comparison is
    deliberately generous — but not infinitely."""
    agrees = module._make_agrees
    assert agrees("Honda", "HONDA") is True
    assert agrees("Mercedes", "MERCEDES-BENZ") is True
    assert agrees("MERCEDES-BENZ", "Mercedes") is True
    assert agrees("Land Rover", "LAND ROVER") is True
    assert agrees("Meridian", "MOTOR COACH INDUSTRIES") is False
    assert agrees("Honda", "Toyota") is False
    assert agrees("", "HONDA") is False


def test_undecodable_vin_is_not_an_accusation(module, c):
    registry_says(make="", year="", error_code="11")
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    a = json.loads(c.get_assessment(aid))
    assert a["identity_status"] == "UNDECODABLE"


def test_unreachable_registry_records_source_unavailable(module, c):
    registry_unreachable()
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    a = json.loads(c.get_assessment(aid))
    assert a["identity_status"] == "SOURCE_UNAVAILABLE"
    assert a["registry_fields"] == {}


def test_registry_reachability_split_refuses_the_round(module, c):
    """The leader decodes the VIN, this validator cannot reach the
    registry: no record is created from partial sight."""
    registry_unreachable()
    page_once(registry_url(), json.dumps(
        {"Results": [{"Make": "MERIDIAN", "ModelYear": "2019",
                      "ErrorCode": "0"}]}), serves=1)
    as_(module, SELLER_ADDR)
    with pytest.raises(err(module), match="did not agree"):
        c.create_assessment(json.dumps(vehicle()), json.dumps(claims()))


def test_forged_registry_identity_is_refused(module, c):
    """A leader inventing a clean decode is refused, because this
    validator binds the stored identity to bytes IT fetched."""
    registry_says(make="MOTOR COACH INDUSTRIES", year="1989")
    forge_leader({"reachable": True, "fields": {
        "Make": "MERIDIAN", "Model": "GT Wagon", "ModelYear": "2019",
        "BodyClass": "Wagon", "PlantCountry": "UNITED STATES (USA)",
        "VehicleType": "PASSENGER CAR", "ErrorCode": "0"}})
    as_(module, SELLER_ADDR)
    with pytest.raises(err(module), match="did not agree"):
        c.create_assessment(json.dumps(vehicle()), json.dumps(claims()))


# ── what a mismatch does to the verdict ──────────────────────────────────

def _status_of(module, identity):
    """Derive a report with INDEPENDENT support for CL-01, under the given
    identity status."""
    items = [{"evidence_id": "E-R", "lane": "ANCHOR", "status": "EXTRACTED",
              "uploader_account": ""}]
    findings = {"CL-01": [{"claim_id": "CL-01", "evidence_id": "E-R",
                           "status": "SUPPORTED", "severity": "MODERATE",
                           "quotes": [{"evidence_id": "E-R", "text": "x"}]}]}
    claims_for = [{"claim_id": "CL-01", "type": "MILEAGE",
                   "record_sufficient": True}]
    return module._derive_report(
        claims_for, findings, items, SELLER, [], [], {},
        {"supported": False}, identity)


def test_confirmed_identity_lets_verified_stand(module):
    r = _status_of(module, "CONFIRMED")
    assert r["claims"][0]["verdict"] == "VERIFIED"
    assert r["flags"]["vehicle_identity_mismatch"] is False
    assert r["rollup"] == "VERIFIED"


def test_mismatch_caps_every_claim_and_takes_the_headline(module):
    """Evidence about a vehicle cannot certify a listing that may describe
    a different one."""
    r = _status_of(module, "MISMATCH")
    assert r["claims"][0]["verdict"] == "PARTIALLY_VERIFIED"
    assert r["claims"][0]["next_action"] == "RECONCILE_VEHICLE_IDENTITY"
    assert r["claims"][0]["confidence"] != "HIGH"
    assert r["flags"]["vehicle_identity_mismatch"] is True
    assert r["rollup"] == "MATERIAL_CONCERN"


def test_absent_confirmation_is_not_an_accusation(module):
    """Unreachable or undecodable must never behave like a mismatch."""
    for status in ("SOURCE_UNAVAILABLE", "UNDECODABLE"):
        r = _status_of(module, status)
        assert r["claims"][0]["verdict"] == "VERIFIED", status
        assert r["flags"]["vehicle_identity_mismatch"] is False, status


def test_identity_reaches_the_panel_as_a_contract_verified_fact(module, c):
    registry_says(make="MOTOR COACH INDUSTRIES", model="102C3 Intercity",
                  year="1989", body_class="Bus")
    aid = build_assessment(module, c)
    panel_says(panel_answer())
    c.adjudicate(aid)
    prompt = prompts()[0]
    assert "INDEPENDENT IDENTITY CHECK" in prompt
    assert "fetched from the public registry by every validator itself" in prompt
    assert "THE VIN DOES NOT DECODE TO THE LISTED VEHICLE" in prompt
    assert "MOTOR COACH INDUSTRIES" in prompt


def test_identity_status_is_inside_equivalence(module, c):
    """A leader reporting a different identity status than the record
    holds is refused — the cap it implies is decision-bearing."""
    aid = build_assessment(module, c)
    panel_says(panel_answer())
    stored = [json.loads(c.items[f"{aid}|{eid}"])
              for eid in json.loads(c.item_index[aid])]
    meta = [{k: it.get(k) for k in
             ("evidence_id", "lane", "phase", "status", "uploader_account",
              "uploader_role", "declared_class", "file_sha256",
              "text_sha256", "judged_version")} for it in stored]
    findings = {
        "CL-01": [{"claim_id": "CL-01", "evidence_id": "E-SVC",
                   "status": "SUPPORTED", "severity": "MODERATE",
                   "quotes": [{"evidence_id": "E-SVC",
                               "text": "Odometer reading 87,432 miles "
                                       "at service"}]}],
        "CL-02": [{"claim_id": "CL-02", "evidence_id": "E-HIST",
                   "status": "SUPPORTED", "severity": "MODERATE",
                   "quotes": [{"evidence_id": "E-HIST",
                               "text": "No accident records found for "
                                       "this vehicle"}]}],
    }
    claims_for = [{"claim_id": "CL-01", "type": "MILEAGE",
                   "record_sufficient": True},
                  {"claim_id": "CL-02", "type": "ACCIDENT_HISTORY",
                   "record_sufficient": True}]
    diagnostic = {"supported": False, "severity": "MINOR",
                  "safety_critical": False}
    # The record says CONFIRMED; the leader claims a mismatch it cannot have.
    forge_leader({
        "report": module._derive_report(
            claims_for, findings, meta, SELLER, [], [], {},
            diagnostic, "MISMATCH"),
        "findings": findings,
        "sufficiency": {"CL-01": "SUFFICIENT", "CL-02": "SUFFICIENT"},
        "explanations": {},
        "diagnostic": diagnostic,
        "unresolved": {"CL-01": "", "CL-02": ""},
    })
    with pytest.raises(err(module), match="did not agree"):
        c.adjudicate(aid)


# ── the uploader's own attestation ───────────────────────────────────────

SIG = "0x" + "ab" * 65


def test_signed_item_records_the_attestation(module, c):
    aid = build_assessment(module, c, items=[], seal=False)
    signed = json.loads(svc_item())
    signed["uploader_signature"] = SIG
    c.submit_evidence_text(aid, json.dumps(signed))
    stored = json.loads(c.get_item_text(aid, "E-SVC"))
    assert stored["uploader_signature"] == SIG
    # It is visible on the record view, beside the hash it covers.
    a = json.loads(c.get_assessment(aid))
    assert a["items"][0]["uploader_signature"] == SIG
    assert a["items"][0]["text_sha256"] == stored["text_sha256"]


def test_unsigned_item_is_accepted_and_recorded_as_unsigned(module, c):
    """Refusing unsigned uploads would trade an honest gap for a hidden
    one — the record says plainly which items carry an attestation."""
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    a = json.loads(c.get_assessment(aid))
    assert a["items"][0]["uploader_signature"] == ""


def test_malformed_signature_is_refused(module, c):
    aid = build_assessment(module, c, items=[], seal=False)
    for bad in ["not-a-signature", "ab" * 65, "0x" + "zz" * 65,
                "0x" + "ab" * 200]:
        candidate = json.loads(svc_item())
        candidate["uploader_signature"] = bad
        with pytest.raises(err(module), match="uploader_signature"):
            c.submit_evidence_text(aid, json.dumps(candidate))


def test_config_publishes_the_registry_and_signature_bounds(module, c):
    cfg = json.loads(c.get_config())
    assert cfg["identity_registry_host"] == "vpic.nhtsa.dot.gov"
    assert "MISMATCH" in cfg["identity_statuses"]
    assert cfg["max_signature_chars"] == 200
    assert cfg["ruleset"] == "autocourt-rules-4"
    assert cfg["writes_bound_to_signer"] is True
    assert (cfg["max_seller_items_at_submission"]
            + cfg["max_other_items_at_submission"]
            == cfg["max_items_at_submission"])
    assert (cfg["max_seller_items_per_appeal"]
            + cfg["max_other_items_per_appeal"]
            == cfg["max_new_items_per_appeal"])
