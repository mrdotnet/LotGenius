/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_EXPLORER_SOURCE?: string;
  readonly VITE_EXPLORER_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
