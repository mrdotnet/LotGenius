// HTTP implementation of AdminApi — talks to the /admin shim (the Rust BE).
import type {
  AdminApi,
  DryRunResponse,
  OverrideRequest,
  OverrideResponse,
  RecomputeResponse,
  ReviewResponse,
  UndoResponse,
} from "./types";

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `${init?.method ?? "GET"} ${path} failed: ${res.status} ${res.statusText} ${body}`.trim(),
    );
  }
  return (await res.json()) as T;
}

export function createHttpApi(baseUrl: string): AdminApi {
  const base = baseUrl.replace(/\/$/, "");
  return {
    getReview(limit?: number) {
      const q = limit != null ? `?limit=${encodeURIComponent(limit)}` : "";
      return request<ReviewResponse>(base, `/admin/review${q}`);
    },
    dryRun(req: OverrideRequest) {
      return request<DryRunResponse>(base, "/admin/override/dry-run", {
        method: "POST",
        body: JSON.stringify(req),
      });
    },
    override(req: OverrideRequest) {
      return request<OverrideResponse>(base, "/admin/override", {
        method: "POST",
        body: JSON.stringify(req),
      });
    },
    undo(reversibleHandle: string) {
      return request<UndoResponse>(base, "/admin/undo", {
        method: "POST",
        body: JSON.stringify({ reversible_handle: reversibleHandle }),
      });
    },
    recompute() {
      return request<RecomputeResponse>(base, "/admin/recompute", {
        method: "POST",
      });
    },
  };
}
