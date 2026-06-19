"""Unit tests for caller identity, the demo group stand-in, and PII redaction.

These cover the load-bearing primitives of the Item 4 caller-identity seam in
isolation (no orchestrator, no HTTP):
  - CallerIdentity renders ONLY the seam-trusted headers, and only when set.
  - The demo callers mirror infra/db/identity.sql (basic/appraiser/admin).
  - resolve_demo_pii() stands in for app_resolve_permissions().can_see_pii.
  - redact_pii() reproduces the seam's field-level consignor gate.
"""

from __future__ import annotations

from lotgenius_orchestrator.demo import (
    DEFAULT_DEMO_ROLE,
    DEMO_CALLERS,
    demo_caller,
    resolve_demo_pii,
)
from lotgenius_orchestrator.identity import (
    ANONYMOUS,
    CALLER_OID_HEADER,
    CALLER_UPN_HEADER,
    CallerIdentity,
)
from lotgenius_orchestrator.mcp_client import REDACTION_MARK, redact_pii


def test_headers_emit_only_seam_trusted_names() -> None:
    c = CallerIdentity(oid="abc", upn="a@b.example", label="x")
    assert c.headers() == {CALLER_OID_HEADER: "abc", CALLER_UPN_HEADER: "a@b.example"}
    # Header names match src/mcp-server/src/identity.rs exactly.
    assert CALLER_OID_HEADER == "x-lotgenius-caller-oid"
    assert CALLER_UPN_HEADER == "x-lotgenius-caller-upn"


def test_headers_omit_unset_fields() -> None:
    assert CallerIdentity(oid="abc").headers() == {CALLER_OID_HEADER: "abc"}
    assert CallerIdentity(upn="a@b.example").headers() == {CALLER_UPN_HEADER: "a@b.example"}


def test_anonymous_sends_no_headers() -> None:
    assert ANONYMOUS.is_anonymous is True
    assert ANONYMOUS.headers() == {}
    assert CallerIdentity().is_anonymous is True


def test_label_is_never_sent_on_the_wire() -> None:
    # The display label must never leak into headers (the seam resolves on oid/upn).
    c = CallerIdentity(oid="abc", label="Sam — admin")
    assert "Sam — admin" not in c.headers().values()


def test_demo_callers_mirror_identity_sql() -> None:
    assert set(DEMO_CALLERS) == {"basic", "appraiser", "admin"}
    assert DEMO_CALLERS["basic"].can_see_pii is False
    assert DEMO_CALLERS["appraiser"].can_see_pii is False
    assert DEMO_CALLERS["admin"].can_see_pii is True
    assert DEMO_CALLERS["admin"].can_admin is True
    # Clearance tiers ascend basic(0) < appraiser(1) < admin(2).
    assert DEMO_CALLERS["basic"].clearance_tier == 0
    assert DEMO_CALLERS["appraiser"].clearance_tier == 1
    assert DEMO_CALLERS["admin"].clearance_tier == 2


def test_demo_caller_defaults_to_basic() -> None:
    assert demo_caller(None).role == DEFAULT_DEMO_ROLE == "basic"
    assert demo_caller("nope").role == "basic"
    assert demo_caller("ADMIN").role == "admin"  # case-insensitive


def test_resolve_demo_pii_matches_seeded_groups() -> None:
    assert resolve_demo_pii(DEMO_CALLERS["admin"].identity) is True
    assert resolve_demo_pii(DEMO_CALLERS["appraiser"].identity) is False
    assert resolve_demo_pii(DEMO_CALLERS["basic"].identity) is False
    # Anonymous / unknown -> default basic group -> no PII.
    assert resolve_demo_pii(None) is False
    assert resolve_demo_pii(CallerIdentity(oid="unknown")) is False


def test_resolve_demo_pii_prefers_oid_then_upn() -> None:
    admin = DEMO_CALLERS["admin"].identity
    # Match by upn alone (no oid) still resolves the group.
    assert resolve_demo_pii(CallerIdentity(upn=admin.upn)) is True
    assert resolve_demo_pii(CallerIdentity(oid=admin.oid)) is True


def test_redact_pii_masks_value_keys() -> None:
    obj = {"lot_id": 7, "consignor_name": "Dale", "consignor_phone": "701-555-0142"}
    out = redact_pii(obj)
    assert out["lot_id"] == 7  # non-PII untouched
    assert out["consignor_name"] == REDACTION_MARK
    assert out["consignor_phone"] == REDACTION_MARK


def test_redact_pii_masks_whole_container_subtree() -> None:
    obj = {"top_consignor": {"name": "Dale", "phone": "x", "lots": [1, 2]}}
    out = redact_pii(obj)
    assert out["top_consignor"]["name"] == REDACTION_MARK
    assert out["top_consignor"]["phone"] == REDACTION_MARK
    assert out["top_consignor"]["lots"] == [REDACTION_MARK, REDACTION_MARK]


def test_redact_pii_recurses_into_lists_and_does_not_mutate_input() -> None:
    obj = {"rows": [{"lot_id": 1, "consignor_email": "a@b.example"}]}
    out = redact_pii(obj)
    assert out["rows"][0]["consignor_email"] == REDACTION_MARK
    assert out["rows"][0]["lot_id"] == 1
    # Input is not mutated (deep copy semantics).
    assert obj["rows"][0]["consignor_email"] == "a@b.example"
