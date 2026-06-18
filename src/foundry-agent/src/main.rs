//! Foundry agent registration (Rust) — creates the `lotgenius-orchestrator` agent in the
//! Azure AI Foundry Agent Service project and binds the MCP seam as an MCP tool. The agent
//! discovers the four published tools (comps_search / structured_query / pii_scrub / analyze)
//! from the server's `tools/list`; its instructions + routing come from `agent_definition.json`.
//! This is the Rust replacement for the Python `foundry_app` scaffold — one-shot, operator-run.
//!
//!   LOTGENIUS_AGENTS_ENDPOINT=https://<acct>.services.ai.azure.com/api/projects/<project> \
//!   LOTGENIUS_MCP_SERVER_URL=https://<app>.azurecontainerapps.io/mcp \
//!   LOTGENIUS_INTENT_MODEL=intent \
//!   AAD_TOKEN_AIFOUNDRY=$(az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv) \
//!   cargo run -p lotgenius-foundry-agent

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};

/// The agent definition (system prompt + routing policy + tool list) — the committed source
/// of truth, shared with the Python scaffold.
const AGENT_DEF: &str = include_str!("../../orchestrator/agent/agent_definition.json");

#[tokio::main]
async fn main() -> Result<()> {
    let endpoint = env_var("LOTGENIUS_AGENTS_ENDPOINT")?;
    let mcp_url = env_var("LOTGENIUS_MCP_SERVER_URL")?;
    let model = std::env::var("LOTGENIUS_INTENT_MODEL").unwrap_or_else(|_| "intent".into());
    let api_version =
        std::env::var("LOTGENIUS_AGENTS_API_VERSION").unwrap_or_else(|_| "2025-05-15-preview".into());
    let token = std::env::var("AAD_TOKEN_AIFOUNDRY")
        .ok()
        .filter(|t| !t.trim().is_empty())
        .ok_or_else(|| {
            anyhow!("set AAD_TOKEN_AIFOUNDRY (az account get-access-token --resource https://ai.azure.com)")
        })?;

    let def: Value = serde_json::from_str(AGENT_DEF).context("parse agent_definition.json")?;
    let name = def["name"].as_str().unwrap_or("lotgenius-orchestrator");
    let instructions = def["instructions"].as_str().unwrap_or("");

    // One MCP tool binds the whole seam; the four typed tools are discovered from the server.
    let body = json!({
        "model": model,
        "name": name,
        "description": def["description"],
        "instructions": instructions,
        "tools": [{
            "type": "mcp",
            "server_label": "lotgenius",
            "server_url": mcp_url
        }]
    });

    let url = format!(
        "{}/assistants?api-version={}",
        endpoint.trim_end_matches('/'),
        api_version
    );
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(&token)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .context("create agent request failed")?;
    let status = resp.status();
    let payload: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(anyhow!("create agent HTTP {status}: {payload}"));
    }

    let id = payload["id"].as_str().unwrap_or("?");
    println!("✓ created Foundry agent: id={id}  name={name}  model={model}");
    println!("  MCP tool bound -> {mcp_url} (discovers comps_search/structured_query/pii_scrub/analyze)");
    Ok(())
}

fn env_var(k: &str) -> Result<String> {
    std::env::var(k).map_err(|_| anyhow!("missing required env var {k}"))
}
