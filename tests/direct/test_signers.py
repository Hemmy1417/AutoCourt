"""Every account the contract records is the wallet that signed the write.

The seller of record, each uploader, each disputer and each appellant is the
signer; a claimed account that names anyone else is refused in words. Only the
seller seals, only a recorded party asks for a judgment, intake slots are
split by side, and an independent source's URL cannot smuggle a host past the
allowlist."""

import json

import pytest

from conftest import (BUYER, BUYER_ADDR, REG_HOST, REG_PAGE, SELLER,
                      SELLER_ADDR, STRANGER_ADDR, account, anchor_item, as_,
                      build_assessment, claims, err, item, panel_answer,
                      panel_says, svc_item, vehicle)


def _root(module, c, aid):
    stored = [json.loads(c.items[f"{aid}|{eid}"])
              for eid in json.loads(c.item_index[aid])]
    return module._manifest_root(stored)


# ── the seller of record ─────────────────────────────────────────────────────

def test_the_wallet_that_opens_a_record_is_its_seller(module, c):
    as_(module, SELLER_ADDR)
    v = vehicle()
    del v["seller_account"]
    aid = c.create_assessment(json.dumps(v), json.dumps(claims()))
    a = json.loads(c.get_assessment(aid))
    assert a["seller_account"] == SELLER_ADDR


def test_a_record_cannot_be_opened_in_another_wallets_name(module, c):
    as_(module, STRANGER_ADDR)
    with pytest.raises(err(module), match="seller_account must be the wallet "
                                          "that signs this transaction"):
        c.create_assessment(json.dumps(vehicle(seller=SELLER)),
                            json.dumps(claims()))


def test_a_claimed_account_matches_whatever_its_letter_case(module, c):
    as_(module, SELLER_ADDR)
    aid = c.create_assessment(json.dumps(vehicle(seller=SELLER.upper()
                                                 .replace("0X", "0x"))),
                              json.dumps(claims()))
    assert json.loads(c.get_assessment(aid))["seller_account"] == SELLER_ADDR


# ── uploads ──────────────────────────────────────────────────────────────────

def test_an_upload_cannot_be_attributed_to_another_wallet(module, c):
    aid = build_assessment(module, c, items=[], seal=False)
    as_(module, STRANGER_ADDR)
    with pytest.raises(err(module), match="uploader_account must be the "
                                          "wallet that signs"):
        c.submit_evidence_text(aid, item("E-FAKE", "Looks like the seller's.",
                                         uploader=SELLER, role="SELLER"))


def test_the_uploaders_role_is_a_fact_about_the_signer(module, c):
    aid = build_assessment(module, c, items=[], seal=False)
    as_(module, BUYER_ADDR)
    with pytest.raises(err(module), match="uploader_role must be SELLER for "
                                          "the seller of record"):
        c.submit_evidence_text(aid, item("E-B1", "A buyer posing as seller.",
                                         uploader=BUYER, role="SELLER"))
    # With the account and role left out, both come from the signer.
    bare = json.loads(item("E-B2", "A buyer's plain document text."))
    del bare["uploader_account"]
    del bare["uploader_role"]
    c.submit_evidence_text(aid, json.dumps(bare))
    stored = json.loads(c.get_item_text(aid, "E-B2"))
    assert stored["uploader_account"] == BUYER_ADDR
    assert stored["uploader_role"] == "BUYER"


# ── disputes ─────────────────────────────────────────────────────────────────

def test_a_dispute_cannot_be_recorded_in_another_wallets_name(module, c):
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    as_(module, STRANGER_ADDR)
    with pytest.raises(err(module), match="disputing account must be the "
                                          "wallet that signs"):
        c.record_dispute(aid, BUYER, json.dumps(["CL-01"]), "")


# ── sealing ──────────────────────────────────────────────────────────────────

def test_only_the_seller_of_record_seals(module, c):
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    root = _root(module, c, aid)
    for who in (BUYER_ADDR, STRANGER_ADDR):
        as_(module, who)
        with pytest.raises(err(module), match="only the seller of record can "
                                              "seal"):
            c.submit_assessment(aid, root)
    assert json.loads(c.get_assessment(aid))["state"] == "OPEN"
    as_(module, SELLER_ADDR)
    c.submit_assessment(aid, root)
    assert json.loads(c.get_assessment(aid))["state"] == "SEALED"


# ── adjudication ─────────────────────────────────────────────────────────────

def test_a_stranger_cannot_ask_for_a_judgment(module, c):
    aid = build_assessment(module, c)
    as_(module, STRANGER_ADDR)
    panel_says(panel_answer())
    with pytest.raises(err(module), match="only a recorded party may request "
                                          "adjudication"):
        c.adjudicate(aid)
    assert json.loads(c.get_assessment(aid))["runs_count"] == 0


def test_a_disputer_is_a_recorded_party_who_may_ask(module, c):
    disputer = account(7)
    aid = build_assessment(module, c, disputes=[{"account": disputer,
                                                 "claim_ids": ["CL-01"]}])
    as_(module, disputer)
    panel_says(panel_answer())
    assert c.adjudicate(aid).startswith("run 1:")


# ── independent sources ──────────────────────────────────────────────────────

def test_a_source_records_who_added_it_and_spends_that_sides_slot(module, c):
    aid = build_assessment(module, c, items=[], seal=False)
    as_(module, BUYER_ADDR)
    for i in range(2):
        c.submit_evidence_text(aid, item(f"E-B{i}", f"Buyer document {i}.",
                                         uploader=BUYER, role="BUYER"))
    assert c.submit_anchor_item(aid, anchor_item()) == "E-REG:EXTRACTED"
    a = json.loads(c.get_assessment(aid))
    [source] = [i for i in a["items"] if i["lane"] == "ANCHOR"]
    assert source["added_by"] == BUYER_ADDR
    assert source["uploader_account"] == ""
    # The buyer side's three slots are spent; the seller's five are not.
    as_(module, account(3))
    with pytest.raises(err(module), match="other than the seller may enter "
                                          "at most 3 items"):
        c.submit_anchor_item(aid, anchor_item(eid="E-REG2"))
    as_(module, SELLER_ADDR)
    assert c.submit_anchor_item(aid, anchor_item(eid="E-REG3")).endswith(
        ":EXTRACTED")


def test_adding_a_source_makes_a_wallet_a_recorded_party(module, c):
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    adder = account(4)
    as_(module, adder)
    c.submit_anchor_item(aid, anchor_item())
    as_(module, SELLER_ADDR)
    c.submit_assessment(aid, _root(module, c, aid))
    as_(module, adder)
    panel_says(panel_answer())
    assert c.adjudicate(aid).startswith("run 1:")


@pytest.mark.parametrize("smuggled", [
    f"https://evil.example?.{REG_HOST}/page",
    f"https://evil.example#.{REG_HOST}/page",
    f"https://evil.example\\.{REG_HOST}/page",
    f"https://{REG_HOST}@evil.example/page",
    f"https://user@{REG_HOST}/page",
    # Userinfo that LOOKS like the host: a port-style cut reads the
    # allowlisted name while a browser fetches evil.example.
    f"https://{REG_HOST}:pw@evil.example/page",
    f"https://evil%2eexample.{REG_HOST}/page",
])
def test_a_url_cannot_smuggle_a_host_past_the_allowlist(module, c, smuggled):
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    bad = json.loads(anchor_item())
    bad["url"] = smuggled
    with pytest.raises(err(module), match="plain host|allowlist"):
        c.submit_anchor_item(aid, json.dumps(bad))


def test_a_query_without_a_path_still_names_the_host(module, c):
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    ok = json.loads(anchor_item())
    ok["url"] = f"https://{REG_HOST}?vin=1HGCM82633A004352"
    assert c.submit_anchor_item(aid, json.dumps(ok)) == \
        "E-REG:SOURCE_UNAVAILABLE"


def test_a_plain_host_with_a_port_still_passes_the_allowlist(module, c):
    aid = build_assessment(module, c, items=[svc_item()], seal=False)
    ok = json.loads(anchor_item())
    ok["url"] = f"https://{REG_HOST}:443/vin/page"
    # Past the host check; this URL serves nothing in the fixture, so every
    # validator agrees it is unreachable.
    assert c.submit_anchor_item(aid, json.dumps(ok)) == \
        "E-REG:SOURCE_UNAVAILABLE"
    assert REG_PAGE  # the registered page is unchanged
