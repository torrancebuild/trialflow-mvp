export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    if (details !== undefined) this.details = details
  }
}

export const unauthorized = (message = 'Authentication required.') => new ApiError(401, 'UNAUTHORIZED', message)
export const forbidden = (message = 'You are not allowed to access this workspace.') => new ApiError(403, 'FORBIDDEN', message)
export const badRequest = (message, details) => new ApiError(400, 'BAD_REQUEST', message, details)
export const conflict = (message = 'The resource changed. Reload and try again.') => new ApiError(409, 'CONFLICT', message)
