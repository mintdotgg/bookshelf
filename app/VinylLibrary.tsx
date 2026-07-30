"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  RecordShelfEngine,
  type SceneMode,
  type VinylLibraryDiagnostics,
} from "./RecordShelfEngine";
import {
  recordCatalog,
  type CatalogRecord,
  type RecordTrack,
  type VinylDiscNumber,
} from "./record-catalog";
import { LocalLibraryImport } from "./LocalLibraryImport";
import { LocalAudioManager } from "./LocalAudioManager";
import {
  YouTubeDownloadDialog,
  type YouTubeDownloadTarget,
} from "./YouTubeDownloadDialog";
import {
  fetchLocalCatalog,
  removeLocalRecord,
  syncCatalogRecords,
} from "./local-library";
import { siteConfig } from "./site-config";
import {
  VinylAudioController,
} from "./audio/VinylAudioController";
import {
  initialPlaybackState,
  reducePlaybackState,
  type PlaybackAction,
  type PlaybackState,
} from "./audio/playback-state";
import {
  defaultTurntableVariantId,
  getTurntableVariant,
  isTurntableVariantId,
  legacyTurntablePreferenceKey,
  turntablePreferenceKey,
  turntableVariants,
  type TurntableVariantId,
} from "./turntable-variants";

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <span aria-hidden="true" className={`arrow-icon arrow-icon--${direction}`}>
      <span />
    </span>
  );
}

function PlayIcon({ paused }: { paused: boolean }) {
  return (
    <span aria-hidden="true">
      {paused ? "▶" : "Ⅱ"}
    </span>
  );
}

function formatTime(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function trackDuration(track: RecordTrack) {
  return track.duration ? formatTime(track.duration) : "—";
}

function trackPosition(track: RecordTrack) {
  if (!track.side) return String(track.trackNumber).padStart(2, "0");
  return `${track.side}${track.sideTrackNumber ?? track.trackNumber}`;
}

function savedTurntableVariantId(): TurntableVariantId {
  if (typeof window === "undefined") return defaultTurntableVariantId;
  const stored =
    window.localStorage.getItem(turntablePreferenceKey) ??
    window.localStorage.getItem(legacyTurntablePreferenceKey);
  if (!isTurntableVariantId(stored)) return defaultTurntableVariantId;
  return getTurntableVariant(stored).available
    ? stored
    : defaultTurntableVariantId;
}

type PendingTrack = {
  track: RecordTrack;
  autoplay: boolean;
} | null;

type LibraryCommands = {
  browse: (index: number) => void;
  focus: (index: number) => void;
  play: (trackId?: string) => void;
  pause: () => void;
  stop: () => void;
  resetView: () => void;
  returnToShelf: () => void;
};

function mergeLocalRecords(localRecords: CatalogRecord[]): CatalogRecord[] {
  const localById = new Map(
    localRecords.map((record) => [record.id, record]),
  );
  const seedIds = new Set(recordCatalog.map((record) => record.id));
  const seeds = recordCatalog.map((record) => {
    const overlay = localById.get(record.id);
    if (!overlay) return record;
    const overlayTracks = new Map(
      overlay.tracks.map((track) => [track.id, track]),
    );
    return {
      ...record,
      localSource: overlay.localSource,
      tracks: record.tracks.map((track) => {
        const localTrack = overlayTracks.get(track.id);
        return localTrack
          ? {
              ...track,
              artists: localTrack.artists ?? track.artists,
              previewUrl: localTrack.previewUrl,
              localAudio: localTrack.localAudio,
              youtubeMatch: localTrack.youtubeMatch,
            }
          : track;
      }),
    };
  });
  return [
    ...seeds,
    ...localRecords.filter((record) => !seedIds.has(record.id)),
  ];
}

export function VinylLibrary() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vinylPlayRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const engineRef = useRef<RecordShelfEngine | null>(null);
  const audioRef = useRef<VinylAudioController | null>(null);
  const playbackRef = useRef<PlaybackState>(initialPlaybackState());
  const pendingTrackRef = useRef<PendingTrack>(null);
  const pendingFocusRef = useRef<number | null>(null);
  const turntableVariantRef = useRef<TurntableVariantId>(
    defaultTurntableVariantId,
  );
  const commandsRef = useRef<LibraryCommands>({
    browse() {},
    focus() {},
    play() {},
    pause() {},
    stop() {},
    resetView() {},
    returnToShelf() {},
  });
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [sceneMode, setSceneMode] = useState<SceneMode>("browse");
  const [playback, setPlayback] = useState<PlaybackState>(() =>
    initialPlaybackState(),
  );
  const [records, setRecords] = useState<CatalogRecord[]>(recordCatalog);
  const [catalogReady, setCatalogReady] = useState(false);
  const [localServiceAvailable, setLocalServiceAvailable] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [localAudioOpen, setLocalAudioOpen] = useState(false);
  const [youtubeDownloadTarget, setYoutubeDownloadTarget] =
    useState<YouTubeDownloadTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [turntableVariantId, setTurntableVariantId] =
    useState<TurntableVariantId>(savedTurntableVariantId);
  const [turntableVariantStatus, setTurntableVariantStatus] =
    useState("Player ready");
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Preparing the collection");
  const closeLocalImport = useCallback(() => setImportOpen(false), []);
  const closeLocalAudio = useCallback(() => setLocalAudioOpen(false), []);
  const closeYouTubeDownload = useCallback(
    () => setYoutubeDownloadTarget(null),
    [],
  );
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    window.setTimeout(() => settingsTriggerRef.current?.focus(), 0);
  }, []);

  const refreshLocalLibrary = useCallback(async () => {
    try {
      await syncCatalogRecords(recordCatalog);
      const localRecords = await fetchLocalCatalog();
      setRecords(mergeLocalRecords(localRecords));
      setLocalServiceAvailable(true);
    } catch {
      setRecords(recordCatalog);
      setLocalServiceAvailable(false);
    } finally {
      setCatalogReady(true);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshLocalLibrary();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refreshLocalLibrary]);

  useEffect(() => {
    turntableVariantRef.current = turntableVariantId;
  }, [turntableVariantId]);

  useEffect(() => {
    if (!settingsOpen) return;
    const focusTimer = window.setTimeout(
      () => settingsCloseRef.current?.focus(),
      0,
    );
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeSettings();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeSettings, settingsOpen]);

  const chooseTurntableVariant = useCallback(
    async (id: TurntableVariantId) => {
      const variant = getTurntableVariant(id);
      if (!variant.available) return;
      setTurntableVariantStatus(`Loading ${variant.label}`);
      try {
        const engine = engineRef.current;
        if (engine) await engine.setTurntableVariant(id);
        turntableVariantRef.current = id;
        setTurntableVariantId(id);
        window.localStorage.setItem(turntablePreferenceKey, id);
        window.localStorage.removeItem(legacyTurntablePreferenceKey);
        setTurntableVariantStatus(`${variant.label} selected`);
      } catch (error) {
        setTurntableVariantStatus(
          error instanceof Error ? error.message : "Unable to change player",
        );
      }
    },
    [],
  );

  const physicalDiscCount = useMemo(
    () =>
      records.reduce((total, record) => total + record.discCount, 0),
    [records],
  );
  const activeRecord = records[activeIndex] ?? records[0];
  const selectedRecord = useMemo(
    () => (selectedIndex === null ? null : records[selectedIndex] ?? null),
    [records, selectedIndex],
  );
  const selectedTrack = useMemo(
    () =>
      selectedRecord?.tracks.find((track) => track.id === selectedTrackId) ??
      selectedRecord?.tracks[0] ??
      null,
    [selectedRecord, selectedTrackId],
  );
  const selectedTrackGroups = useMemo(() => {
    if (!selectedRecord) return [];
    return Array.from({ length: selectedRecord.discCount }, (_, index) => {
      const discNumber = (index + 1) as VinylDiscNumber;
      const tracks = selectedRecord.tracks.filter(
        (track) => (track.discNumber ?? 1) === discNumber,
      );
      return {
        discNumber,
        sides: [...new Set(tracks.map((track) => track.side).filter(Boolean))],
        tracks,
      };
    });
  }, [selectedRecord]);
  const isFocused = sceneMode !== "browse";
  const isSceneTransition =
    sceneMode === "focusing" || sceneMode === "returning";
  const isBusy =
    isSceneTransition ||
    playback.mode === "loading" ||
    playback.mode === "cueing" ||
    playback.mode === "stopping";
  const isPlaying = playback.mode === "playing";
  const timelineDuration = selectedTrack?.previewUrl
    ? playback.duration || selectedTrack.duration || 0
    : selectedTrack?.duration ?? 0;

  const dispatchPlayback = useCallback((action: PlaybackAction) => {
    const next = reducePlaybackState(playbackRef.current, action);
    playbackRef.current = next;
    setPlayback(next);
    engineRef.current?.setPlaybackMode(next.mode);
    return next;
  }, []);

  const loadTrack = useCallback(
    async (track: RecordTrack, autoplay: boolean) => {
      const audio = audioRef.current;
      if (!audio) return;
      setSelectedTrackId(track.id);
      engineRef.current?.selectTrack(track);
      if (!track.previewUrl) {
        void audio.stop(80).catch(() => undefined);
        dispatchPlayback({
          type: "SELECT_CATALOG_TRACK",
          trackId: track.id,
          duration: track.duration,
        });
        setStatus("Track selected · use the official listening links");
        return;
      }

      const loading = dispatchPlayback({
        type: "LOAD",
        trackId: track.id,
        src: track.previewUrl,
        autoplay,
      });
      setStatus(`Loading ${track.title}`);
      try {
        await audio.load(track.previewUrl, {
          requestId: loading.requestId,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    },
    [dispatchPlayback],
  );

  const stopPlayback = useCallback(
    (returnToShelf = false) => {
      const state = playbackRef.current;
      if (
        state.mode !== "idle" ||
        engineRef.current?.getDiagnostics().cuePhase !== null
      ) {
        dispatchPlayback({ type: "STOP" });
        setStatus("Lifting the needle");
        void audioRef.current?.stop().catch(() => undefined);
        engineRef.current?.stopAndReturnVinyl(returnToShelf);
        return;
      }
      if (returnToShelf) engineRef.current?.requestReturnToShelf();
    },
    [dispatchPlayback],
  );

  const queueTrack = useCallback(
    (track: RecordTrack, autoplay: boolean) => {
      const cuePhase = engineRef.current?.getDiagnostics().cuePhase;
      if (cuePhase !== null && cuePhase !== undefined) {
        pendingTrackRef.current = { track, autoplay };
        stopPlayback(false);
        return;
      }
      void loadTrack(track, autoplay);
    },
    [loadTrack, stopPlayback],
  );

  const playTrack = useCallback(
    (track: RecordTrack | null = selectedTrack) => {
      const audio = audioRef.current;
      const engine = engineRef.current;
      if (!track || !audio || !engine || sceneMode !== "inspect") return;
      if (!track.previewUrl) {
        engine.selectTrack(track);
        setStatus("Licensed recording not bundled · open an official stream");
        return;
      }
      void audio.unlock().catch(() => undefined);

      const state = playbackRef.current;
      if (state.trackId !== track.id || state.src !== track.previewUrl) {
        queueTrack(track, true);
        void audio.primeForDelayedPlayback().catch(() => undefined);
        return;
      }
      if (state.mode === "loading") {
        dispatchPlayback({ type: "PLAY" });
        return;
      }
      if (state.mode === "playing" || state.mode === "cueing") return;
      if (state.mode === "error") {
        dispatchPlayback({ type: "CLEAR_ERROR" });
        queueTrack(track, true);
        return;
      }

      const cuePhase = engine.getDiagnostics().cuePhase;
      dispatchPlayback({ type: "PLAY" });
      if (cuePhase === "playing") {
        const cueComplete = dispatchPlayback({
          type: "CUE_COMPLETE",
          requestId: playbackRef.current.requestId,
        });
        engine.setPlaybackMode(cueComplete.mode);
        void audio.play().catch(() => undefined);
        return;
      }
      engine.startCue(
        state.duration > 0 ? state.currentTime / state.duration : 0,
      );
    },
    [
      dispatchPlayback,
      queueTrack,
      sceneMode,
      selectedTrack,
    ],
  );

  const pausePlayback = useCallback(() => {
    const state = playbackRef.current;
    if (state.mode !== "playing" && state.mode !== "cueing") return;
    dispatchPlayback({ type: "PAUSE" });
    audioRef.current?.pause();
    setStatus("Playback paused");
  }, [dispatchPlayback]);

  const seekPlayback = useCallback(
    (time: number) => {
      const state = playbackRef.current;
      if (state.duration <= 0 || state.mode === "loading") return;
      const next = dispatchPlayback({ type: "SEEK", time });
      if (next.mode !== "seeking" || next.duration <= 0) return;
      engineRef.current?.setPlaybackProgress(time / next.duration);
      void audioRef.current
        ?.seek(time)
        .then(() => {
          if (next.resumeAfterSeek === "playing") {
            void audioRef.current?.play().catch(() => undefined);
          }
        })
        .catch((error) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setStatus("Unable to seek this preview");
          }
        });
    },
    [dispatchPlayback],
  );

  const returnToShelf = useCallback(() => {
    pendingTrackRef.current = null;
    stopPlayback(true);
  }, [stopPlayback]);

  useEffect(() => {
    if (!catalogReady) return;
    let cancelled = false;
    let engine: RecordShelfEngine | null = null;
    let audio: VinylAudioController | null = null;
    const vinylPlayControl = vinylPlayRef.current;

    async function start() {
      if (!canvasRef.current) return;
      setReady(false);
      setActiveIndex(0);
      setSelectedIndex(null);
      setSelectedTrackId(null);
      setSceneMode("browse");
      const resetPlayback = initialPlaybackState(playbackRef.current.volume);
      playbackRef.current = resetPlayback;
      setPlayback(resetPlayback);
      await document.fonts.ready;
      if (cancelled || !canvasRef.current) return;

      audio = new VinylAudioController({
        initialVolume: playbackRef.current.volume,
        callbacks: {
          onReady: (snapshot) => {
            const next = dispatchPlayback({
              type: "MEDIA_READY",
              requestId: snapshot.requestId,
              duration: snapshot.duration,
            });
            if (next.mode === "cueing") {
              const started = engineRef.current?.startCue(
                snapshot.duration > 0
                  ? snapshot.currentTime / snapshot.duration
                  : 0,
              );
              if (!started) setStatus("Finish opening the sleeve before playing");
            } else {
              setStatus("Preview ready");
            }
          },
          onPlay: (snapshot) => {
            const current = playbackRef.current;
            if (
              snapshot.requestId !== current.requestId ||
              current.mode === "paused" ||
              current.mode === "idle" ||
              current.mode === "stopping" ||
              current.mode === "error" ||
              (current.mode === "seeking" &&
                current.resumeAfterSeek === "paused")
            ) {
              audioRef.current?.pause();
              return;
            }
            dispatchPlayback({
              type: "MEDIA_PLAYING",
              requestId: snapshot.requestId,
            });
            setStatus("Needle down");
          },
          onTimeUpdate: (snapshot) => {
            dispatchPlayback({
              type: "MEDIA_TIME",
              requestId: snapshot.requestId,
              currentTime: snapshot.currentTime,
              duration: snapshot.duration,
            });
            if (snapshot.duration > 0) {
              engineRef.current?.setPlaybackProgress(
                snapshot.currentTime / snapshot.duration,
              );
            }
          },
          onSeeked: (snapshot) => {
            dispatchPlayback({
              type: "MEDIA_SEEKED",
              requestId: snapshot.requestId,
              currentTime: snapshot.currentTime,
            });
          },
          onEnded: (snapshot) => {
            dispatchPlayback({
              type: "MEDIA_ENDED",
              requestId: snapshot.requestId,
            });
            setStatus("End of preview");
            void audioRef.current?.stop(80).catch(() => undefined);
            engineRef.current?.stopAndReturnVinyl();
          },
          onStopped: (snapshot) => {
            if (snapshot.requestId !== playbackRef.current.requestId) return;
          },
          onError: (error) => {
            dispatchPlayback({
              type: "MEDIA_ERROR",
              requestId: error.requestId,
              message: error.message,
            });
            setStatus(error.message);
            engineRef.current?.stopAndReturnVinyl();
          },
        },
      });
      audioRef.current = audio;

      engine = new RecordShelfEngine(canvasRef.current, records, {
        onActiveIndex: setActiveIndex,
        onMode: (nextMode, index) => {
          setSceneMode(nextMode);
          setSelectedIndex(index);
          if (index !== null) {
            setSelectedTrackId((current) =>
              records[index].tracks.some((track) => track.id === current)
                ? current
                : records[index].tracks[0]?.id ?? null,
            );
          }
          if (nextMode === "browse" && pendingFocusRef.current !== null) {
            const target = pendingFocusRef.current;
            pendingFocusRef.current = null;
            queueMicrotask(() => engineRef.current?.focusRecord(target));
          }
        },
        onStatus: setStatus,
        onReady: () => {
          setReady(true);
          setStatus(
            `${physicalDiscCount} discs across ${records.length} releases ready`,
          );
        },
        onNeedleContact: () => {
          const current = playbackRef.current;
          if (current.mode !== "cueing" || !current.playWhenReady) {
            engineRef.current?.setPlaybackMode("paused");
            return;
          }
          dispatchPlayback({
            type: "CUE_COMPLETE",
            requestId: current.requestId,
          });
          void audioRef.current?.play().catch(() => undefined);
        },
        onVinylReturned: () => {
          dispatchPlayback({
            type: "MEDIA_STOPPED",
            requestId: playbackRef.current.requestId,
          });
          const pending = pendingTrackRef.current;
          pendingTrackRef.current = null;
          if (pending) {
            void loadTrack(pending.track, pending.autoplay);
          } else if (engineRef.current?.getDiagnostics().sceneMode === "inspect") {
            setStatus("Pressing returned to its sleeve");
          }
        },
        onVinylAnchor: (anchor) => {
          const control = vinylPlayRef.current;
          if (!control) return;
          if (!anchor) {
            control.dataset.anchored = "false";
            return;
          }
          control.style.setProperty("--vinyl-play-x", `${anchor.x}px`);
          control.style.setProperty("--vinyl-play-y", `${anchor.y}px`);
          control.dataset.anchored = String(anchor.visible);
        },
      });
      engineRef.current = engine;
      void engine
        .setTurntableVariant(turntableVariantRef.current)
        .then(() => {
          if (cancelled) return;
          setTurntableVariantStatus(
            `${getTurntableVariant(turntableVariantRef.current).label} selected`,
          );
        })
        .catch((error) => {
          if (cancelled) return;
          setTurntableVariantStatus(
            error instanceof Error
              ? error.message
              : "Unable to load the selected player",
          );
        });
      engine.setAnalyserReader((target) => {
        const data = audioRef.current?.sampleFrequencyData();
        if (!data) {
          target.fill(0);
          return false;
        }
        target.set(data.subarray(0, target.length));
        return playbackRef.current.mode === "playing";
      }, audio.analyserSampleRate, audio.frequencyBinCount);

      (
        window as unknown as {
          __VINYL_LIBRARY__?: {
            diagnostics: () => VinylLibraryDiagnostics | null;
            browse: (index: number) => void;
            focus: (index: number) => void;
            play: (trackId?: string) => void;
            pause: () => void;
            stop: () => void;
            resetView: () => void;
            returnToShelf: () => void;
          };
        }
      ).__VINYL_LIBRARY__ = {
        diagnostics: () => engineRef.current?.getDiagnostics() ?? null,
        browse: (index) => commandsRef.current.browse(index),
        focus: (index) => commandsRef.current.focus(index),
        play: (trackId) => commandsRef.current.play(trackId),
        pause: () => commandsRef.current.pause(),
        stop: () => commandsRef.current.stop(),
        resetView: () => commandsRef.current.resetView(),
        returnToShelf: () => commandsRef.current.returnToShelf(),
      };
    }

    void start();
    return () => {
      cancelled = true;
      engine?.dispose();
      void audio?.dispose();
      engineRef.current = null;
      audioRef.current = null;
      delete (
        window as unknown as {
          __VINYL_LIBRARY__?: unknown;
        }
      ).__VINYL_LIBRARY__;
      if (vinylPlayControl) {
        vinylPlayControl.dataset.anchored = "false";
      }
    };
  }, [
    catalogReady,
    dispatchPlayback,
    loadTrack,
    physicalDiscCount,
    records,
  ]);

  useEffect(() => {
    commandsRef.current = {
      browse: (index) => engineRef.current?.browseTo(index),
      focus: (index) => {
        const currentMode =
          engineRef.current?.getDiagnostics().sceneMode ?? "browse";
        if (currentMode !== "browse") {
          pendingFocusRef.current = index;
          returnToShelf();
          return;
        }
        engineRef.current?.focusRecord(index);
      },
      play: (trackId) => {
        const record =
          selectedIndex === null ? null : records[selectedIndex];
        const track =
          record?.tracks.find((candidate) => candidate.id === trackId) ??
          selectedTrack;
        playTrack(track);
      },
      pause: pausePlayback,
      stop: () => stopPlayback(false),
      resetView: () => engineRef.current?.resetFocusView(),
      returnToShelf,
    };
  }, [
    pausePlayback,
    playTrack,
    returnToShelf,
    selectedIndex,
    selectedTrack,
    stopPlayback,
    records,
  ]);

  const removeSelectedLocalRecord = useCallback(async () => {
    if (!selectedRecord?.localSource) return;
    const approved = window.confirm(
      `Remove ${selectedRecord.title} and its attached local audio files from this computer?`,
    );
    if (!approved) return;
    setStatus(`Removing ${selectedRecord.shortTitle}`);
    pendingTrackRef.current = null;
    await audioRef.current?.stop(80).catch(() => undefined);
    await removeLocalRecord(selectedRecord.id);
    await refreshLocalLibrary();
    setStatus(`${selectedRecord.shortTitle} removed from the local collection`);
  }, [refreshLocalLibrary, selectedRecord]);

  const themeStyle = {
    "--paper": siteConfig.theme.paper,
    "--paper-deep": siteConfig.theme.paperDeep,
    "--ink": siteConfig.theme.ink,
    "--ink-soft": siteConfig.theme.inkSoft,
    "--accent": siteConfig.theme.accent,
    "--night": siteConfig.theme.night,
    "--brass": siteConfig.theme.brass,
  } as CSSProperties;

  return (
    <main
      className={`vinyl-experience ${ready ? "is-ready" : ""} ${
        isFocused ? "is-focused" : "is-browsing"
      } ${isPlaying ? "is-playing" : ""}`}
      style={themeStyle}
    >
      <canvas
        ref={canvasRef}
        className="archive-canvas"
        data-testid="archive-canvas"
        role="application"
        tabIndex={0}
        aria-label={`Interactive three-dimensional collection of ${records.length} releases and ${physicalDiscCount} vinyl discs. Drag, scroll, or use the arrow keys to browse. Press Enter to inspect the selected sleeve.`}
      />

      <button
        ref={vinylPlayRef}
        type="button"
        className={`vinyl-play-button ${
          selectedTrack?.previewUrl ? "has-preview" : ""
        } ${isBusy ? "is-busy" : ""} ${isPlaying ? "is-playing" : ""}`}
        data-anchored="false"
        data-testid="vinyl-play"
        aria-label={
          selectedTrack?.previewUrl
            ? `${isPlaying ? "Pause" : "Play"} ${selectedTrack.title} from ${
                selectedRecord?.title ?? "the selected record"
              }`
            : selectedTrack
              ? `${selectedTrack.title} is available through the official listening links`
              : "Select a track to play"
        }
        disabled={
          !selectedTrack?.previewUrl || isBusy || sceneMode !== "inspect"
        }
        onClick={() => (isPlaying ? pausePlayback() : playTrack())}
      >
        <span className="vinyl-play-button__grooves" aria-hidden="true" />
        <span className="vinyl-play-button__icon" aria-hidden="true" />
        <span className="sr-only">
          {isBusy
            ? "Preparing playback"
            : isPlaying
              ? "Pause selected track"
              : "Play selected track"}
        </span>
      </button>

      <header className="archive-header">
        <div
          className="wordmark"
          aria-label={`${siteConfig.wordmark}, ${siteConfig.collectionName}`}
        >
          <span>{siteConfig.wordmark}</span>
          <span className="wordmark__divider" />
          <span>{siteConfig.collectionName}</span>
        </div>
        <div className="archive-header__actions">
          <button
            ref={settingsTriggerRef}
            type="button"
            className="settings-trigger"
            data-testid="open-settings"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(true)}
          >
            <span aria-hidden="true">◌</span>
            Player
          </button>
          <button
            type="button"
            className={`local-import-trigger ${
              localServiceAvailable ? "is-connected" : ""
            }`}
            data-testid="open-local-import"
            onClick={() => setImportOpen(true)}
          >
            <span aria-hidden="true" />
            Import local vinyl
          </button>
          <button
            type="button"
            className={`local-import-trigger local-audio-trigger ${
              localServiceAvailable ? "is-connected" : ""
            }`}
            data-testid="open-local-audio"
            disabled={!localServiceAvailable}
            onClick={() => setLocalAudioOpen(true)}
          >
            <span aria-hidden="true" />
            Local audio
          </button>
          <div className="archive-count" aria-hidden="true">
            <span>
              {String(physicalDiscCount).padStart(2, "0")} PRESSINGS ·{" "}
              {String(records.length).padStart(2, "0")} RELEASES
            </span>
            <span>01 PRIVATE CATALOG</span>
          </div>
        </div>
      </header>

      <section
        className="browse-caption"
        aria-hidden={isFocused}
        data-testid="browse-caption"
      >
        <p className="eyebrow">
          <span>{String(activeIndex + 1).padStart(2, "0")}</span>
          <span className="eyebrow__line" />
          <span>{String(records.length).padStart(2, "0")}</span>
        </p>
        <h1>{activeRecord.shortTitle}</h1>
        <p className="browse-caption__artist">{activeRecord.artist}</p>
        <button
          type="button"
          className="inspect-button"
          data-testid="inspect-active"
          disabled={isFocused}
          onClick={() => engineRef.current?.focusRecord(activeIndex)}
          aria-label={`Inspect ${activeRecord.title} by ${activeRecord.artist}`}
        >
          <span>View record</span>
          <span aria-hidden="true">↗</span>
        </button>
      </section>

      <button
        type="button"
        className="archive-arrow archive-arrow--left"
        data-testid="browse-previous"
        aria-label="Previous record"
        disabled={isFocused || activeIndex === 0}
        onClick={() => engineRef.current?.browseBy(-1)}
      >
        <ArrowIcon direction="left" />
      </button>
      <button
        type="button"
        className="archive-arrow archive-arrow--right"
        data-testid="browse-next"
        aria-label="Next record"
        disabled={isFocused || activeIndex === records.length - 1}
        onClick={() => engineRef.current?.browseBy(1)}
      >
        <ArrowIcon direction="right" />
      </button>

      <nav className="archive-index" aria-label="Collection position">
        <div className="archive-index__ticks">
          {records.map((record, index) => (
            <button
              key={record.id}
              type="button"
              className={index === activeIndex ? "is-active" : ""}
              aria-label={`Browse to ${record.title} by ${record.artist}`}
              aria-current={index === activeIndex ? "true" : undefined}
              disabled={isFocused}
              onClick={() => engineRef.current?.browseTo(index)}
            >
              <span />
            </button>
          ))}
        </div>
        <div className="input-hint" aria-hidden="true">
          <span>DRAG</span>
          <i />
          <span>SCROLL</span>
          <i />
          <span>ARROW KEYS</span>
        </div>
      </nav>

      <aside
        className="album-panel"
        aria-hidden={!isFocused}
        aria-label={
          selectedRecord ? `Details for ${selectedRecord.title}` : "Album details"
        }
        data-testid="album-panel"
      >
        {selectedRecord ? (
          <div className="album-panel__inner">
            <button
              type="button"
              className="back-button"
              data-testid="return-to-archive"
              onClick={returnToShelf}
            >
              <ArrowIcon direction="left" />
              <span>{siteConfig.returnLabel}</span>
            </button>

            <div className="album-panel__position" aria-hidden="true">
              <span>{String(selectedIndex! + 1).padStart(2, "0")}</span>
              <span>{String(records.length).padStart(2, "0")}</span>
            </div>

            <div className="album-panel__copy">
              <p className="eyebrow">{siteConfig.editionEyebrow}</p>
              <h2>{selectedRecord.title}</h2>
              <p className="album-panel__artist">{selectedRecord.artist}</p>
              <p className="album-panel__description">
                {selectedRecord.description}
              </p>
              <ul className="release-meta">
                <li>{selectedRecord.year}</li>
                <li>{selectedRecord.rpm} RPM</li>
                {selectedRecord.catalogNumber ? (
                  <li>{selectedRecord.catalogNumber}</li>
                ) : null}
                {selectedRecord.edition ? <li>{selectedRecord.edition}</li> : null}
              </ul>

              <section
                className="track-section"
                aria-label="Complete album track listing"
              >
                <p className="track-section__label">
                  <span>Select a track</span>
                  <span>
                    {selectedRecord.tracks.length} tracks ·{" "}
                    {selectedRecord.discCount}{" "}
                    {selectedRecord.discCount === 1 ? "LP" : "LPs"}
                  </span>
                </p>
                <div className="disc-groups">
                  {selectedTrackGroups.map((group) => (
                    <section
                      className="disc-group"
                      key={group.discNumber}
                      aria-label={`LP ${group.discNumber}`}
                    >
                      <p className="disc-group__label">
                        <span>LP {group.discNumber}</span>
                        <span>
                          SIDES {group.sides.join(" / ")}
                        </span>
                      </p>
                      <ol className="track-list">
                        {group.tracks.map((track) => (
                          <li key={track.id}>
                            <button
                              type="button"
                              className={`track-button ${
                                selectedTrack?.id === track.id
                                  ? "is-selected"
                                  : ""
                              } ${
                                track.previewUrl ? "has-local-audio" : ""
                              }`}
                              data-testid={`track-${track.id}`}
                              data-audio-ready={
                                track.previewUrl ? "true" : "false"
                              }
                              aria-label={`${track.title}, ${
                                track.previewUrl
                                  ? "local audio ready"
                                  : "local audio not attached"
                              }`}
                              aria-pressed={selectedTrack?.id === track.id}
                              disabled={isBusy}
                              onClick={() => queueTrack(track, false)}
                            >
                              <span className="track-button__side">
                                {trackPosition(track)}
                              </span>
                              <span className="track-button__title">
                                {track.title}
                              </span>
                              <span className="track-button__duration">
                                {trackDuration(track)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ol>
                    </section>
                  ))}
                </div>
              </section>

              {selectedRecord.links?.length ? (
                <div className="record-links">
                  {selectedRecord.links.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              ) : null}
              {localServiceAvailable && selectedTrack ? (
                <button
                  type="button"
                  className="youtube-download-trigger"
                  data-testid="open-youtube-download"
                  disabled={isBusy}
                  onClick={() =>
                    setYoutubeDownloadTarget({
                      recordId: selectedRecord.id,
                      recordTitle: selectedRecord.title,
                      trackId: selectedTrack.id,
                      trackTitle: selectedTrack.title,
                    })
                  }
                >
                  {selectedTrack.previewUrl
                    ? "Replace audio with yt-dlp"
                    : "Download with yt-dlp"}
                </button>
              ) : null}
              {selectedRecord.localSource?.provider === "spotify" ? (
                <button
                  type="button"
                  className="remove-local-record"
                  onClick={() => void removeSelectedLocalRecord()}
                >
                  Remove local pressing
                </button>
              ) : null}
            </div>

            <div className="focus-controls" aria-label="Inspection controls">
              <span>Drag to orbit · scroll to zoom</span>
              <button
                type="button"
                data-testid="reset-view"
                onClick={() => engineRef.current?.resetFocusView()}
              >
                Reset view
              </button>
            </div>
          </div>
        ) : null}
      </aside>

      <section
        className="player"
        aria-label="Vinyl audio player"
        data-testid="preview-player"
      >
        <div className="player__transport">
          <button
            type="button"
            className="transport-button"
            data-testid="play-pause"
            aria-label={isPlaying ? siteConfig.pauseLabel : siteConfig.playLabel}
            disabled={!selectedTrack?.previewUrl || isBusy}
            onClick={() => (isPlaying ? pausePlayback() : playTrack())}
          >
            <PlayIcon paused={!isPlaying} />
          </button>
          <button
            type="button"
            className="transport-button transport-button--secondary"
            data-testid="stop-playback"
            aria-label={siteConfig.stopLabel}
            disabled={
              playback.mode === "idle" || playback.mode === "stopping"
            }
            onClick={() => stopPlayback(false)}
          >
            <span aria-hidden="true">■</span>
          </button>
        </div>

        <div className="player__main">
          <div className="player__track">
            <strong>{selectedTrack?.title ?? "Select a track"}</strong>
            <span>{selectedRecord?.artist}</span>
          </div>
          <div className="player__timeline">
            <span>{formatTime(playback.currentTime)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(timelineDuration, 1)}
              step={0.1}
              value={
                selectedTrack?.previewUrl
                  ? Math.min(playback.currentTime, Math.max(timelineDuration, 1))
                  : 0
              }
              disabled={
                !selectedTrack?.previewUrl ||
                playback.duration <= 0 ||
                isBusy
              }
              aria-label="Seek preview"
              onChange={(event) => seekPlayback(Number(event.currentTarget.value))}
            />
            <span>{formatTime(timelineDuration)}</span>
          </div>
        </div>

        <label className="player__volume">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={playback.volume}
            aria-label="Preview volume"
            onChange={(event) => {
              const volume = Number(event.currentTarget.value);
              dispatchPlayback({ type: "SET_VOLUME", volume });
              audioRef.current?.setVolume(volume);
            }}
          />
        </label>
      </section>

      <div
        className={`experience-status ${
          playback.mode === "error" ? "is-error" : ""
        }`}
        role="status"
        aria-live="polite"
        data-testid="experience-status"
      >
        <span className="experience-status__dot" />
        <span>{playback.error ?? status}</span>
      </div>

      <div className="loading-screen" aria-hidden={ready}>
        <div className="loading-screen__mark" />
        <p>Cataloging {physicalDiscCount} pressings</p>
      </div>

      <p className="independent-note">{siteConfig.independentNote}</p>

      {settingsOpen ? (
        <div className="turntable-settings">
          <button
            type="button"
            className="turntable-settings__backdrop"
            aria-label="Close player settings"
            onClick={closeSettings}
          />
          <section
            className="turntable-settings__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="turntable-settings-title"
            aria-describedby="turntable-settings-description"
          >
            <div className="turntable-settings__heading">
              <div>
                <p className="eyebrow">Listening setup</p>
                <h2 id="turntable-settings-title">Choose your player</h2>
              </div>
              <button
                ref={settingsCloseRef}
                type="button"
                className="local-import__close"
                aria-label="Close player settings"
                onClick={closeSettings}
              >
                ×
              </button>
            </div>
            <p
              className="turntable-settings__intro"
              id="turntable-settings-description"
            >
              Change the player chassis without interrupting the record,
              platter, or tonearm.
            </p>
            <div
              className="turntable-settings__choices"
              role="radiogroup"
              aria-label="Vinyl player style"
            >
              {turntableVariants.map((variant) => {
                const selected = turntableVariantId === variant.id;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    className={`turntable-choice ${
                      selected ? "is-selected" : ""
                    }`}
                    role="radio"
                    aria-checked={selected}
                    disabled={!variant.available}
                    onClick={() => void chooseTurntableVariant(variant.id)}
                  >
                    <span
                      className={`turntable-choice__preview ${
                        variant.thumbnailUrl ? "has-thumbnail" : ""
                      }`}
                      style={
                        {
                          "--player-primary": variant.palette[0],
                          "--player-secondary": variant.palette[1],
                          "--player-accent": variant.palette[2],
                          ...(variant.thumbnailUrl
                            ? {
                                backgroundImage: `url("${variant.thumbnailUrl}")`,
                              }
                            : {}),
                        } as CSSProperties
                      }
                      aria-hidden="true"
                    >
                      <i />
                    </span>
                    <span className="turntable-choice__copy">
                      <strong>{variant.label}</strong>
                      <span>{variant.description}</span>
                      {!variant.available ? <em>Asset pending</em> : null}
                    </span>
                  </button>
                );
              })}
            </div>
            <p
              className="turntable-settings__status"
              role="status"
              aria-live="polite"
            >
              {turntableVariantStatus}
            </p>
          </section>
        </div>
      ) : null}

      <LocalLibraryImport
        open={importOpen}
        onClose={closeLocalImport}
        onLibraryChanged={refreshLocalLibrary}
      />
      {localAudioOpen ? (
        <LocalAudioManager
          open
          records={records}
          onClose={closeLocalAudio}
          onLibraryChanged={refreshLocalLibrary}
        />
      ) : null}
      <YouTubeDownloadDialog
        key={
          youtubeDownloadTarget
            ? `${youtubeDownloadTarget.recordId}:${youtubeDownloadTarget.trackId}`
            : "closed"
        }
        target={youtubeDownloadTarget}
        onClose={closeYouTubeDownload}
        onLibraryChanged={refreshLocalLibrary}
      />

      <div className="sr-only" aria-live="polite">
        {isFocused && selectedRecord
          ? `Inspecting ${selectedRecord.title} by ${selectedRecord.artist}. Playback is ${playback.mode}.`
          : `Selected ${activeRecord.title} by ${activeRecord.artist}.`}
      </div>
    </main>
  );
}
