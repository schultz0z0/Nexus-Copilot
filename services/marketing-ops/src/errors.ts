export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function appError(code: string, status: number, message: string, details?: unknown): AppError {
  return new AppError(code, status, message, details);
}

export function errorEnvelope(error: AppError, correlationId: string) {
  return {
    error: {
      code: error.code,
      message: error.message,
      correlationId,
      ...(error.details === undefined ? {} : { details: error.details })
    }
  };
}
