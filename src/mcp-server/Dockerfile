# syntax=docker/dockerfile:1
# Lot Genius MCP seam → minimal distroless image (no shell, no package manager — keeps
# the running Background IP opaque, PRD §9.5).
#
# DEFAULT build = the client-facing DELIVERABLE scaffold (contracts + seam, no runtime;
# tool calls return "runtime not present"). It proves the image builds and the seam serves.
#
# Kadima's PRODUCTION build injects the Background-IP runtime crate (see Cargo.toml note)
# and enables it, building for the Container App's arch:
#   docker buildx build --platform linux/amd64 --build-arg FEATURES=runtime \
#     -t <acr>/lotgenius-mcp:<tag> --push .
#
# (Future hardening: a fully static x86_64-unknown-linux-musl binary on `scratch` for an
#  even smaller/opaquer image — needs a cross toolchain in the build stage.)

FROM rust:1.94-slim AS build
ARG FEATURES=""
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY contracts ./contracts
RUN if [ -n "$FEATURES" ]; then EXTRA="--features $FEATURES"; else EXTRA=""; fi; \
    cargo build --release --locked ${EXTRA} \
    && cp target/release/lotgenius-mcp /lotgenius-mcp

# --- final image: distroless (glibc + libgcc only; no shell) ---
FROM gcr.io/distroless/cc-debian12
COPY --from=build /lotgenius-mcp /lotgenius-mcp
# Production serves streamable-HTTP on :8080 via managed identity (PRD §5.1/§8.1);
# the scaffold default serves MCP over stdio.
EXPOSE 8080
ENTRYPOINT ["/lotgenius-mcp"]
