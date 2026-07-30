"use client";

import { useEffect, useMemo, useState } from "react";
import type { CatalogRecord, RecordTrack } from "./record-catalog";
import {
  downloadLocalTrackFromYouTube,
  fetchLocalDownloaderStatus,
  matchLocalRecord,
} from "./local-library";
import type { LocalDownloaderStatus } from "./local-library";
import { usePresence } from "./use-presence";

type LocalAudioManagerProps = {
  open: boolean;
  records: CatalogRecord[];
  onClose: () => void;
  onLibraryChanged: () => Promise<void>;
};

type ProgressState = {
  completed: number;
  total: number;
  label: string;
};

function replaceRecord(
  records: CatalogRecord[],
  nextRecord: CatalogRecord,
): CatalogRecord[] {
  return records.map((record) =>
    record.id === nextRecord.id
      ? {
          ...record,
          tracks: record.tracks.map((track) => {
            const nextTrack = nextRecord.tracks.find(
              (candidate) => candidate.id === track.id,
            );
            return nextTrack
              ? {
                  ...track,
                  artists: nextTrack.artists ?? track.artists,
                  previewUrl: nextTrack.previewUrl,
                  localAudio: nextTrack.localAudio,
                  youtubeMatch: nextTrack.youtubeMatch,
                }
              : track;
          }),
          localSource: nextRecord.localSource ?? record.localSource,
        }
      : record,
  );
}

function trackStatus(track: RecordTrack) {
  if (track.previewUrl) return "Ready";
  if (track.youtubeMatch?.verified) return "Matched";
  if (track.youtubeMatch) return "Review";
  return "Missing";
}

export function LocalAudioManager({
  open,
  records,
  onClose,
  onLibraryChanged,
}: LocalAudioManagerProps) {
  const [snapshot, setSnapshot] = useState(records);
  const [working, setWorking] = useState<"matching" | "downloading" | null>(
    null,
  );
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [confirmedOwnership, setConfirmedOwnership] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloaderStatus, setDownloaderStatus] =
    useState<LocalDownloaderStatus | null>(null);
  const presence = usePresence(open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !working) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, working]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setDownloaderStatus(null);
    });
    void fetchLocalDownloaderStatus()
      .then((status) => {
        if (active) setDownloaderStatus(status);
      })
      .catch((caught) => {
        if (!active) return;
        const message =
          caught instanceof Error
            ? caught.message
            : "Downloader preflight failed.";
        setDownloaderStatus({
          ready: false,
          ytDlp: { ready: false, version: null, error: message },
          ffmpeg: { ready: null, version: null, error: null },
          jsRuntime: {
            ready: null,
            version: null,
            error: null,
            name: null,
          },
          ejs: { ready: null, version: null, error: null },
          issues: [message],
        });
      });
    return () => {
      active = false;
    };
  }, [open]);

  const totals = useMemo(() => {
    const tracks = snapshot.flatMap((record) => record.tracks);
    return {
      tracks: tracks.length,
      ready: tracks.filter((track) => track.previewUrl).length,
      matched: tracks.filter(
        (track) => !track.previewUrl && track.youtubeMatch?.verified,
      ).length,
      review: tracks.filter(
        (track) => !track.previewUrl && track.youtubeMatch && !track.youtubeMatch.verified,
      ).length,
      missing: tracks.filter(
        (track) => !track.previewUrl && !track.youtubeMatch,
      ).length,
    };
  }, [snapshot]);

  if (!presence.mounted) return null;

  const updateSnapshot = (record: CatalogRecord) => {
    setSnapshot((current) => replaceRecord(current, record));
  };

  const matchCatalog = async () => {
    if (working) return;
    setWorking("matching");
    setError(null);
    let completed = 0;
    const total = snapshot.reduce(
      (sum, record) =>
        sum + record.tracks.filter((track) => !track.youtubeMatch).length,
      0,
    );
    setProgress({
      completed,
      total,
      label: total ? "Preparing automatic matches" : "Catalog already matched",
    });
    try {
      for (const record of snapshot) {
        const pending = record.tracks.filter(
          (track) => !track.youtubeMatch,
        ).length;
        if (!pending) continue;
        setProgress({
          completed,
          total,
          label: `Matching ${record.title}`,
        });
        const result = await matchLocalRecord(record.id);
        updateSnapshot(result.record);
        completed += pending;
        setProgress({
          completed,
          total,
          label: `${record.title} matched`,
        });
      }
      await onLibraryChanged();
      setProgress({
        completed: total,
        total,
        label: "Catalog matching complete",
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Catalog matching failed.",
      );
    } finally {
      setWorking(null);
    }
  };

  const downloadMatched = async () => {
    if (working || !confirmedOwnership) return;
    const queue = snapshot.flatMap((record) =>
      record.tracks
        .filter(
          (track) =>
            !track.previewUrl && track.youtubeMatch?.verified === true,
        )
        .map((track) => ({ record, track })),
    );
    setWorking("downloading");
    setError(null);
    setProgress({
      completed: 0,
      total: queue.length,
      label: queue.length
        ? "Preparing authorized downloads"
        : "No verified matches are waiting",
    });
    let completed = 0;
    try {
      for (const { record, track } of queue) {
        setProgress({
          completed,
          total: queue.length,
          label: `Saving ${track.title} · ${record.artist}`,
        });
        const updated = await downloadLocalTrackFromYouTube(
          record.id,
          track.id,
          null,
          true,
        );
        updateSnapshot(updated);
        completed += 1;
        setProgress({
          completed,
          total: queue.length,
          label: `${track.title} ready`,
        });
      }
      setProgress({
        completed,
        total: queue.length,
        label: "Authorized downloads complete",
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The download batch failed.",
      );
    } finally {
      if (completed > 0) await onLibraryChanged();
      setWorking(null);
    }
  };

  const progressPercent =
    progress && progress.total
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;
  const downloaderReady = downloaderStatus?.ready === true;

  return (
    <div
      className={`local-import local-audio-manager motion-overlay is-${presence.state}`}
      data-motion-state={presence.state}
      aria-hidden={!open}
      inert={open ? undefined : true}
    >
      <button
        type="button"
        className="local-import__backdrop motion-backdrop"
        aria-label="Close local audio manager"
        disabled={Boolean(working)}
        onClick={onClose}
      />
      <section
        className="local-import__dialog local-audio-manager__dialog motion-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-audio-title"
      >
        <div className="local-import__heading">
          <div>
            <p className="eyebrow">Automatic matching</p>
            <h2 id="local-audio-title">Prepare the catalog</h2>
          </div>
          <button
            type="button"
            className="local-import__close"
            aria-label="Close local audio manager"
            disabled={Boolean(working)}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <p className="local-import__intro">
          Match every displayed track, including Spotify imports, to a likely
          official YouTube source. Review uncertain results, then save
          authorized audio to this computer.
        </p>

        <div className="local-audio-manager__summary" aria-live="polite">
          <span>{totals.tracks} tracks</span>
          <span>{totals.ready} ready</span>
          <span>{totals.matched} matched</span>
          <span>{totals.review} review</span>
          <span>{totals.missing} missing</span>
        </div>

        <p
          className={`local-audio-manager__runtime ${
            downloaderReady ? "is-ready" : "is-checking"
          }`}
          role="status"
        >
          {!downloaderStatus
            ? "Checking yt-dlp, FFmpeg, JavaScript runtime, and EJS…"
            : downloaderReady
              ? `Downloader ready · yt-dlp ${
                  downloaderStatus.ytDlp.version ?? "available"
                } · ${
                  downloaderStatus.jsRuntime.name ?? "JavaScript runtime"
                } ${downloaderStatus.jsRuntime.version ?? "available"} · EJS ${
                  downloaderStatus.ejs.ready === true
                    ? "ready"
                    : "managed by yt-dlp"
                }`
              : downloaderStatus.issues.join(" ")}
        </p>

        <div className="local-audio-manager__records">
          {snapshot.map((record) => {
            const ready = record.tracks.filter(
              (track) => track.previewUrl,
            ).length;
            const matched = record.tracks.filter(
              (track) => !track.previewUrl && track.youtubeMatch?.verified,
            ).length;
            return (
              <details key={record.id}>
                <summary>
                  <span>
                    <strong>{record.title}</strong>
                    <small>{record.artist}</small>
                  </span>
                  <span>
                    {ready} ready · {matched} matched
                  </span>
                </summary>
                <ol>
                  {record.tracks.map((track) => (
                    <li key={track.id}>
                      <span>{String(track.trackNumber).padStart(2, "0")}</span>
                      <span>{track.title}</span>
                      {track.youtubeMatch ? (
                        <a
                          href={track.youtubeMatch.url}
                          target="_blank"
                          rel="noreferrer"
                          title={track.youtubeMatch.title}
                        >
                          {trackStatus(track)}
                          {track.youtubeMatch.confidence
                            ? ` · ${Math.round(
                                track.youtubeMatch.confidence * 100,
                              )}%`
                            : ""}
                        </a>
                      ) : (
                        <em>{trackStatus(track)}</em>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            );
          })}
        </div>

        <label className="youtube-download__authorization">
          <input
            type="checkbox"
            checked={confirmedOwnership}
            disabled={Boolean(working)}
            onChange={(event) =>
              setConfirmedOwnership(event.currentTarget.checked)
            }
          />
          <span>
            I own this media or have permission to download and keep it.
          </span>
        </label>

        {progress ? (
          <div className="local-audio-manager__progress" role="status">
            <span>
              <i style={{ width: `${progressPercent}%` }} />
            </span>
            <p>
              {progress.label}
              {progress.total
                ? ` · ${progress.completed}/${progress.total}`
                : ""}
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="local-import__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="local-import__actions local-audio-manager__actions">
          <button
            type="button"
            disabled={Boolean(working) || !downloaderReady}
            onClick={() => void matchCatalog()}
          >
            {working === "matching" ? "Matching…" : "Match catalog"}
          </button>
          <button
            type="button"
            className="local-import__submit"
            disabled={
              Boolean(working) ||
              !downloaderReady ||
              !confirmedOwnership ||
              totals.matched === 0
            }
            onClick={() => void downloadMatched()}
          >
            {working === "downloading"
              ? "Downloading…"
              : `Download matched (${totals.matched})`}
          </button>
        </div>

        <p className="local-import__footnote">
          Matches and audio stay local · no automatic low-confidence downloads
        </p>
      </section>
    </div>
  );
}
