"""Appeals: RECORDED items re-read from the contract's own storage by
construction, NEW items tagged post-verdict, prior runs immutable, run
count capped, recorded parties only."""

import json

import pytest

from conftest import (BUYER, BUYER_ADDR, SELLER, as_, build_assessment,
                      clear_fetches, err, fetches, finding, hist_item, item,
                      panel_answer, panel_says, prompts, svc_item)

CTR_TEXT = ("COUNTER REPORT 2026-06-10. Independent inspection found frame "
            "damage consistent with a prior collision. Repair records "
            "absent from the file.")


def ctr_item(eid="E-CTR"):
    return item(eid, CTR_TEXT, uploader=BUYER, role="BUYER",
                declared_class="MECHANIC_REPORT")


def adjudicated(module, c):
    aid = build_assessment(module, c)
    panel_says(panel_answer())
    c.adjudicate(aid)
    return aid


def appeal_answer():
    return panel_answer(findings=[
        finding("CL-01", "E-SVC", "SUPPORTED", "MODERATE",
                ["Odometer reading 87,432 miles at service"]),
        finding("CL-02", "E-HIST", "SUPPORTED", "MINOR",
                ["No accident records found for this vehicle"]),
        finding("CL-02", "E-CTR", "CONTRADICTED", "MAJOR",
                ["frame damage consistent with a prior collision"]),
    ])


def test_appeal_evidence_needs_a_standing_verdict(module, c):
    aid = build_assessment(module, c)
    with pytest.raises(err(module), match="standing verdict"):
        c.submit_appeal_evidence(aid, ctr_item())


def test_appeal_needs_something_new_on_the_record(module, c):
    aid = adjudicated(module, c)
    with pytest.raises(err(module), match="new evidence or a new dispute"):
        c.readjudicate(aid, SELLER, "the panel was too harsh")


def test_only_a_recorded_party_may_appeal(module, c):
    aid = adjudicated(module, c)
    c.submit_appeal_evidence(aid, ctr_item())
    with pytest.raises(err(module), match="recorded party"):
        c.readjudicate(aid, "acct-nobody", "let me in")


def test_appeal_grounds_are_bounded(module, c):
    aid = adjudicated(module, c)
    c.submit_appeal_evidence(aid, ctr_item())
    with pytest.raises(err(module), match="grounds must be"):
        c.readjudicate(aid, BUYER, "")
    with pytest.raises(err(module), match="grounds must be"):
        c.readjudicate(aid, BUYER, "x" * 1201)


def test_full_appeal_rejudges_recorded_bytes_plus_the_new_item(module, c):
    aid = adjudicated(module, c)
    as_(module, BUYER_ADDR)
    c.submit_appeal_evidence(aid, ctr_item())
    c.record_dispute(aid, BUYER, json.dumps(["CL-02"]),
                     "history record is incomplete")
    panel_says(appeal_answer())
    clear_fetches()
    got = c.readjudicate(aid, BUYER, "an independent inspection found "
                                     "frame damage the history missed")
    # The appeal read the stored record; the uploaded lane fetches nothing.
    assert fetches() == []
    a = json.loads(c.get_assessment(aid))
    assert a["runs_count"] == 2
    assert a["packet_version"] == 2
    m2 = json.loads(c.get_manifest(aid, 2))
    assert len(m2["entries"]) == 3
    stored = json.loads(c.get_item_text(aid, "E-CTR"))
    assert stored["judged_version"] == 2
    # The panel was told which bytes are the record and which arrived
    # after the outcome was known. (Earlier entries are run 1's prompts;
    # the appeal round's prompt is the latest.)
    prompt = prompts()[-1]
    assert "RE-ADJUDICATION" in prompt
    assert "NEW — entered AFTER a verdict was known" in prompt
    assert "PARTIALLY_VERIFIED at run 1" in prompt
    # The buyer's own counter-report is first-party to the accusation:
    # floored at inspection, never CLAIM_CONTRADICTED.
    v = json.loads(c.get_verdict(aid))
    assert v["standing_run"] == 2 and v["total_runs"] == 2
    by_id = {cl["claim_id"]: cl for cl in v["claims"]}
    assert by_id["CL-02"]["verdict"] == "PHYSICAL_INSPECTION_REQUIRED"
    assert got == "run 2: PHYSICAL_INSPECTION_REQUIRED"


def test_prior_runs_are_immutable(module, c):
    aid = adjudicated(module, c)
    as_(module, BUYER_ADDR)
    c.submit_appeal_evidence(aid, ctr_item())
    panel_says(appeal_answer())
    c.readjudicate(aid, BUYER, "counter-report attached")
    run1 = json.loads(c.get_run(aid, 1))
    assert run1["report"]["rollup"] == "PARTIALLY_VERIFIED"
    assert run1["kind"] == "ADJUDICATION"
    run2 = json.loads(c.get_run(aid, 2))
    assert run2["kind"] == "RE_ADJUDICATION"
    assert run2["appellant"] == BUYER
    assert run2["prior_run"] == 1


def test_appeal_item_cap(module, c):
    aid = adjudicated(module, c)
    for i in range(4):
        text = f"Late document {i} with fresh content to consider."
        c.submit_appeal_evidence(
            aid, item(f"E-L{i}", text, uploader=BUYER, role="BUYER",
                      declared_class="BUYER_DECLARATION"))
    with pytest.raises(err(module), match="at most 4 new items"):
        c.submit_appeal_evidence(aid, ctr_item("E-L9"))


def test_run_cap_holds(module, c):
    """MAX_RUNS_PER_ASSESSMENT = 4: one adjudication + three appeals; the
    fourth appeal is refused with the cap in the sentence."""
    aid = adjudicated(module, c)
    for n in range(2, 5):
        as_(module, BUYER_ADDR)
        acct = f"acct-late-{n}"
        c.record_dispute(aid, acct, json.dumps(["CL-01"]),
                         f"dispute round {n}")
        panel_says(panel_answer())
        c.readjudicate(aid, acct, f"round {n} grounds")
        assert json.loads(c.get_assessment(aid))["runs_count"] == n
    c.record_dispute(aid, "acct-final", json.dumps(["CL-01"]), "again")
    with pytest.raises(err(module), match="at most 4 runs"):
        c.readjudicate(aid, "acct-final", "one more round")


def test_a_new_dispute_alone_supports_an_appeal(module, c):
    aid = adjudicated(module, c)
    as_(module, BUYER_ADDR)
    c.record_dispute(aid, BUYER, json.dumps(["CL-01"]),
                     "the mileage looks wrong to me")
    panel_says(panel_answer())
    got = c.readjudicate(aid, BUYER, "dispute recorded after the verdict")
    assert got.startswith("run 2:")
