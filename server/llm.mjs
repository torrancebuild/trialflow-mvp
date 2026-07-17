import { redactPii } from './security.mjs'

export const LLM_STATUS = Object.freeze({ OK: 'ok', NEEDS_HUMAN: 'needs_human' })
export const DEFAULT_LLM_TIMEOUT_MS = 10_000

function validate(value, schema, path = '$', errors = []) {
  if (!schema) return errors
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) errors.push(`${path} must be one of the allowed values`)
  if (schema.type) {
    const valid = schema.type === 'null' ? value === null : schema.type === 'array' ? Array.isArray(value) : schema.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : typeof value === schema.type
    if (!valid) return errors.concat(`${path} must be ${schema.type}`)
  }
  if (schema.required && value && typeof value === 'object') for (const key of schema.required) if (!(key in value)) errors.push(`${path}.${key} is required`)
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(schema.properties)) if (key in value) validate(value[key], child, `${path}.${key}`, errors)
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in schema.properties)) errors.push(`${path}.${key} is not allowed`)
  }
  if (schema.items && Array.isArray(value)) value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`, errors))
  return errors
}

export function validateStructuredOutput(value, schema) {
  const errors = validate(value, schema)
  return { valid: errors.length === 0, errors }
}

function timeoutError(timeoutMs) {
  const error = new Error(`LLM request timed out after ${timeoutMs}ms.`)
  error.code = 'LLM_TIMEOUT'
  return error
}

function withTimeout(promise, timeoutMs) {
  let timer
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError(timeoutMs)), timeoutMs) }),
  ]).finally(() => clearTimeout(timer))
}

/**
 * Adapter contract: provider({ input, schema, model, promptVersion }) -> object
 * or { output: object }. Failures are deliberately safe and actionable.
 */
export function createLlmAdapter({ provider, schema, model = 'unspecified', promptVersion = 'unspecified', timeoutMs = DEFAULT_LLM_TIMEOUT_MS, logger = () => {}, audit = () => {}, clock = () => new Date() } = {}) {
  if (typeof provider !== 'function') throw new TypeError('LLM provider must be a function.')
  return Object.freeze({
    model,
    promptVersion,
    async complete(input, options = {}) {
      const startedAt = clock()
      const metadata = { model, promptVersion, startedAt: startedAt.toISOString() }
      try {
        const response = await withTimeout(provider({ input, schema, model, promptVersion, ...options }), options.timeoutMs ?? timeoutMs)
        const output = response && Object.prototype.hasOwnProperty.call(response, 'output') ? response.output : response
        const result = validateStructuredOutput(output, options.schema ?? schema)
        if (!result.valid) {
          const error = new Error('LLM output failed schema validation.')
          error.code = 'LLM_SCHEMA_INVALID'
          error.details = result.errors
          throw error
        }
        const success = { status: LLM_STATUS.OK, output, metadata: { ...metadata, completedAt: clock().toISOString() } }
        audit('llm.completed', { ...metadata, status: success.status })
        return success
      } catch (error) {
        const safeError = { code: error?.code ?? 'LLM_ERROR', message: error?.message ?? 'LLM request failed.' }
        logger('llm.fallback', { ...metadata, ...safeError })
        audit('llm.fallback', { ...metadata, ...safeError, status: LLM_STATUS.NEEDS_HUMAN })
        return { status: LLM_STATUS.NEEDS_HUMAN, reason: 'llm_unavailable', metadata: { ...metadata, errorCode: safeError.code } }
      }
    },
  })
}

export const createStructuredLlmAdapter = createLlmAdapter
export const redactLlmInput = redactPii
