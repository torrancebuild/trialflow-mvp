const noop = async () => undefined

export function retryDelay(attempt, { baseDelayMs = 1000, maxDelayMs = 60 * 60 * 1000, jitter = 0, random = Math.random } = {}) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)))
  return Math.max(0, Math.round(exponential + (jitter ? (random() * 2 - 1) * jitter : 0)))
}

export function createOutboxWorker({ repository, handlers = {}, clock = () => Date.now(), leaseMs = 60_000, maxAttempts = 5, retry = {}, beforeSend = noop, afterSend = noop, onError = noop } = {}) {
  if (!repository?.claim || !repository?.markSent || !repository?.markRetry || !repository?.markFailed) throw new Error('Outbox repository must implement claim, markSent, markRetry, and markFailed.')
  const token = () => `${clock()}-${Math.random().toString(36).slice(2)}`

  return {
    async runOnce({ workspaceId, limit = 10 } = {}) {
      const jobs = await repository.claim({ workspaceId, limit, leaseMs, now: new Date(clock()) }) ?? []
      const results = []
      for (const job of jobs) {
        const leaseToken = job.leaseToken ?? job.lease_token
          const finish = async (method, payload) => repository[method]({ ...payload, workspaceId: job.workspaceId ?? job.workspace_id, id: job.id, leaseToken })
        try {
          const prior = await beforeSend({ job, leaseToken })
          if (prior?.sent || prior?.skip) {
            await finish('markSent', { result: prior.result, providerMessageId: prior.providerMessageId })
            results.push({ id: job.id, status: 'sent', skipped: true })
            continue
          }
          const handler = handlers[job.kind] ?? handlers[job.type] ?? handlers.default
          if (typeof handler !== 'function') throw new Error(`No outbox handler registered for ${job.kind ?? job.type}.`)
          const result = await handler(job.payload, { job, leaseToken })
          await finish('markSent', { result, providerMessageId: result?.providerMessageId })
          await afterSend({ job, result, leaseToken })
          results.push({ id: job.id, status: 'sent', result })
        } catch (error) {
          // The claim RPC increments attempts when it acquires the lease.
          const attempts = Math.max(1, Number(job.attempts ?? job.attempt ?? 0))
          const transient = error?.transient === true || error?.status === 408 || error?.status === 429 || error?.status >= 500
          if (transient && attempts < maxAttempts) {
            const delay = retryDelay(attempts, retry)
            await finish('markRetry', { attempts, nextAttemptAt: new Date(clock() + delay), delayMs: delay, error })
            results.push({ id: job.id, status: 'retry', attempts, delayMs: delay })
          } else {
            await finish('markFailed', { attempts, error })
            results.push({ id: job.id, status: 'failed', attempts })
          }
          await onError({ job, error, attempts, transient })
        }
      }
      return results
    },
  }
}
