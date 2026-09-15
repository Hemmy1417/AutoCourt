"""A stored trouble code is never an auto-failure. The diagnostic flag needs
the panel to find an observed EFFECT of a recorded code's fault, quoted from
the record; a quote that names the code, however the model reads it, is not
that. Found live on 0x081Fe3bE…35A7: a scanner report whose road test read
normal still raised the flag (ac-000009)."""

import json

from conftest import (account, build_assessment, downgrades, hist_item, item,
                      panel_answer, panel_says, prompts, svc_item)

SCAN_BUYER = account(3)

CODE_LINE = ("Stored trouble code P0128: coolant temperature below thermostat "
             "regulating temperature.")
SYMPTOMS = ("Road test, 25 minutes: the temperature gauge never rose above the "
            "lower quarter, and the heater blew only lukewarm air.")
NORMAL = ("Road test, 25 minutes: the temperature gauge rose to normal and "
          "stayed there, and the heater blew hot.")


def scan_item(text, codes=("p0128",)):
    return item("E-SCAN", text, uploader=SCAN_BUYER, role="BUYER",
                declared_class="DIAGNOSTIC_SCANNER_REPORT",
                diagnostic_codes=list(codes))


def judged(module, c, scan_text, diagnostic, codes=("p0128",)):
    aid = build_assessment(module, c,
                           items=[svc_item(), hist_item(),
                                  scan_item(scan_text, codes)])
    panel_says(panel_answer(diagnostic=diagnostic))
    c.adjudicate(aid)
    return json.loads(c.get_run(aid, 1))


def test_an_observed_effect_raises_the_flag(module, c):
    run = judged(module, c, f"{CODE_LINE}\n{SYMPTOMS}",
                 {"supported": True, "severity": "MODERATE",
                  "safety_critical": False,
                  "quotes": ["the temperature gauge never rose above the "
                             "lower quarter"]})
    assert run["diagnostic"]["supported"] is True
    assert run["report"]["flags"]["diagnostic_concern_supported"] is True
    assert run["report"]["rollup"] == "DIAGNOSTIC_CONCERN_SUPPORTED"


def test_a_quote_of_the_code_line_is_not_support(module, c):
    """The live failure's shape: the model says supported and quotes the
    line that names the code. It grounds in the record, and still counts for
    nothing."""
    run = judged(module, c, f"{CODE_LINE}\n{NORMAL}",
                 {"supported": True, "severity": "MINOR",
                  "safety_critical": False, "quotes": [CODE_LINE]})
    assert run["diagnostic"] == {"supported": False, "severity": "MINOR",
                                 "safety_critical": False}
    assert run["report"]["flags"]["diagnostic_concern_supported"] is False
    assert run["report"]["rollup"] != "DIAGNOSTIC_CONCERN_SUPPORTED"
    assert any("diagnostic SUPPORTED" in line for line in downgrades())


def test_an_effect_quoted_beside_the_code_line_still_counts(module, c):
    run = judged(module, c, f"{CODE_LINE}\n{SYMPTOMS}",
                 {"supported": True, "severity": "MODERATE",
                  "safety_critical": False,
                  "quotes": [CODE_LINE,
                             "the heater blew only lukewarm air"]})
    assert run["report"]["flags"]["diagnostic_concern_supported"] is True


def test_an_ungrounded_effect_is_not_support(module, c):
    run = judged(module, c, f"{CODE_LINE}\n{NORMAL}",
                 {"supported": True, "severity": "MODERATE",
                  "safety_critical": True,
                  "quotes": ["the engine overheated on the road test"]})
    assert run["report"]["flags"]["diagnostic_concern_supported"] is False
    # An unsupported concern cannot force an inspection either.
    assert run["report"]["inspection_required"] is False


def test_no_recorded_code_means_no_diagnostic_question(module, c):
    run = judged(module, c, f"{CODE_LINE}\n{SYMPTOMS}",
                 {"supported": True, "severity": "MODERATE",
                  "safety_critical": False,
                  "quotes": ["the temperature gauge never rose above the "
                             "lower quarter"]},
                 codes=())
    assert run["report"]["flags"]["diagnostic_concern_supported"] is False


def test_a_code_is_named_in_any_spelling(module):
    for quote in ("P0128 stored", "code p0128", "trouble code P-0128",
                  "P 0128 recorded"):
        assert module._names_a_code(quote, ["P0128"]) is True, quote
    assert module._names_a_code("the gauge stayed low", ["P0128"]) is False
    assert module._names_a_code("P0128 stored", ["P0301"]) is False


def test_the_panel_is_told_what_support_is(module, c):
    judged(module, c, f"{CODE_LINE}\n{SYMPTOMS}", {"supported": False})
    prompt = prompts()[0]
    assert "only lists, names or defines a code is not support" in prompt
    assert "behaved normally, supported is false" in prompt
    assert "never the line that names the code" in prompt
