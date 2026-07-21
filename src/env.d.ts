/// <reference types="vite/client" />

import type { JudovacApi } from './lib/judovac-client'

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  interface Window {
    judovac: JudovacApi
  }
}

export {}
