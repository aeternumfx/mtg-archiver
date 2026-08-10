/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_BUILD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
