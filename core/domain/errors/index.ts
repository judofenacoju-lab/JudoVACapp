/**
 * Erreurs domain — transportées vers l'UI via IPC sans fuite d'implémentation.
 */
export class DomainError extends Error {
  readonly code: string
  readonly details?: unknown

  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.details = details
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, details)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id?: string) {
    super('NOT_FOUND', id ? `${resource} introuvable: ${id}` : `${resource} introuvable`)
    this.name = 'NotFoundError'
  }
}

export class DuplicateError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('DUPLICATE', message, details)
    this.name = 'DuplicateError'
  }
}

export class SyncError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('SYNC_ERROR', message, details)
    this.name = 'SyncError'
  }
}

export class NetworkError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('NETWORK_ERROR', message, details)
    this.name = 'NetworkError'
  }
}
