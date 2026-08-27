export interface ValidationIssue {
  path: Array<string | number>;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidationIssue(value: unknown): value is ValidationIssue {
  if (
    !isRecord(value)
    || !Array.isArray(value.path)
    || typeof value.message !== 'string'
    || value.message.length === 0
  ) {
    return false;
  }
  return value.path.every((segment) => typeof segment === 'string' || typeof segment === 'number');
}

export function validationIssues(value: unknown): ValidationIssue[] | null {
  if (!isRecord(value) || !Array.isArray(value.issues) || !value.issues.every(isValidationIssue)) {
    return null;
  }
  return value.issues;
}
