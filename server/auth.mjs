import { unauthorized } from './errors.mjs'

function headerValue(headers, name) {
  if (!headers) return undefined
  if (typeof headers.get === 'function') return headers.get(name) || undefined
  const wanted = name.toLowerCase()
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted)
  return key ? headers[key] : undefined
}

export function bearerToken(request) {
  const value = headerValue(request?.headers, 'authorization')
  if (!value || typeof value !== 'string') return undefined
  const match = value.match(/^Bearer\s+([^\s]+)$/i)
  return match?.[1]
}

export function createSupabaseAuthProvider({ url, publishableKey, fetchImpl = globalThis.fetch }) {
  if (!url || !publishableKey || typeof fetchImpl !== 'function') {
    throw new Error('Supabase auth requires url, publishableKey, and fetchImpl.')
  }
  const endpoint = `${url.replace(/\/$/, '')}/auth/v1/user`

  return {
    async verifyAccessToken(token) {
      if (!token) throw unauthorized()
      const response = await fetchImpl(endpoint, {
        headers: { apikey: publishableKey, authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw unauthorized('Invalid or expired access token.')
      const user = await response.json()
      if (!user?.id) throw unauthorized('Auth provider returned no user.')
      return { id: user.id, email: user.email, metadata: user.user_metadata ?? {} }
    },
  }
}

export async function authenticate(request, authProvider) {
  if (!authProvider || typeof authProvider.verifyAccessToken !== 'function') {
    throw new Error('An auth provider with verifyAccessToken is required.')
  }
  const token = bearerToken(request)
  if (!token) throw unauthorized()
  const principal = await authProvider.verifyAccessToken(token)
  if (!principal?.id) throw unauthorized('Auth provider returned an invalid principal.')
  return principal
}
