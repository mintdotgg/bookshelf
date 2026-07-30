import type { CatalogRecord } from "./record-catalog";

export const localLibraryOrigin = (
  process.env.NEXT_PUBLIC_LOCAL_LIBRARY_URL ??
  "http://127.0.0.1:4317"
).replace(/\/+$/, "");

export class LocalLibraryApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "LocalLibraryApiError";
    this.code = code;
    this.status = status;
  }
}

type LocalNetworkRequestInit = RequestInit & {
  targetAddressSpace?: "loopback";
};

async function fetchLocalLibrary(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      targetAddressSpace: "loopback",
    } as LocalNetworkRequestInit);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    const browserOrigin =
      typeof window === "undefined" ? "this site" : window.location.origin;
    throw new LocalLibraryApiError(
      `Side One could not reach the local music helper at ${localLibraryOrigin}. Start the helper, grant browser Local Network Access, and include ${browserOrigin} in LOCAL_LIBRARY_HOSTED_ORIGINS.`,
      "LOCAL_LIBRARY_UNREACHABLE",
      0,
    );
  }
}

type ImportResult = {
  duplicate: boolean;
  records: CatalogRecord[];
};

export type YouTubeMatchSummary = {
  total: number;
  processed: number;
  matched: number;
  review: number;
  missing: number;
  failed: number;
};

export type YouTubeMatchResult = {
  record: CatalogRecord;
  summary: YouTubeMatchSummary;
  failures: Array<{ trackId: string; message: string }>;
};

export type LocalSpotifyStatus = {
  configured: boolean;
  connected: boolean;
  redirectUri: string;
};

type LocalExecutableStatus = {
  ready: boolean | null;
  version: string | null;
  error: string | null;
};

export type LocalDownloaderStatus = {
  ready: boolean;
  ytDlp: LocalExecutableStatus;
  ffmpeg: LocalExecutableStatus;
  jsRuntime: LocalExecutableStatus & { name: string | null };
  ejs: LocalExecutableStatus;
  issues: string[];
};

async function readResponse<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  let body: { error?: string; code?: string } = {};
  try {
    body = await response.json();
  } catch {
    // Keep the status-based error when the helper did not return JSON.
  }
  throw new LocalLibraryApiError(
    body.error ?? `Local-library request failed with status ${response.status}.`,
    body.code ?? "LOCAL_LIBRARY_REQUEST_FAILED",
    response.status,
  );
}

function isCatalogRecord(value: unknown): value is CatalogRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CatalogRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.shortTitle === "string" &&
    typeof record.artist === "string" &&
    typeof record.year === "number" &&
    typeof record.description === "string" &&
    Array.isArray(record.genres) &&
    typeof record.sleeveColor === "string" &&
    typeof record.accent === "string" &&
    typeof record.ink === "string" &&
    typeof record.vinylColor === "string" &&
    (record.rpm === 33.333 || record.rpm === 45) &&
    (record.discCount === 1 || record.discCount === 2) &&
    Array.isArray(record.tracks)
  );
}

function validateRecords(value: unknown): CatalogRecord[] {
  if (!Array.isArray(value)) {
    throw new LocalLibraryApiError(
      "The local library returned an invalid catalog.",
      "INVALID_LOCAL_CATALOG",
      502,
    );
  }
  const records = value.filter(isCatalogRecord);
  if (records.length !== value.length) {
    throw new LocalLibraryApiError(
      "The local library contains an invalid record manifest.",
      "INVALID_LOCAL_RECORD",
      502,
    );
  }
  return records;
}

export async function fetchLocalCatalog(): Promise<CatalogRecord[]> {
  const response = await fetchLocalLibrary(`${localLibraryOrigin}/v1/catalog`, {
    cache: "no-store",
  });
  const result = await readResponse<{ records: unknown }>(response);
  return validateRecords(result.records);
}

export async function syncCatalogRecords(
  records: CatalogRecord[],
): Promise<CatalogRecord[]> {
  const response = await fetchLocalLibrary(
    `${localLibraryOrigin}/v1/catalog-records/sync`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records }),
    },
  );
  const result = await readResponse<{ records: unknown }>(response);
  return validateRecords(result.records);
}

export async function saveLocalCatalogOrder(
  recordIds: string[],
): Promise<CatalogRecord[]> {
  const response = await fetchLocalLibrary(
    `${localLibraryOrigin}/v1/catalog/order`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordIds }),
    },
  );
  const result = await readResponse<{ records: unknown }>(response);
  return validateRecords(result.records);
}

export async function matchLocalRecord(
  recordId: string,
  options: { trackIds?: string[]; rematch?: boolean } = {},
): Promise<YouTubeMatchResult> {
  const response = await fetchLocalLibrary(
    `${localLibraryOrigin}/v1/records/${encodeURIComponent(
      recordId,
    )}/youtube-match`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    },
  );
  const result = await readResponse<{
    record: unknown;
    summary: YouTubeMatchSummary;
    failures: Array<{ trackId: string; message: string }>;
  }>(response);
  const [record] = validateRecords([result.record]);
  return { record, summary: result.summary, failures: result.failures };
}

export async function fetchLocalSpotifyStatus(): Promise<LocalSpotifyStatus> {
  const response = await fetchLocalLibrary(
    `${localLibraryOrigin}/v1/spotify/status`,
    {
      cache: "no-store",
    },
  );
  return readResponse<LocalSpotifyStatus>(response);
}

export async function fetchLocalDownloaderStatus(): Promise<LocalDownloaderStatus> {
  const response = await fetchLocalLibrary(
    `${localLibraryOrigin}/v1/downloader/status`,
    {
      cache: "no-store",
    },
  );
  return readResponse<LocalDownloaderStatus>(response);
}

export async function importSpotifyMetadata(
  spotifyUrl: string,
): Promise<ImportResult> {
  const response = await fetchLocalLibrary(`${localLibraryOrigin}/v1/imports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spotifyUrl }),
  });
  const result = await readResponse<{
    duplicate: boolean;
    records: unknown;
  }>(response);
  return {
    duplicate: result.duplicate,
    records: validateRecords(result.records),
  };
}

export async function uploadLocalTrack(
  recordId: string,
  trackId: string,
  file: File,
): Promise<void> {
  const response = await fetchLocalLibrary(
    `${localLibraryOrigin}/v1/records/${encodeURIComponent(
      recordId,
    )}/tracks/${encodeURIComponent(trackId)}/audio`,
    {
      method: "PUT",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": file.name,
      },
      body: file,
    },
  );
  await readResponse(response);
}

export async function downloadLocalTrackFromYouTube(
  recordId: string,
  trackId: string,
  youtubeUrl: string | null,
  confirmedOwnership: boolean,
): Promise<CatalogRecord> {
  const response = await fetchLocalLibrary(
    `${localLibraryOrigin}/v1/records/${encodeURIComponent(
      recordId,
    )}/tracks/${encodeURIComponent(trackId)}/youtube-download`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ youtubeUrl, confirmedOwnership }),
    },
  );
  const result = await readResponse<{ record: unknown }>(response);
  const [record] = validateRecords([result.record]);
  return record;
}

export async function removeLocalRecord(recordId: string): Promise<void> {
  const response = await fetchLocalLibrary(
    `${localLibraryOrigin}/v1/records/${encodeURIComponent(recordId)}`,
    { method: "DELETE" },
  );
  if (response.status === 204) return;
  await readResponse(response);
}
