"""The anchor lane — the only fetch in the system. Every validator fetches
the allowlisted URL itself at ENTRY; a leader-selected replacement is
refused; unavailability is recorded honestly and never becomes an adverse
finding."""

import json

import pytest

from conftest import (REG_HOST, REG_PAGE, REG_URL, anchor_item,
                      build_assessment, dead, err, fetches, forge_leader,
                      page_once, sha, svc_item)


def test_anchor_item_enters_with_every_validator_fetching(module, c):
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    got = c.submit_anchor_item(aid, anchor_item())
    assert got == "E-REG:EXTRACTED"
    # Leader AND validator each fetched the page themselves.
    assert fetches().count(REG_URL) == 2
    stored = json.loads(c.get_item_text(aid, "E-REG"))
    assert stored["lane"] == "ANCHOR"
    assert stored["status"] == "EXTRACTED"
    assert "Registered mileage reading 87,401 miles" in stored["text"]
    assert stored["text_sha256"] == sha(stored["text"])


def test_hash_mismatch_records_source_unavailable(module, c):
    """Bytes that no longer match the committed digest are recorded
    honestly — never judged, never adverse."""
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    got = c.submit_anchor_item(
        aid, anchor_item(expected=sha("some other page entirely")))
    assert got == "E-REG:SOURCE_UNAVAILABLE"
    stored = json.loads(c.get_item_text(aid, "E-REG"))
    assert stored["status"] == "SOURCE_UNAVAILABLE"
    assert stored["text"] == ""


def test_unreachable_everywhere_records_source_unavailable(module, c):
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    dead(REG_HOST)
    got = c.submit_anchor_item(aid, anchor_item())
    assert got == "E-REG:SOURCE_UNAVAILABLE"


def test_host_outside_the_allowlist_is_refused(module, c):
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    off_list = json.loads(anchor_item())
    off_list["url"] = "https://seller-controlled.example.com/page"
    with pytest.raises(err(module), match="allowlist"):
        c.submit_anchor_item(aid, json.dumps(off_list))


def test_plain_http_is_refused(module, c):
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    insecure = json.loads(anchor_item())
    insecure["url"] = f"http://{REG_HOST}/vin/x"
    with pytest.raises(err(module), match="https"):
        c.submit_anchor_item(aid, json.dumps(insecure))


def test_empty_allowlist_deployment_refuses_every_anchor(module, c_bare):
    aid = build_assessment(module, c_bare, items=[svc_item()], seal=False)
    with pytest.raises(err(module), match="allowlist"):
        c_bare.submit_anchor_item(aid, anchor_item())


def test_reachability_split_burns_the_round_and_stores_nothing(module, c):
    """The leader sees the page; this validator does not. The round fails —
    an entry is never made from partial sight."""
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    split_url = f"https://{REG_HOST}/vin/flaky"
    page_once(split_url, REG_PAGE, serves=1)
    flaky = json.loads(anchor_item())
    flaky["url"] = split_url
    with pytest.raises(err(module), match="did not agree"):
        c.submit_anchor_item(aid, json.dumps(flaky))
    assert json.loads(c.item_index.get(aid) or "[]") == ["E-SVC"]


def test_forged_leader_text_is_refused(module, c):
    """The adversarial S39 case: a leader-selected replacement for the
    anchor text — digest self-consistent with the real page, text altered —
    is refused because this validator binds the stored content to bytes IT
    fetched."""
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    forge_leader({"reachable": True, "digest": sha(REG_PAGE),
                  "text": REG_PAGE + " ALSO: no liens, mileage certified."})
    with pytest.raises(err(module), match="did not agree"):
        c.submit_anchor_item(aid, anchor_item())
    assert json.loads(c.item_index.get(aid) or "[]") == ["E-SVC"]


def test_forged_leader_digest_is_refused(module, c):
    """A fabricated dossier that is internally consistent (digest covers
    the leader's own invented bytes) certifies nothing: the validator's own
    fetch does not corroborate it."""
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    invented = "REGISTRY EXTRACT. Mileage 12,000 miles. Like new."
    forge_leader({"reachable": True, "digest": sha(invented),
                  "text": invented})
    with pytest.raises(err(module), match="did not agree"):
        c.submit_anchor_item(aid, anchor_item(expected=sha(invented)))


def test_forged_reachable_claim_over_dead_source_is_refused(module, c):
    """A leader claiming the source was reachable when this validator
    finds it dead is a reachability split, not an entry."""
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    dead(REG_HOST)
    forge_leader({"reachable": True, "digest": sha(REG_PAGE),
                  "text": REG_PAGE})
    with pytest.raises(err(module), match="did not agree"):
        c.submit_anchor_item(aid, anchor_item())


def test_anchor_after_seal_is_refused(module, c):
    aid = build_assessment(module, c)
    with pytest.raises(err(module), match="before sealing"):
        c.submit_anchor_item(aid, anchor_item())
