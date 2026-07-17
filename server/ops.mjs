export function createMetrics() {
  const counters = new Map()
  return Object.freeze({
    increment(name, value = 1) { counters.set(name, (counters.get(name) ?? 0) + value) },
    snapshot() { return Object.fromEntries(counters) },
  })
}

export async function healthCheck({ db, provider, version = 'unknown' } = {}) {
  const checks = {}
  try { checks.database = db ? await db() !== false : true } catch { checks.database = false }
  try { checks.provider = provider ? await provider() !== false : true } catch { checks.provider = false }
  const healthy = Object.values(checks).every(Boolean)
  return { status: healthy ? 'ok' : 'degraded', version, checks, timestamp: new Date().toISOString() }
}
