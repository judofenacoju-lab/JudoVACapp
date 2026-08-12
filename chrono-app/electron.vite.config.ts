import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const chronoDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(chronoDir, '..')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(root, 'out-chrono/main'),
      rollupOptions: {
        input: {
          index: resolve(chronoDir, 'electron/main.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(root, 'shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(root, 'out-chrono/preload'),
      rollupOptions: {
        input: {
          index: resolve(chronoDir, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: chronoDir,
    build: {
      outDir: resolve(root, 'out-chrono/renderer'),
      rollupOptions: {
        input: {
          index: resolve(chronoDir, 'index.html')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(root, 'shared')
      }
    },
    plugins: [react()]
  }
})
