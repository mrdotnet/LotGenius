// API selection: mock (standalone demo) vs HTTP (against the /admin shim).
import type { AdminApi } from "./types";
import { createHttpApi } from "./http";
import { createMockApi } from "./mock";

export * from "./types";

export function createApi(): AdminApi {
  const useMock = import.meta.env.VITE_USE_MOCK === "true";
  if (useMock) {
    return createMockApi();
  }
  const baseUrl = import.meta.env.VITE_ADMIN_API;
  if (!baseUrl) {
    throw new Error(
      "VITE_ADMIN_API is not set and VITE_USE_MOCK is not 'true'. " +
        "Set one in your .env (see .env.example).",
    );
  }
  return createHttpApi(baseUrl);
}
