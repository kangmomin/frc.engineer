type SenderDebugLevel = "info" | "warn" | "error";

interface SenderDebugEntry {
  source: string;
  scope: string;
  level: SenderDebugLevel;
  message: string;
  details?: Record<string, unknown>;
}

interface FetchJsonWithSenderDebugOptions {
  init?: RequestInit;
  allowStatuses?: number[];
  allowNonJsonStatuses?: number[];
  source?: string;
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function previewBody(value: string, max = 240): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function postSenderDebugLog(baseUrl: string, entry: SenderDebugEntry): void {
  const normalized = trimBaseUrl(baseUrl);
  const method = entry.level === "error" ? console.error : entry.level === "warn" ? console.warn : console.info;
  method(`[sender-debug][${entry.scope}] ${entry.message}`, entry.details ?? {});

  if (!normalized) {
    return;
  }

  void fetch(`${normalized}/api/debug/client-log`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(entry),
  }).catch((error) => {
    console.warn("[sender-debug] failed to post client log", { scope: entry.scope, error: toErrorMessage(error) });
  });
}

export async function fetchJsonWithSenderDebug<T>(
  baseUrl: string,
  path: string,
  scope: string,
  options: FetchJsonWithSenderDebugOptions = {},
): Promise<{ status: number; data: T | null }> {
  const normalized = trimBaseUrl(baseUrl);
  const url = `${normalized}${path}`;
  const startedAt = Date.now();

  try {
    const response = await fetch(url, options.init);
    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    const isAllowedStatus = response.ok || options.allowStatuses?.includes(response.status) === true;

    if (!isAllowedStatus) {
      postSenderDebugLog(normalized, {
        source: options.source ?? "setup-manager",
        scope,
        level: "error",
        message: "Sender HTTP request failed.",
        details: {
          path,
          status: response.status,
          contentType,
          durationMs: Date.now() - startedAt,
          bodyPreview: previewBody(raw),
        },
      });
      throw new Error(`${scope} failed (${response.status})`);
    }

    if (!raw.trim()) {
      return { status: response.status, data: null };
    }

    try {
      return {
        status: response.status,
        data: JSON.parse(raw) as T,
      };
    } catch {
      if (options.allowNonJsonStatuses?.includes(response.status)) {
        return { status: response.status, data: null };
      }
      postSenderDebugLog(normalized, {
        source: options.source ?? "setup-manager",
        scope,
        level: "error",
        message: "Sender HTTP response was not valid JSON.",
        details: {
          path,
          status: response.status,
          contentType,
          durationMs: Date.now() - startedAt,
          bodyPreview: previewBody(raw),
        },
      });
      throw new Error(`${scope} returned invalid JSON.`);
    }
  } catch (error) {
    if (options.init?.signal?.aborted) throw error;
    const message = toErrorMessage(error);
    if (!message.includes("returned invalid JSON.") && !message.includes(" failed (")) {
      postSenderDebugLog(normalized, {
        source: options.source ?? "setup-manager",
        scope,
        level: "error",
        message: "Sender HTTP request threw.",
        details: {
          path,
          durationMs: Date.now() - startedAt,
          error: message,
        },
      });
    }
    throw error instanceof Error ? error : new Error(message);
  }
}
