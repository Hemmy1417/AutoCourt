"""The deterministic heart, tested without a chain: corroboration edges,
verdict floors, flags, rollup precedence, mileage arithmetic, quote
grounding. Every function here runs identically inside every validator."""

from conftest import VIN


# ── VIN ──────────────────────────────────────────────────────────────────────

def test_vin_check_digit_published_examples(module):
    assert module._vin_check_digit_ok("11111111111111111") is True
    assert module._vin_check_digit_ok(VIN) is True  # check digit X
    assert module._vin_check_digit_ok("1M8GDM9A1KP042788") is False


def test_vin_transposition_separates_the_two_facts(module):
    swapped = VIN[:3] + VIN[4] + VIN[3] + VIN[5:]
    assert module._vin_format_ok(swapped) is True
    assert module._vin_check_digit_ok(swapped) is False


def test_vin_candidates_found_in_text(module):
    text = f"Report for vehicle {VIN} issued today."
    assert module._vin_candidates_in(text) == [VIN]
    assert module._vin_candidates_in("no vin here at all") == []


# ── OBD-II ───────────────────────────────────────────────────────────────────

def test_obd_normalization(module):
    got = module._obd_normalize(["p0301", "P0301", "X9999", "P030",
                                 "U0420", 12345, "  b1000  "])
    assert got == ["B1000", "P0301", "U0420"]


# ── mileage ──────────────────────────────────────────────────────────────────

def _obs(date, reading, unit="MILES", eid="E-A", acct="acct-a"):
    return {"doc_date": date, "odometer_reading": reading,
            "odometer_unit": unit, "evidence_id": eid,
            "uploader_account": acct}


def test_unit_rounding_is_not_a_rollback(module):
    """55,000 miles vs 88,400 km (= 54,929 mi) is a rounding gap."""
    rows = [_obs("2026-01-01", 55_000, "MILES", "E-A"),
            _obs("2026-06-01", 88_400, "KM", "E-B")]
    assert module._mileage_conflicts(rows) == []


def test_genuine_regression_is_a_conflict(module):
    rows = [_obs("2026-03-07", 87_432, "MILES", "E-A", "acct-a"),
            _obs("2026-05-01", 62_000, "MILES", "E-B", "acct-b")]
    [c] = module._mileage_conflicts(rows)
    assert c["earlier"]["miles"] == 87_432
    assert c["later"]["miles"] == 62_000
    assert c["evidence_ids"] == ["E-A", "E-B"]
    assert c["accounts"] == ["acct-a", "acct-b"]


def test_same_day_readings_never_conflict(module):
    rows = [_obs("2026-03-07", 87_432, "MILES", "E-A"),
            _obs("2026-03-07", 62_000, "MILES", "E-B")]
    assert module._mileage_conflicts(rows) == []


def test_increasing_readings_never_conflict(module):
    rows = [_obs("2026-01-15", 86_900, "MILES", "E-A"),
            _obs("2026-03-07", 87_432, "MILES", "E-B")]
    assert module._mileage_conflicts(rows) == []


# ── duplicates and VIN echoes ────────────────────────────────────────────────

def test_duplicate_hashes_are_grouped(module):
    items = [{"evidence_id": "E-A", "text_sha256": "a" * 64,
              "file_sha256": "b" * 64},
             {"evidence_id": "E-B", "text_sha256": "a" * 64,
              "file_sha256": "c" * 64},
             {"evidence_id": "E-C", "text_sha256": "d" * 64,
              "file_sha256": "e" * 64}]
    assert module._duplicate_hash_groups(items) == [["E-A", "E-B"]]


def test_vin_echo_mismatch_detected(module):
    other = "1M8GDM9A1KP042788"
    items = [{"evidence_id": "E-A", "text": f"papers for {other} attached"}]
    [echo] = module._vin_echo_mismatches(items, VIN)
    assert echo == {"evidence_id": "E-A", "vin": other}


# ── quote grounding ──────────────────────────────────────────────────────────

SOURCE = ("SERVICE INVOICE 2026-03-07. Odometer reading 87,432 miles at "
          "service. Replaced front brake pads and rotors.")
TEXTS = {"E-1": SOURCE}


def test_quote_grounds_across_punctuation_and_case(module):
    q = {"evidence_id": "E-1",
         "text": "odometer READING 87 432 miles"}
    assert module._quote_grounded(q, ["E-1"], TEXTS) is True


def test_fabricated_quote_does_not_ground(module):
    q = {"evidence_id": "E-1", "text": "engine replaced under warranty"}
    assert module._quote_grounded(q, ["E-1"], TEXTS) is False


def test_ellipsis_fragments_ground_in_order(module):
    q = {"evidence_id": "E-1",
         "text": "Odometer reading ... brake pads"}
    assert module._quote_grounded(q, ["E-1"], TEXTS) is True
    backwards = {"evidence_id": "E-1",
                 "text": "brake pads ... Odometer reading"}
    assert module._quote_grounded(backwards, ["E-1"], TEXTS) is False


def test_single_word_fragment_is_refused(module):
    q = {"evidence_id": "E-1", "text": "Odometer"}
    assert module._quote_grounded(q, ["E-1"], TEXTS) is False


def test_ground_quote_reattributes_to_the_right_item(module):
    texts = {"E-1": SOURCE, "E-2": "Completely different content here."}
    got = module._ground_quote("Odometer reading 87,432 miles", "E-2",
                               ["E-1", "E-2"], texts)
    assert got == {"evidence_id": "E-1",
                   "text": "Odometer reading 87,432 miles"}


def test_ground_quote_enforces_length_bounds(module):
    assert module._ground_quote("hi", "E-1", ["E-1"], TEXTS) is None
    long = ("Odometer reading 87,432 miles at service " * 8).strip()
    got = module._ground_quote(long, "E-1", ["E-1"], TEXTS)
    assert got is None or len(got["text"]) <= module.QUOTE_CAP


# ── corroboration edges ──────────────────────────────────────────────────────

def _item(eid, lane="UPLOADED", status="EXTRACTED", account="acct-a"):
    return {"evidence_id": eid, "lane": lane, "status": status,
            "uploader_account": account}


def test_edge_classes(module):
    anchor = _item("E-R", lane="ANCHOR", account="")
    seller_it = _item("E-S", account="acct-seller")
    buyer_it = _item("E-B", account="acct-buyer")
    disputers = {"acct-buyer"}
    cls = module._edge_class
    assert cls(anchor, "SUPPORT", "acct-seller", disputers) == "INDEPENDENT"
    assert cls(seller_it, "SUPPORT", "acct-seller",
               disputers) == "FIRST_PARTY"
    # A disputing buyer's evidence SUPPORTING the claim is against-interest.
    assert cls(buyer_it, "SUPPORT", "acct-seller", disputers) == "ADVERSE"
    # The seller's own document undercutting their claim is against-interest.
    assert cls(seller_it, "CONTRADICT", "acct-seller", disputers) == "ADVERSE"
    # The accuser's own contradiction is first-party to the accusation.
    assert cls(buyer_it, "CONTRADICT", "acct-seller",
               disputers) == "FIRST_PARTY"


def test_adverse_credit_is_scoped_to_the_disputed_claim(module):
    """An account disputing claim 2 earns no against-interest credit on
    claim 1 — the stake is per (claim, item, direction) edge."""
    buyer_it = _item("E-B", account="acct-buyer")
    assert module._edge_class(buyer_it, "SUPPORT", "acct-seller",
                              set()) == "FIRST_PARTY"


def test_unavailable_anchor_is_not_independent(module):
    dead_anchor = _item("E-R", lane="ANCHOR", status="SOURCE_UNAVAILABLE",
                        account="")
    assert module._edge_class(dead_anchor, "SUPPORT", "acct-seller",
                              set()) == "FIRST_PARTY"


# ── claim verdict floors ─────────────────────────────────────────────────────

SELLER_A = "acct-seller"


def _claim(sufficient=True):
    return {"claim_id": "CL-01", "type": "MILEAGE",
            "record_sufficient": sufficient}


def _finding(eid, status, severity="MODERATE"):
    return {"claim_id": "CL-01", "evidence_id": eid, "status": status,
            "severity": severity,
            "quotes": [{"evidence_id": eid, "text": "grounded already"}]}


def _derive(module, findings, items, sufficient=True, disputers=None):
    items_by_id = {it["evidence_id"]: it for it in items}
    return module._derive_claim(_claim(sufficient), findings, items_by_id,
                                SELLER_A, disputers or set())


def test_first_party_support_never_reaches_verified(module):
    got = _derive(module, [_finding("E-S", "SUPPORTED")],
                  [_item("E-S", account=SELLER_A)])
    assert got["verdict"] == "PARTIALLY_VERIFIED"
    assert got["next_action"] == "OBTAIN_INDEPENDENT_RECORD"


def test_independent_support_reaches_verified_with_high_confidence(module):
    got = _derive(module, [_finding("E-R", "SUPPORTED")],
                  [_item("E-R", lane="ANCHOR", account="")])
    assert got["verdict"] == "VERIFIED"
    assert got["confidence"] == "HIGH"
    assert got["adverse"] is False


def test_insufficient_record_caps_independent_support(module):
    got = _derive(module, [_finding("E-R", "SUPPORTED")],
                  [_item("E-R", lane="ANCHOR", account="")],
                  sufficient=False)
    assert got["verdict"] == "PARTIALLY_VERIFIED"


def test_against_interest_contradiction_contradicts(module):
    """The seller's own document undercutting their claim carries the
    accusation past the floor."""
    got = _derive(module, [_finding("E-S", "CONTRADICTED")],
                  [_item("E-S", account=SELLER_A)])
    assert got["verdict"] == "CLAIM_CONTRADICTED"
    assert got["adverse"] is True


def test_accuser_only_contradiction_is_floored(module):
    """An accusation resting only on the accuser's own uploads is held at
    inspection or insufficient — never CLAIM_CONTRADICTED."""
    buyer_item = _item("E-B", account="acct-buyer")
    got = _derive(module, [_finding("E-B", "CONTRADICTED", "MAJOR")],
                  [buyer_item], disputers={"acct-buyer"})
    assert got["verdict"] == "PHYSICAL_INSPECTION_REQUIRED"
    minor = _derive(module, [_finding("E-B", "CONTRADICTED", "MINOR")],
                    [buyer_item], disputers={"acct-buyer"})
    assert minor["verdict"] == "INSUFFICIENT_EVIDENCE"


def test_qualifying_contradiction_plus_support_conflicts(module):
    got = _derive(module,
                  [_finding("E-S", "SUPPORTED"),
                   _finding("E-S2", "CONTRADICTED")],
                  [_item("E-S", account=SELLER_A),
                   _item("E-S2", account=SELLER_A)])
    assert got["verdict"] == "CONFLICTING_EVIDENCE"


def test_sybil_dispute_cannot_mint_a_conflict(module):
    """An accuser's own upload cannot drag an INDEPENDENT-supported claim
    into CONFLICTING_EVIDENCE — it caps below VERIFIED instead, and a
    severe accusation forces inspection."""
    items = [_item("E-R", lane="ANCHOR", account=""),
             _item("E-B", account="acct-buyer")]
    minor = _derive(module,
                    [_finding("E-R", "SUPPORTED"),
                     _finding("E-B", "CONTRADICTED", "MINOR")],
                    items, disputers={"acct-buyer"})
    assert minor["verdict"] == "PARTIALLY_VERIFIED"
    major = _derive(module,
                    [_finding("E-R", "SUPPORTED"),
                     _finding("E-B", "CONTRADICTED", "MAJOR")],
                    items, disputers={"acct-buyer"})
    assert major["verdict"] == "PHYSICAL_INSPECTION_REQUIRED"


def test_same_account_items_are_one_voice(module):
    got = _derive(module,
                  [_finding("E-S", "SUPPORTED"),
                   _finding("E-S2", "SUPPORTED")],
                  [_item("E-S", account=SELLER_A),
                   _item("E-S2", account=SELLER_A)])
    assert got["verdict"] == "PARTIALLY_VERIFIED"
    assert got["support_classes"] == ["FIRST_PARTY"]


def test_no_findings_is_insufficient(module):
    got = _derive(module, [], [])
    assert got["verdict"] == "INSUFFICIENT_EVIDENCE"
    assert got["confidence"] == "LOW"


def test_qualifying_contradiction_without_sufficiency_is_inconclusive(module):
    got = _derive(module, [_finding("E-S", "CONTRADICTED")],
                  [_item("E-S", account=SELLER_A)], sufficient=False)
    assert got["verdict"] == "INCONCLUSIVE"


def test_unextracted_cited_item_lowers_confidence(module):
    got = _derive(module,
                  [_finding("E-R", "SUPPORTED"),
                   _finding("E-U", "SUPPORTED")],
                  [_item("E-R", lane="ANCHOR", account=""),
                   _item("E-U", status="UNEXTRACTED", account="acct-x")])
    assert got["verdict"] == "VERIFIED"
    assert got["confidence"] == "LOW"


# ── flags and their floor ────────────────────────────────────────────────────

CONFLICT = {"conflict_id": "MC-01",
            "earlier": {"date": "2026-03-07", "miles": 87_432,
                        "evidence_id": "E-A"},
            "later": {"date": "2026-05-01", "miles": 62_000,
                      "evidence_id": "E-B"},
            "evidence_ids": ["E-A", "E-B"],
            "accounts": ["acct-a", "acct-b"]}


def test_two_account_unexplained_conflict_indicates_rollback(module):
    flags = module._derive_flags([CONFLICT], {"MC-01": "NOT_EXPLAINED"},
                                 {"supported": False}, {})
    assert flags["mileage_conflict"] is True
    assert flags["odometer_rollback_indicated"] is True


def test_explained_conflict_does_not_indicate_rollback(module):
    flags = module._derive_flags([CONFLICT], {"MC-01": "EXPLAINED"},
                                 {"supported": False}, {})
    assert flags["mileage_conflict"] is True
    assert flags["odometer_rollback_indicated"] is False


def test_single_account_conflict_cannot_indict_alone(module):
    """The rollback flag is accusation-grade and passes the same floor:
    one account's own uploads cannot raise it."""
    one_acct = dict(CONFLICT, accounts=["acct-b"])
    flags = module._derive_flags([one_acct], {"MC-01": "NOT_EXPLAINED"},
                                 {"supported": False}, {})
    assert flags["mileage_conflict"] is True
    assert flags["odometer_rollback_indicated"] is False


def test_anchor_involved_conflict_can_indict(module):
    one_acct = dict(CONFLICT, accounts=["acct-b"])
    items = {"E-A": {"lane": "ANCHOR"}, "E-B": {"lane": "UPLOADED"}}
    flags = module._derive_flags([one_acct], {"MC-01": "NOT_EXPLAINED"},
                                 {"supported": False}, items)
    assert flags["odometer_rollback_indicated"] is True


# ── rollup precedence ────────────────────────────────────────────────────────

def _cr(verdict, adverse=False):
    return {"verdict": verdict, "adverse": adverse}


NO_FLAGS = {"mileage_conflict": False,
            "odometer_rollback_indicated": False,
            "diagnostic_concern_supported": False}


def test_rollback_headline_beats_everything(module):
    flags = dict(NO_FLAGS, mileage_conflict=True,
                 odometer_rollback_indicated=True)
    got = module._derive_rollup([_cr("VERIFIED")], flags, False)
    assert got == "POSSIBLE_ODOMETER_ROLLBACK"


def test_adverse_claim_is_a_material_concern(module):
    got = module._derive_rollup(
        [_cr("CLAIM_CONTRADICTED", adverse=True), _cr("VERIFIED")],
        NO_FLAGS, False)
    assert got == "MATERIAL_CONCERN"


def test_all_verified_rolls_up_verified(module):
    got = module._derive_rollup([_cr("VERIFIED"), _cr("VERIFIED")],
                                NO_FLAGS, False)
    assert got == "VERIFIED"


def test_mixed_positive_rolls_up_partially(module):
    got = module._derive_rollup(
        [_cr("VERIFIED"), _cr("PARTIALLY_VERIFIED")], NO_FLAGS, False)
    assert got == "PARTIALLY_VERIFIED"


def test_inspection_beats_conflicting(module):
    got = module._derive_rollup(
        [_cr("CONFLICTING_EVIDENCE"), _cr("PHYSICAL_INSPECTION_REQUIRED")],
        NO_FLAGS, True)
    assert got == "PHYSICAL_INSPECTION_REQUIRED"


def test_manifest_root_is_order_independent(module):
    a = {"evidence_id": "E-A", "file_sha256": "a" * 64,
         "text_sha256": "b" * 64, "extractor_version": "x-1"}
    b = {"evidence_id": "E-B", "file_sha256": "c" * 64,
         "text_sha256": "d" * 64, "extractor_version": "x-1"}
    assert module._manifest_root([a, b]) == module._manifest_root([b, a])
    changed = dict(b, text_sha256="e" * 64)
    assert module._manifest_root([a, b]) != module._manifest_root(
        [a, changed])
