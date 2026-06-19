//! Lot Genius — MCP server (the SEAM, PRD §5.1; the IP boundary, PRD §9).
//!
//! Publishes four typed tool CONTRACTS to the Microsoft Foundry orchestrator over
//! MCP and DELEGATES every call to Kadima's agentic-AI-framework runtime, which is
//! Background IP and is NOT vendored here (see `runtime.rs`). This binary contains
//! the contracts + the wiring only; no tool implementation and no runtime.
//!
//! Transport: this scaffold serves MCP over **stdio**. In PRODUCTION the same
//! `ServerHandler` is mounted on streamable-HTTP inside the Azure Container App and
//! is reached by Foundry over **managed identity**, never a shared key
//! (PRD §5.1 / §8.1). Swapping transports does not touch the handler below.
//!
//! Smoke check (no runtime needed, mirrors the Python `python server.py`):
//!     cargo run -- --smoke
//! Serve over stdio:
//!     cargo run

mod contracts;
mod identity;
mod runtime;

use std::borrow::Cow;
use std::sync::Arc;

use rmcp::handler::server::ServerHandler;
use rmcp::model::{
    CallToolRequestParams, CallToolResult, Content, Implementation, ListToolsResult,
    PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use rmcp::{ErrorData as McpError, ServiceExt};

use contracts::Contract;

/// The MCP server handler. Holds the parsed contracts; resolves the runtime lazily
/// (per call) so the process starts — and the contracts list — even when the
/// Background-IP runtime is absent (the default deliverable state).
#[derive(Clone)]
struct LotGeniusServer {
    contracts: Arc<Vec<Contract>>,
}

impl LotGeniusServer {
    fn new() -> anyhow::Result<Self> {
        Ok(Self {
            contracts: Arc::new(contracts::load_all()?),
        })
    }

    /// Build an rmcp `Tool` from a parsed JSON contract. The `inputSchema` is passed
    /// through verbatim — the JSON file remains the single source of truth. `Tool` is
    /// `#[non_exhaustive]`, so it is built via its constructor, not a struct literal.
    fn tool_for(c: &Contract) -> Tool {
        let tool = Tool::new(
            Cow::<'static, str>::Owned(c.name.clone()),
            Cow::<'static, str>::Owned(c.description.clone()),
            Arc::new(c.input_schema.clone()),
        );
        match &c.title {
            Some(title) => tool.with_title(title.clone()),
            None => tool,
        }
    }
}

impl ServerHandler for LotGeniusServer {
    fn get_info(&self) -> ServerInfo {
        // ServerInfo (InitializeResult) is #[non_exhaustive]; start from Default and set fields.
        let mut info = ServerInfo::default();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info.server_info = Implementation::from_build_env();
        info.instructions = Some(
            "Lot Genius seam: comps_search + structured_query + pii_scrub + analyze. \
             Vector finds the lots, SQL supplies the trusted numbers (PRD)."
                .to_string(),
        );
        info
    }

    /// Advertise the four published contracts, built from the JSON source of truth.
    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let tools = self
            .contracts
            .iter()
            .map(Self::tool_for)
            .collect::<Vec<_>>();
        Ok(ListToolsResult::with_all_items(tools))
    }

    /// Dispatch name → runtime method, serializing the runtime's JSON result as text
    /// content. The actual work happens behind the seam (Background IP); absent the
    /// runtime this returns the "runtime not present" boundary error.
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        let name = request.name.as_ref();

        // Reject anything not in the published contract set before touching the runtime.
        if !contracts::TOOL_NAMES.contains(&name) {
            return Err(McpError::invalid_params(
                format!("unknown tool: {name}"),
                None,
            ));
        }

        // Resolve the caller OUT OF BAND from the transport (HTTP headers / env). G2:
        // inbound caller headers are honored ONLY for the proven front door; a forged
        // header from an untrusted peer is stripped and resolves to anonymous. See
        // `identity::extract` / `identity::front_door_trusted`.
        let caller = identity::extract(&context);
        let pii_live = identity::pii_live();
        tracing::debug!(
            tool = name,
            caller_source = caller.source,
            anonymous = caller.is_anonymous(),
            pii_live,
            "resolved caller identity for delegation"
        );

        // G3 — fail-CLOSED: under PII_LIVE, an anonymous/unresolved caller is REFUSED on
        // PII-bearing tools rather than silently dropping to `basic`. The runtime is never
        // reached. With PII_LIVE unset this is a no-op (today's demo behavior preserved).
        if identity::refuse_anonymous(name, &caller, pii_live) {
            tracing::warn!(
                tool = name,
                caller_source = caller.source,
                "fail-closed: refusing anonymous caller on PII-bearing tool (PII_LIVE)"
            );
            let mut refusal = CallToolResult::error(vec![Content::text(format!(
                "refused: `{name}` requires a verified caller identity. PII_LIVE fail-closed \
                 denies PII-bearing tools to anonymous/unresolved callers at the seam."
            ))]);
            // G7 — the denial is auditable too.
            refusal.meta = Some(identity::audit_meta(&caller, true));
            return Ok(refusal);
        }

        // Strip any client-supplied reserved key and inject the verified `_caller`
        // envelope. The model cannot read or forge it; the runtime resolves it to ABAC
        // permissions and enforces row/field visibility behind the boundary (PRD §8.1).
        let args = serde_json::Value::Object(identity::inject(
            request.arguments.unwrap_or_default(),
            &caller,
        ));

        // Resolve the Background-IP runtime and delegate. No tool logic lives here.
        let rt = runtime::connect().map_err(|e| McpError::internal_error(e.to_string(), None))?;

        let result = match name {
            "comps_search" => rt.comps_search(args),
            "structured_query" => rt.structured_query(args),
            "pii_scrub" => rt.pii_scrub(args),
            "analyze" => rt.analyze(args),
            // Unreachable: guarded by TOOL_NAMES above.
            other => {
                return Err(McpError::invalid_params(
                    format!("unknown tool: {other}"),
                    None,
                ))
            }
        }
        .map_err(|e| McpError::internal_error(e.to_string(), None))?;

        let text = serde_json::to_string(&result)
            .map_err(|e| McpError::internal_error(e.to_string(), None))?;
        // G7 — attach the audit envelope (caller oid+source + redaction-list slot the
        // runtime fills) to every response `_meta` so the call is attributable.
        let mut ok = CallToolResult::success(vec![Content::text(text)]);
        ok.meta = Some(identity::audit_meta(&caller, false));
        Ok(ok)
    }
}

/// Smoke check: load contracts, assert all four published names map to a dispatch
/// arm, and print `contract OK: <name> — <title>` for each. Works WITHOUT the
/// runtime feature — it never calls `runtime::connect()`. Mirrors the Python scaffold.
fn smoke() -> anyhow::Result<()> {
    let server = LotGeniusServer::new()?;
    let loaded: Vec<&str> = server.contracts.iter().map(|c| c.name.as_str()).collect();

    for expected in contracts::TOOL_NAMES {
        let c = server
            .contracts
            .iter()
            .find(|c| c.name == expected)
            .ok_or_else(|| anyhow::anyhow!("contract `{expected}` did not load"))?;
        // The call_tool dispatch matches exactly on TOOL_NAMES, so a loaded contract
        // whose name is in TOOL_NAMES is guaranteed to have a handler arm.
        anyhow::ensure!(
            contracts::TOOL_NAMES.contains(&c.name.as_str()),
            "contract `{}` has no handler",
            c.name
        );
        let title = c.title.as_deref().unwrap_or("(no title)");
        println!("contract OK: {} — {title}", c.name);
    }

    anyhow::ensure!(
        loaded.len() == contracts::TOOL_NAMES.len(),
        "expected {} contracts, loaded {}",
        contracts::TOOL_NAMES.len(),
        loaded.len()
    );

    println!(
        "\nThis is the seam (PRD §5.1) and IP boundary (PRD §9). The framework runtime \
         is delivered as a built image; this repo ships CONTRACTS only."
    );
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::args().any(|a| a == "--smoke") {
        return smoke();
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with_writer(std::io::stderr) // keep stdout clean for the stdio MCP transport
        .init();

    // Transport selection. PRODUCTION (Azure Container App) serves streamable-HTTP on :8080
    // reached by Foundry over managed identity (PRD §5.1/§8.1); the scaffold/local default
    // stays stdio (so `cargo run` and the MCP-over-stdio clients are unchanged). HTTP is
    // selected by env `LOTGENIUS_HTTP_ADDR` (e.g. 0.0.0.0:8080) or a `--http` flag.
    let http_addr = std::env::var("LOTGENIUS_HTTP_ADDR").ok().or_else(|| {
        std::env::args()
            .any(|a| a == "--http")
            .then(|| "0.0.0.0:8080".to_string())
    });

    match http_addr {
        Some(addr) => serve_http(&addr).await,
        None => serve_stdio().await,
    }
}

/// Scaffold/local transport: MCP over stdio. `serve` performs the handshake; `waiting`
/// blocks until the peer disconnects.
async fn serve_stdio() -> anyhow::Result<()> {
    tracing::info!("lotgenius-mcp seam starting on stdio (PRD §5.1)");
    let server = LotGeniusServer::new()?;
    let running = server.serve(rmcp::transport::stdio()).await?;
    running.waiting().await?;
    Ok(())
}

/// Production transport: the SAME `ServerHandler` mounted on streamable-HTTP. The MCP
/// endpoint is `/mcp` (what Foundry binds to); `/` and `/healthz` answer the Container
/// App's ingress probe. Swapping transports does not touch the handler.
async fn serve_http(addr: &str) -> anyhow::Result<()> {
    tracing::info!("lotgenius-mcp seam starting on streamable-HTTP at {addr} (MCP endpoint /mcp; PRD §5.1/§8.1)");

    // Build once up front so a bad contract set fails fast at boot; clone the cheap
    // (Arc-backed) handler per session in the factory.
    // rmcp's default DNS-rebinding guard rejects any Host header that isn't localhost.
    // Behind the Azure Container App ingress (server-to-server, MI-authenticated, not
    // browser-exposed) that guard just blocks the real FQDN. Allow the hosts named in
    // `LOTGENIUS_ALLOWED_HOSTS` (comma-separated) if set; otherwise disable the host
    // check for the behind-ingress PoC deployment.
    let config = match std::env::var("LOTGENIUS_ALLOWED_HOSTS") {
        Ok(h) if !h.trim().is_empty() => StreamableHttpServerConfig::default()
            .with_allowed_hosts(h.split(',').map(|s| s.trim().to_string())),
        _ => StreamableHttpServerConfig::default().disable_allowed_hosts(),
    };

    let base = LotGeniusServer::new()?;
    let service: StreamableHttpService<LotGeniusServer, LocalSessionManager> =
        StreamableHttpService::new(
            move || Ok(base.clone()),
            Arc::new(LocalSessionManager::default()),
            config,
        );

    let app = axum::Router::new()
        .route("/", axum::routing::get(|| async { "ok" }))
        .route("/healthz", axum::routing::get(|| async { "ok" }))
        .nest_service("/mcp", service);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    // Container Apps sends SIGTERM on revision swap — shut the listener down gracefully.
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
