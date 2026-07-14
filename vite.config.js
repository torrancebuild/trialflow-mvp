import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import login from './api/auth/login.js'
import session from './api/auth/session.js'
import logout from './api/auth/logout.js'
import health from './api/health.js'
import workflow from './api/workflow.js'

const apiRoutes = {
  '/api/auth/login': login,
  '/api/auth/session': session,
  '/api/auth/logout': logout,
  '/api/health': health,
  '/api/workflow': workflow,
}

function localApi() {
  return {
    name: 'trialflow-local-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url, 'http://localhost').pathname
        const handler = apiRoutes[pathname]
        if (!handler) return next()
        Promise.resolve(handler(req, res)).catch((error) => {
          server.ssrFixStacktrace(error)
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'Internal server error' }))
        })
      })
    },
  }
}

export default defineConfig({ plugins: [react(), localApi()] })
