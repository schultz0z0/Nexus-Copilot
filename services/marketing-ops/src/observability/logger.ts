const sensitiveKeys = /authorization|cookie|token|secret|password|api[-_]?key|delegation|briefing|notes?|comment|reason|objective|audience|title|label|metadata|body|event[-_]?key|filename|file[-_]?name|signed[-_]?url|access[-_]?url|bytes|payload|query|content|error/i;
const sensitiveString = /bearer\s+[a-z0-9._~-]{8,}|eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}|https?:\/\/\S+[?&](?:token|signature|sig)=[^\s&]+|(?:api[-_]?key|password|secret)\s*[=:]\s*\S{8,}/i;

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  if (typeof value === 'string') return sensitiveString.test(value) ? '[REDACTED]' : value;
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    sensitiveKeys.test(key) ? '[REDACTED]' : redact(nested, seen)
  ]));
}

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export function createLogger(sink: (entry: Record<string, unknown>) => void = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`)): Logger {
  const write = (level: string, message: string, data?: Record<string, unknown>) => sink({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(data ? { data: redact(data) } : {})
  });
  return {
    info: (message, data) => write('info', message, data),
    warn: (message, data) => write('warn', message, data),
    error: (message, data) => write('error', message, data)
  };
}
