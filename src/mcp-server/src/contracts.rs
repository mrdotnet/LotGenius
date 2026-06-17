//! The four published tool CONTRACTS — the client-facing Deliverable (PRD §5.1).
//!
//! Each contract is one of `./contracts/*.schema.json`. Those JSON files are the
//! SINGLE SOURCE OF TRUTH for the tool surface; we do not re-declare the schemas in
//! Rust. They are baked into the binary with `include_str!` (resolved relative to
//! `CARGO_MANIFEST_DIR`) so the shipped image carries the exact contracts and so the
//! `--smoke` check needs nothing on disk.

use anyhow::{Context, Result};
use serde_json::{Map, Value};

/// Stable list of the four published tool names, in publish order.
pub const TOOL_NAMES: [&str; 4] = ["comps_search", "structured_query", "pii_scrub", "analyze"];

/// Raw JSON of each contract, embedded at compile time from `./contracts/`.
const COMPS_SEARCH_JSON: &str = include_str!("../contracts/comps_search.schema.json");
const STRUCTURED_QUERY_JSON: &str = include_str!("../contracts/structured_query.schema.json");
const PII_SCRUB_JSON: &str = include_str!("../contracts/pii_scrub.schema.json");
const ANALYZE_JSON: &str = include_str!("../contracts/analyze.schema.json");

/// A parsed tool contract — the fields the MCP layer needs to advertise the tool.
/// The full JSON Schema (`input_schema`) is passed through verbatim from the file.
#[derive(Debug, Clone)]
pub struct Contract {
    pub name: String,
    pub title: Option<String>,
    pub description: String,
    /// The `inputSchema` object, ready to hand to `rmcp::model::Tool`.
    pub input_schema: Map<String, Value>,
}

fn parse(raw: &str) -> Result<Contract> {
    let v: Value = serde_json::from_str(raw).context("contract is not valid JSON")?;

    let name = v
        .get("name")
        .and_then(Value::as_str)
        .context("contract missing string `name`")?
        .to_string();
    let description = v
        .get("description")
        .and_then(Value::as_str)
        .context("contract missing string `description`")?
        .to_string();
    let title = v.get("title").and_then(Value::as_str).map(str::to_string);
    let input_schema = v
        .get("inputSchema")
        .and_then(Value::as_object)
        .cloned()
        .context("contract missing object `inputSchema`")?;

    Ok(Contract {
        name,
        title,
        description,
        input_schema,
    })
}

/// Load and parse all four contracts, in publish order. Fails fast if any contract
/// is malformed or if its `name` does not match the expected published tool name —
/// this is what makes the contracts the single source of truth.
pub fn load_all() -> Result<Vec<Contract>> {
    let raws = [
        COMPS_SEARCH_JSON,
        STRUCTURED_QUERY_JSON,
        PII_SCRUB_JSON,
        ANALYZE_JSON,
    ];
    let mut out = Vec::with_capacity(raws.len());
    for (raw, expected) in raws.iter().zip(TOOL_NAMES.iter()) {
        let c = parse(raw).with_context(|| format!("loading contract `{expected}`"))?;
        anyhow::ensure!(
            c.name == *expected,
            "contract name mismatch: file declares `{}`, expected `{}`",
            c.name,
            expected
        );
        out.push(c);
    }
    Ok(out)
}
