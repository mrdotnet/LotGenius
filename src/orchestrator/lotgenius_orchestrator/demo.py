"""Demo signed-in users for the Teams stand-in — the headline PII differential.

These three callers mirror the baseline groups seeded in
``infra/db/identity.sql`` (``basic`` / ``appraiser`` / ``admin``). In the LIVE
path the seam resolves a caller's permissions from that table via
``app_resolve_permissions``; offline, the ``MockMCPClient`` needs a stand-in for
that resolver so the demo + tests can show the PII differential without a
database.

``DEMO_CALLERS`` is that stand-in. Two honesty caveats:

- It is **not** the policy of record. The DB is. This map only lets the offline
  mock emulate ``app_resolve_permissions`` so a demo operator can switch callers
  and SEE the differential (admin sees consignor PII; basic/appraiser get
  ``[REDACTED]``) with no Azure.
- These are **demo identities only** — fabricated oids/upns on a ``*.example``
  domain. No secrets, no real tenant principals.
"""

from __future__ import annotations

from dataclasses import dataclass

from .identity import CallerIdentity


@dataclass(frozen=True)
class DemoCaller:
    """A demo signed-in user: a transport identity + the permissions the seeded
    group would resolve to (mirrors ``app_group_permissions``)."""

    role: str
    identity: CallerIdentity
    can_see_pii: bool
    can_admin: bool
    clearance_tier: int


# Keyed by role. Mirrors the three rows seeded in infra/db/identity.sql:
#   basic     → tier 0, no PII, no admin   (the default group)
#   appraiser → tier 1, no PII, no admin
#   admin     → tier 2, PII + admin
DEMO_CALLERS: dict[str, DemoCaller] = {
    "basic": DemoCaller(
        role="basic",
        identity=CallerIdentity(
            oid="00000000-0000-0000-0000-0000000000b1",
            upn="taylor.basic@steffes-demo.example",
            label="Taylor — basic",
        ),
        can_see_pii=False,
        can_admin=False,
        clearance_tier=0,
    ),
    "appraiser": DemoCaller(
        role="appraiser",
        identity=CallerIdentity(
            oid="00000000-0000-0000-0000-0000000000a9",
            upn="jordan.appraiser@steffes-demo.example",
            label="Jordan — appraiser",
        ),
        can_see_pii=False,
        can_admin=False,
        clearance_tier=1,
    ),
    "admin": DemoCaller(
        role="admin",
        identity=CallerIdentity(
            oid="00000000-0000-0000-0000-0000000000ad",
            upn="sam.admin@steffes-demo.example",
            label="Sam — admin",
        ),
        can_see_pii=True,
        can_admin=True,
        clearance_tier=2,
    ),
}

# Unassigned / unknown callers inherit the default group (PRD §8.1; identity.sql).
DEFAULT_DEMO_ROLE = "basic"


def demo_caller(role: str | None) -> DemoCaller:
    """Resolve a role name to a DemoCaller, defaulting to ``basic``."""
    return DEMO_CALLERS.get((role or DEFAULT_DEMO_ROLE).lower(), DEMO_CALLERS[DEFAULT_DEMO_ROLE])


def resolve_demo_pii(caller: CallerIdentity | None) -> bool:
    """Offline stand-in for ``app_resolve_permissions(...).can_see_pii``.

    Matches a caller to a seeded demo group by oid (preferred) or upn — exactly
    the keys the seam resolves on. Any unknown / anonymous caller falls back to
    the default ``basic`` group, which cannot see PII.
    """
    if caller is None:
        return False
    for dc in DEMO_CALLERS.values():
        if caller.oid and caller.oid == dc.identity.oid:
            return dc.can_see_pii
        if caller.upn and caller.upn == dc.identity.upn:
            return dc.can_see_pii
    return False
