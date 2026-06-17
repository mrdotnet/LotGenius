//! The IP boundary (PRD §9).
//!
//! This module is the single, narrow seam between the published CONTRACTS (this
//! repo, the Deliverable) and Kadima's agentic-AI-framework runtime (Background IP).
//! The runtime is NOT vendored here. It is supplied only by the `lotgenius-mcp`
//! container image build via the optional `lotgenius_runtime` crate behind the
//! `runtime` cargo feature.
//!
//! The interface itself — `trait LotGeniusRuntime` + the boundary error — lives in the
//! shared `lotgenius-contract` crate (also part of the Deliverable), so the seam and
//! the Background-IP runtime share ONE definition with no circular dependency. This
//! module re-exports it and owns only the `connect()` accessor.
//!
//! - DEFAULT build (no features): `connect()` returns the "runtime not present"
//!   error. The repo compiles and the `--smoke` check passes without any
//!   implementation on disk. No tool logic lives in this repo — by design.
//! - IMAGE build (`--features runtime`): `connect()` delegates to the real crate.

use anyhow::Result;

// The interface is published by the shared contract crate. Re-exported here so the rest
// of the seam keeps using `runtime::LotGeniusRuntime` / `runtime::RUNTIME_ABSENT_MSG`.
// `RUNTIME_ABSENT_MSG` is consumed only by the default (no-runtime) `connect()` arm, so
// it reads as unused under `--features runtime`; the re-export stays for the seam's API.
pub use lotgenius_contract::LotGeniusRuntime;
#[allow(unused_imports)]
pub use lotgenius_contract::RUNTIME_ABSENT_MSG;

/// Resolve the Kadima agentic-AI-framework runtime.
///
/// Kept behind this single accessor so the seam stays clean and the IP stays out of
/// source. See module docs for the two build modes.
#[cfg(feature = "runtime")]
pub fn connect() -> Result<Box<dyn LotGeniusRuntime>> {
    // Provided ONLY by the built image. The external crate is expected to expose a
    // `connect()` returning a value that implements `LotGeniusRuntime`. This arm is
    // never compiled in a default checkout (the optional dep is not resolved).
    let rt = lotgenius_runtime::connect()?;
    Ok(Box::new(rt))
}

/// Default (deliverable) build: the runtime is not present. Return the boundary
/// error rather than any stub implementation — no tool logic lives in this repo.
#[cfg(not(feature = "runtime"))]
pub fn connect() -> Result<Box<dyn LotGeniusRuntime>> {
    anyhow::bail!(RUNTIME_ABSENT_MSG)
}
