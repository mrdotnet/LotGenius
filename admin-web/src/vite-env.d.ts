/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ADMIN_API?: string;
  readonly VITE_USE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
