"""Caller-identity propagation — the Deliverable half of the Item 3 ABAC seam.

The MCP seam (``src/mcp-server/src/identity.rs``) resolves the caller OUT OF BAND
from the transport: it reads HTTP headers set by the trusted front door, STRIPS
any client-supplied value, and injects a verified ``_caller`` envelope that the
Background-IP runtime resolves to effective ABAC permissions
(``app_resolve_permissions`` → ``can_see_pii`` / ``can_admin``) and enforces
field-level PII redaction behind the boundary.

This module is the orchestrator's half: it carries a caller identity and renders
it into exactly the headers the seam trusts, so the seam's PII gate takes effect
end-to-end. Two rules, both mirroring the seam:

1. **Identity rides the transport, never the tool arguments.** We send it as HTTP
   headers, not in the JSON body — the seam overwrites/strips anything in-band, so
   the headers are the only channel an LLM-driven agent cannot forge.
2. **Header names match the seam exactly.** ``x-lotgenius-caller-oid`` /
   ``x-lotgenius-caller-upn`` are the seam's explicit precedence headers (it falls
   back to Azure Easy-Auth ``x-ms-client-principal-*`` when those are absent).
"""

from __future__ import annotations

from dataclasses import dataclass

# Must match src/mcp-server/src/identity.rs `extract()` header precedence.
CALLER_OID_HEADER = "x-lotgenius-caller-oid"
CALLER_UPN_HEADER = "x-lotgenius-caller-upn"


@dataclass(frozen=True)
class CallerIdentity:
    """A signed-in caller, as the orchestrator forwards it to the seam.

    Either field may be set; the seam/runtime prefers ``oid`` (stable Entra
    object id) and falls back to ``upn``. ``label`` is a human-facing display
    string for the demo selector and logs — it is NEVER sent on the wire (the
    seam resolves permissions from oid/upn, not from any client-supplied label).
    """

    oid: str | None = None
    upn: str | None = None
    label: str = ""

    @property
    def is_anonymous(self) -> bool:
        """No verified principal — the seam then applies the default ``basic`` group."""
        return not self.oid and not self.upn

    def headers(self) -> dict[str, str]:
        """The caller headers to attach to an MCP request.

        Only non-empty fields are emitted, so an anonymous caller sends no caller
        headers at all (and the seam resolves it as the default ``basic`` group).
        """
        out: dict[str, str] = {}
        if self.oid:
            out[CALLER_OID_HEADER] = self.oid
        if self.upn:
            out[CALLER_UPN_HEADER] = self.upn
        return out


# A caller with no principal — the seam resolves it to the default `basic` group.
ANONYMOUS = CallerIdentity(label="anonymous")
