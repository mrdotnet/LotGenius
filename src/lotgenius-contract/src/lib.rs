//! The Lot Genius runtime INTERFACE — the narrow seam across the IP boundary (PRD §9).
//!
//! This crate is part of the **Deliverable**: it declares *what* the four published
//! tools look like as a Rust trait, but contains **no tool logic and no runtime**.
//! Both sides of the boundary depend on it:
//!
//! - `lotgenius-mcp` (the seam) calls the trait to dispatch MCP tool calls.
//! - `lotgenius-runtime-rs` (Kadima Background IP, NOT in this repo) implements it.
//!
//! Keeping the trait here — rather than inline in the seam — gives a single shared
//! definition with **no circular dependency**: the seam depends on this crate, the
//! runtime depends on this crate, and this crate depends on neither.
//!
//! The trait deliberately speaks in `serde_json::Value`. The wire contract is the JSON
//! described by `contracts/*.schema.json`; the runtime owns its own internal types and
//! never leaks them across the boundary. That is what keeps the seam narrow.

use anyhow::Result;
use serde_json::Value;

/// The implementation contract every tool call is delegated across. Mirrors the four
/// published tools 1:1. Implemented by the Background-IP runtime, never in this repo.
///
/// Each method takes the tool's `arguments` object (per its `contracts/*.schema.json`)
/// and returns the tool's JSON result object. Errors surface as MCP `internal_error`.
pub trait LotGeniusRuntime: Send + Sync {
    /// Semantic comparable-lot retrieval over pgvector. Returns lot_ids + similarity.
    fn comps_search(&self, args: Value) -> Result<Value>;
    /// Parameterized, allowlisted Synapse aggregates — the authoritative numbers.
    fn structured_query(&self, args: Value) -> Result<Value>;
    /// Server-side PII redaction hard gate, before data leaves the boundary.
    fn pii_scrub(&self, args: Value) -> Result<Value>;
    /// Classification gate + reasoning + receipt; refuses below the confidence floor.
    fn analyze(&self, args: Value) -> Result<Value>;
}

/// The message returned when the framework runtime is absent (the default state of the
/// deliverable repository). Mirrors the Python scaffold's `NotImplementedError` text.
pub const RUNTIME_ABSENT_MSG: &str =
    "framework runtime not present — this repo ships tool CONTRACTS only; \
     the implementation is delivered as a built image (PRD §9.4)";
