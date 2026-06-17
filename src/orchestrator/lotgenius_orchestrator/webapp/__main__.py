"""`python -m lotgenius_orchestrator.webapp` — launch the local demo chat server.

Reads PORT (default 8000). The seam command + profile/creds (LOTGENIUS_*,
AOAI_*) are read from the environment and forwarded into the spawned seam by
StdioMCPClient — nothing local-dev-specific is baked in.
"""

from __future__ import annotations

import os


def main() -> None:
    import uvicorn

    from .app import create_app

    port = int(os.environ.get("PORT", "8000"))
    app = create_app()  # live stdio seam from env
    # host 127.0.0.1: this is a LOCAL demo client, not a public service.
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
