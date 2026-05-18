import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

function buildId() {
  const env = globalThis.process?.env || {}
  if (env.VITE_DEPLOYMENT_ID) return env.VITE_DEPLOYMENT_ID
  if (env.VERCEL_DEPLOYMENT_ID) return env.VERCEL_DEPLOYMENT_ID
  if (env.VERCEL_GIT_COMMIT_SHA) return env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)

  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId()),
  },
})
