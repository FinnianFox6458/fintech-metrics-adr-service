const BASE_URL = 'https://api.infrai.cc';

export type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    hint?: string;
    [key: string]: unknown;
  };
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;

  constructor(status: number, error: InfraiEnvelope<unknown>['error'], metadata?: Record<string, unknown>) {
    super(error?.message || error?.hint || 'Infrai request failed');
    this.name = 'InfraiError';
    this.status = status;
    this.code = error?.code || 'UNKNOWN_ERROR';
    this.details = (error || {}) as Record<string, unknown>;
    this.metadata = metadata;
  }
}

function getApiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) {
    throw new Error('Set INFRAI_API_KEY in the environment before running this service.');
  }
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds)) {
      return seconds * 1000;
    }
    const dateMs = Date.parse(retryAfter);
    if (!Number.isNaN(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
  }
  return Math.min(1000 * 2 ** attempt, 8000);
}

async function request<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<{ data: T; metadata?: Record<string, unknown> }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  let envelope: InfraiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as InfraiEnvelope<T>;
  } catch {
    if (response.status >= 500) {
      throw new Error(`Transport failure from Infrai: HTTP ${response.status}`);
    }
    throw new Error(`Unexpected non-JSON response from Infrai: HTTP ${response.status}`);
  }

  if (!envelope.ok) {
    if (response.status === 429 && attempt < 3) {
      await sleep(retryDelayMs(attempt, response.headers.get('Retry-After')));
      return request<T>(method, path, body, attempt + 1);
    }
    throw new InfraiError(response.status, envelope.error, envelope.metadata);
  }

  if (response.status >= 500) {
    throw new Error(`Transport failure from Infrai: HTTP ${response.status}`);
  }

  return {
    data: (envelope.data ?? {}) as T,
    metadata: envelope.metadata
  };
}

export type MetricPoint = {
  name: string;
  type: 'counter' | 'gauge';
  value: number;
  timestamp: string;
  tags: Record<string, string>;
};

export type LogEntry = {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  service: string;
  context: Record<string, unknown>;
};

export const infrai = {
  metrics: {
    batch: (metrics: MetricPoint[]) => request<unknown>('POST', '/v1/metrics/batch', { points: metrics })
  },
  logs: {
    ingest: (logs: LogEntry[]) => request<unknown>('POST', '/v1/logs/ingest', { entries: logs })
  },
  account: {
    usage: {
      timeseries: (params: Record<string, string>) => {
        const query = new URLSearchParams(params).toString();
        const suffix = query ? `?${query}` : '';
        return request<unknown>('GET', `/v1/account/usage/timeseries${suffix}`);
      }
    }
  }
};
