function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (isRecord(error)) {
    const response = isRecord(error.response) ? error.response.data : error;
    if (isRecord(response)) {
      if (typeof response.detail === 'string') return response.detail;
      if (Array.isArray(response.detail)) {
        const details = response.detail
          .filter(isRecord)
          .map((item) => typeof item.msg === 'string' ? item.msg : '')
          .filter(Boolean);
        if (details.length) return details.join('；');
      }
    }
  }
  return error instanceof Error ? error.message : fallback;
}
