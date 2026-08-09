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
  type SleevePresentationState,
  type VinylLibraryDiagnostics,
} from "./RecordShelfEngine";
import {
  recordCatalog,
  type CatalogRecord,
  type RecordTrack,
  type VinylDiscNumber,
} from "./record-catalog";
import type { VinylPresentation } from "./record-motion";
import { LocalLibraryImport } from "./LocalLibraryImport";
import { LocalAudioManager } from "./LocalAudioManager";
import { RearrangeLibrary } from "./RearrangeLibrary";
import {
  YouTubeDownloadDialog,
  type YouTubeDownloadTarget,
} from "./YouTubeDownloadDialog";
import {
  fetchLocalCatalog,
  removeLocalRecord,
  saveLocalCatalogOrder,
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
import { shouldResumeTrackTransition } from "./track-transition";
import {
  overlayExitDurationMs,
  usePresence,
} from "./use-presence";

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <span aria-hidden="true" className={`arrow-icon arrow-icon--${direction}`}>
      <span />
    </span>
  );
}

function PlayIcon({ paused }: { paused: boolean }) {
  return (
    <span
      className={`transport-icon transport-icon--${
        paused ? "play" : "pause"
      }`}
      aria-hidden="true"
    />
  );
}

function StopIcon() {
  return (
    <span
      className="transport-icon transport-icon--stop"
      aria-hidden="true"
    />
  );
}

function NextIcon() {
  return (
    <span
      className="transport-icon transport-icon--next"
      aria-hidden="true"
    />
  );
}

function MintWordmark() {
  return (
    <svg
      aria-hidden="true"
      className="made-with-mint__logo"
      viewBox="0 0 764 273"
    >
      <path d="M0 218.182H54.5455V272.727H0V218.182ZM0 163.636H54.5455V218.182H0V163.636ZM0 109.091H54.5455V163.636H0V109.091ZM0 54.5455H54.5455V109.091H0V54.5455ZM54.5455 54.5455H109.091V109.091H54.5455V54.5455ZM109.091 109.091H163.636V163.636H109.091V109.091ZM109.091 163.636H163.636V218.182H109.091V163.636ZM109.091 218.182H163.636V272.727H109.091V218.182ZM163.636 54.5455H218.182V109.091H163.636V54.5455ZM218.182 109.091H272.727V163.636H218.182V109.091ZM218.182 163.636H272.727V218.182H218.182V163.636ZM218.182 218.182H272.727V272.727H218.182V218.182Z" />
      <path d="M327.539 218.182H382.085V272.727H327.539V218.182ZM327.539 163.636H382.085V218.182H327.539V163.636ZM327.539 109.091H382.085V163.636H327.539V109.091ZM327.539 0H382.085V54.5455H327.539V0Z" />
      <path d="M436.523 218.182H491.069V272.727H436.523V218.182ZM436.523 163.636H491.069V218.182H436.523V163.636ZM436.523 109.091H491.069V163.636H436.523V109.091ZM436.523 54.5455H491.069V109.091H436.523V54.5455ZM491.069 54.5455H545.614V109.091H491.069V54.5455ZM545.614 109.091H600.16V163.636H545.614V109.091ZM545.614 163.636H600.16V218.182H545.614V163.636ZM545.614 218.182H600.16V272.727H545.614V218.182Z" />
      <path d="M654.492 0H709.038V54.5455H654.492V0ZM654.492 54.5455H709.038V109.091H654.492V54.5455ZM654.492 109.091H709.038V163.636H654.492V109.091ZM654.492 163.636H709.038V218.182H654.492V163.636ZM654.492 218.182H709.038V272.727H654.492V218.182ZM709.038 218.182H763.583V272.727H709.038V218.182ZM709.038 54.5455H763.583V109.091H709.038V54.5455Z" />
    </svg>
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

type LoadTrackOptions = {
  syncPresentation?: boolean;
  fadeCurrent?: boolean;
};

type LibraryCommands = {
  browse: (index: number) => void;
  focus: (index: number) => void;
  play: (trackId?: string) => void;
  pause: () => void;
  stop: () => void;
  flipSleeve: () => void;
  resetView: () => void;
  returnToShelf: () => void;
};

function mergeLocalRecords(localRecords: CatalogRecord[]): CatalogRecord[] {
  const seedById = new Map(recordCatalog.map((record) => [record.id, record]));
  const mergedIds = new Set<string>();
  const merged = localRecords.map((overlay) => {
    mergedIds.add(overlay.id);
    const record = seedById.get(overlay.id);
    if (!record) return overlay;
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
    ...merged,
    ...recordCatalog.filter((record) => !mergedIds.has(record.id)),
  ];
}

export function VinylLibrary() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vinylPlayRef = useRef<HTMLButtonElement>(null);
  const rearrangeTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const engineRef = useRef<RecordShelfEngine | null>(null);
  const audioRef = useRef<VinylAudioController | null>(null);
  const playbackRef = useRef<PlaybackState>(initialPlaybackState());
  const pendingTrackRef = useRef<PendingTrack>(null);
  const queuedTrackTransitionRef = useRef<PendingTrack>(null);
  const pendingFocusRef = useRef<number | null>(null);
  const pendingImportedRecordIdRef = useRef<string | null>(null);
  const pendingBrowseRecordIdRef = useRef<string | null>(null);
  const pendingRearrangeOpenRef = useRef(false);
  const rearrangeAnchorRecordIdRef = useRef<string | null>(null);
  const turntableVariantRef = useRef<TurntableVariantId>(
    defaultTurntableVariantId,
  );
  const commandsRef = useRef<LibraryCommands>({
    browse() {},
    focus() {},
    play() {},
    pause() {},
    stop() {},
    flipSleeve() {},
    resetView() {},
    returnToShelf() {},
  });
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [sceneMode, setSceneMode] = useState<SceneMode>("browse");
  const [sleeveState, setSleeveState] = useState<SleevePresentationState>({
    recordIndex: 0,
    face: "front",
    flipping: false,
    canFlip: false,
  });
  const [vinylPresentation, setVinylPresentation] =
    useState<VinylPresentation>("sleeve");
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
  const [rearrangeOpen, setRearrangeOpen] = useState(false);
  const [rearrangeSaving, setRearrangeSaving] = useState(false);
  const [rearrangeError, setRearrangeError] = useState<string | null>(null);
  const [turntableVariantId, setTurntableVariantId] =
    useState<TurntableVariantId>(savedTurntableVariantId);
  const [turntableVariantStatus, setTurntableVariantStatus] =
    useState("Player ready");
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Preparing the collection");
  const settingsPresence = usePresence(settingsOpen);
  const closeLocalImport = useCallback(() => setImportOpen(false), []);
  const closeLocalAudio = useCallback(() => setLocalAudioOpen(false), []);
  const openLocalAudio = useCallback(() => {
    setImportOpen(false);
    setLocalAudioOpen(true);
  }, []);
  const closeYouTubeDownload = useCallback(
    () => setYoutubeDownloadTarget(null),
    [],
  );
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    window.setTimeout(
      () => settingsTriggerRef.current?.focus(),
      overlayExitDurationMs,
    );
  }, []);
  const openRearrange = useCallback(() => {
    if (
      sceneMode === "focusing" ||
      sceneMode === "returning" ||
      rearrangeSaving
    ) {
      return;
    }
    rearrangeAnchorRecordIdRef.current =
      records[selectedIndex ?? activeIndex]?.id ?? null;
    setRearrangeError(null);
    if (sceneMode === "browse") {
      setRearrangeOpen(true);
      setStatus("Rearrange mode");
      return;
    }
    pendingRearrangeOpenRef.current = true;
    setStatus("Returning to the shelf to rearrange");
    commandsRef.current.returnToShelf();
  }, [
    activeIndex,
    rearrangeSaving,
    records,
    sceneMode,
    selectedIndex,
  ]);
  const closeRearrange = useCallback(() => {
    pendingRearrangeOpenRef.current = false;
    rearrangeAnchorRecordIdRef.current = null;
    setRearrangeOpen(false);
    setRearrangeError(null);
    setStatus("Shelf order unchanged");
    window.setTimeout(
      () => rearrangeTriggerRef.current?.focus(),
      overlayExitDurationMs,
    );
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

  const revealImportedRecord = useCallback(
    async (importedRecords: CatalogRecord[]) => {
      const importedRecord = importedRecords[0];
      if (!importedRecord) return;
      pendingImportedRecordIdRef.current = importedRecord.id;
      setImportOpen(false);
      setStatus(`Opening ${importedRecord.shortTitle}`);
      await refreshLocalLibrary();
    },
    [refreshLocalLibrary],
  );

  const saveRecordOrder = useCallback(
    async (recordIds: string[]) => {
      const activeRecordId =
        rearrangeAnchorRecordIdRef.current ??
        records[activeIndex]?.id ??
        null;
      setRearrangeSaving(true);
      setRearrangeError(null);
      setStatus("Saving shelf order");
      try {
        const orderedRecords = await saveLocalCatalogOrder(recordIds);
        pendingBrowseRecordIdRef.current = activeRecordId;
        rearrangeAnchorRecordIdRef.current = null;
        setRecords(mergeLocalRecords(orderedRecords));
        setRearrangeOpen(false);
        setStatus("Updating the shelf");
        window.setTimeout(() => canvasRef.current?.focus(), 0);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to save shelf order.";
        setRearrangeError(message);
        setStatus(message);
      } finally {
        setRearrangeSaving(false);
      }
    },
    [activeIndex, records],
  );

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
  const nextTrack = useMemo(() => {
    if (!selectedRecord || !selectedTrack) return null;
    const selectedTrackIndex = selectedRecord.tracks.findIndex(
      (track) => track.id === selectedTrack.id,
    );
    return selectedRecord.tracks[selectedTrackIndex + 1] ?? null;
  }, [selectedRecord, selectedTrack]);
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
  const sleeveFlipLabel =
    sleeveState.face === "back" ? "Show front" : "Show back";
  const sleeveFlipAriaLabel = `${
    sleeveState.flipping ? "Turning" : sleeveFlipLabel
  } ${isFocused ? selectedRecord?.title ?? "selected record" : activeRecord.title}`;
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
    async (
      track: RecordTrack,
      autoplay: boolean,
      options: LoadTrackOptions = {},
    ) => {
      const audio = audioRef.current;
      if (!audio) return;
      setSelectedTrackId(track.id);
      if (options.syncPresentation !== false) {
        engineRef.current?.selectTrack(track);
      }
      if (!track.previewUrl) {
        void audio.stop(options.fadeCurrent ? 120 : 80).catch(() => undefined);
        dispatchPlayback({
          type: "SELECT_CATALOG_TRACK",
          trackId: track.id,
          duration: track.duration,
        });
        engineRef.current?.continueTrackTransition();
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
        if (options.fadeCurrent) {
          await audio.stop(120).catch(() => undefined);
        }
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
      const engine = engineRef.current;
      const state = playbackRef.current;
      const diagnostics = engine?.getDiagnostics();
      const cuePhase = diagnostics?.cuePhase;
      if (state.trackId === track.id) {
        setSelectedTrackId(track.id);
        return;
      }
      if (diagnostics?.trackTransitionPhase) {
        queuedTrackTransitionRef.current = {
          track,
          autoplay: true,
        };
        setSelectedTrackId(track.id);
        setStatus(`${track.title} queued next`);
        return;
      }
      if (cuePhase === "playing") {
        const transition = engine?.startTrackTransition(track);
        if (transition) {
          const resumePlayback = shouldResumeTrackTransition(state, autoplay);
          void audioRef.current?.unlock().catch(() => undefined);
          void loadTrack(track, resumePlayback, {
            syncPresentation: false,
            fadeCurrent: true,
          });
          return;
        }
      }
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
        if (engine.getDiagnostics().trackTransitionPhase) {
          void loadTrack(track, true, {
            syncPresentation: false,
          });
        } else {
          const retryTransition = engine.startTrackTransition(track);
          void loadTrack(track, true, {
            syncPresentation: retryTransition === null,
          });
        }
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
      loadTrack,
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
    queuedTrackTransitionRef.current = null;
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
      queuedTrackTransitionRef.current = null;
      setSceneMode("browse");
      setSleeveState({
        recordIndex: 0,
        face: "front",
        flipping: false,
        canFlip: false,
      });
      setVinylPresentation("sleeve");
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
            if (engineRef.current?.continueTrackTransition()) {
              setStatus(
                next.mode === "cueing"
                  ? "Track ready · finishing the cue"
                  : "Track ready · needle raised",
              );
              return;
            }
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
            const engine = engineRef.current;
            if (
              !engine?.failTrackTransition() &&
              !engine?.holdNeedleAfterPlaybackError()
            ) {
              engine?.stopAndReturnVinyl();
            }
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
          if (
            nextMode === "browse" &&
            pendingRearrangeOpenRef.current
          ) {
            pendingRearrangeOpenRef.current = false;
            queueMicrotask(() => {
              setRearrangeOpen(true);
              setStatus("Rearrange mode");
            });
          }
        },
        onSleeveState: setSleeveState,
        onStatus: setStatus,
        onReady: () => {
          setReady(true);
          const importedRecordId = pendingImportedRecordIdRef.current;
          const importedRecordIndex = importedRecordId
            ? records.findIndex((record) => record.id === importedRecordId)
            : -1;
          if (importedRecordIndex >= 0) {
            pendingImportedRecordIdRef.current = null;
            setStatus(`Opening ${records[importedRecordIndex].shortTitle}`);
            queueMicrotask(() =>
              engineRef.current?.focusRecord(importedRecordIndex),
            );
            return;
          }
          const browseRecordId = pendingBrowseRecordIdRef.current;
          const browseRecordIndex = browseRecordId
            ? records.findIndex((record) => record.id === browseRecordId)
            : -1;
          if (browseRecordIndex >= 0) {
            pendingBrowseRecordIdRef.current = null;
            setStatus("Shelf order saved");
            queueMicrotask(() =>
              engineRef.current?.browseTo(browseRecordIndex),
            );
            return;
          }
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
          const queued = queuedTrackTransitionRef.current;
          queuedTrackTransitionRef.current = null;
          if (queued) {
            queueMicrotask(() =>
              commandsRef.current.play(queued.track.id),
            );
          }
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
        onVinylPresentation: setVinylPresentation,
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
            flipSleeve: () => void;
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
        flipSleeve: () => commandsRef.current.flipSleeve(),
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
      flipSleeve: () => {
        engineRef.current?.toggleSleeveFace();
      },
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

  const deleteLocalRecord = useCallback(async (record: CatalogRecord) => {
    if (
      record.localSource?.provider !== "spotify" ||
      deletingRecordId !== null
    ) {
      return;
    }
    const approved = window.confirm(
      `Delete "${record.title}" from your local collection? This permanently removes the record, its cached artwork, and any attached local audio files from this computer.`,
    );
    if (!approved) return;
    setDeletingRecordId(record.id);
    setStatus(`Deleting ${record.shortTitle}`);
    pendingTrackRef.current = null;
    queuedTrackTransitionRef.current = null;
    pendingFocusRef.current = null;
    try {
      await audioRef.current?.stop(80).catch(() => undefined);
      await removeLocalRecord(record.id);
      await refreshLocalLibrary();
      setStatus(`${record.shortTitle} deleted from the local collection`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : `Unable to delete ${record.shortTitle}`,
      );
    } finally {
      setDeletingRecordId(null);
    }
  }, [deletingRecordId, refreshLocalLibrary]);

  const themeStyle = {
    "--paper": siteConfig.theme.paper,
    "--paper-deep": siteConfig.theme.paperDeep,
    "--paper-light": siteConfig.theme.paperLight,
    "--ink": siteConfig.theme.ink,
    "--ink-soft": siteConfig.theme.inkSoft,
    "--accent": siteConfig.theme.accent,
    "--tan": siteConfig.theme.tan,
    "--line": siteConfig.theme.line,
    "--structure": siteConfig.theme.structure,
    "--soft-hover": siteConfig.theme.softHover,
    "--night": siteConfig.theme.night,
    "--brass": siteConfig.theme.brass,
  } as CSSProperties;

  return (
    <main
      className={`vinyl-experience ${ready ? "is-ready" : ""} ${
        isFocused ? "is-focused" : "is-browsing"
      } ${isPlaying ? "is-playing" : ""} ${
        rearrangeOpen ? "is-rearranging" : ""
      } ${
        vinylPresentation === "sleeve" ? "" : "is-vinyl-presented"
      } ${
        vinylPresentation === "turntable" ? "is-turntable-focused" : ""
      } ${
        vinylPresentation === "moving-to-sleeve"
          ? "is-vinyl-returning"
          : ""
      }`}
      style={themeStyle}
      data-vinyl-presentation={vinylPresentation}
    >
      <canvas
        ref={canvasRef}
        className="archive-canvas"
        data-testid="archive-canvas"
        role="application"
        tabIndex={0}
        aria-label={`Interactive three-dimensional collection of ${records.length} releases and ${physicalDiscCount} vinyl discs. Drag, scroll, or use the arrow keys to browse. Press F to flip the active sleeve and Enter to inspect it.`}
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
          <a
            className="mint-playground-link"
            data-testid="open-mint-playground"
            href={siteConfig.mintPlaygroundUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Explore the full list of open-source Mint projects on Mint Playground (opens in a new tab)"
          >
            {siteConfig.mintPlaygroundLabel}
            <span aria-hidden="true">↗</span>
          </a>
          <button
            ref={rearrangeTriggerRef}
            type="button"
            className="rearrange-trigger"
            data-testid="open-rearrange-library"
            aria-haspopup="dialog"
            aria-expanded={rearrangeOpen}
            disabled={!catalogReady || isBusy || rearrangeSaving}
            onClick={openRearrange}
          >
            <span aria-hidden="true">↕</span>
            Rearrange
          </button>
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
            data-testid="open-import-music"
            onClick={() => setImportOpen(true)}
          >
            <span aria-hidden="true" />
            Import music
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

      <div
        className="made-with-mint"
        data-testid="made-with-mint"
        aria-label="Made with Mint"
      >
        <span aria-hidden="true">Made with</span>
        <a
          className="made-with-mint__link"
          href="https://mint.gg"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Visit Mint"
        >
          <MintWordmark />
        </a>
      </div>

      <section
        className="browse-caption"
        aria-hidden={isFocused}
        data-testid="browse-caption"
      >
        <div className="browse-caption__copy" key={activeRecord.id}>
          <p className="eyebrow">
            <span>{String(activeIndex + 1).padStart(2, "0")}</span>
            <span className="eyebrow__line" />
            <span>{String(records.length).padStart(2, "0")}</span>
          </p>
          <h1>{activeRecord.shortTitle}</h1>
          <p className="browse-caption__artist">{activeRecord.artist}</p>
        </div>
        <div className="browse-caption__actions">
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
          <button
            type="button"
            className="sleeve-flip-button"
            data-testid="flip-sleeve-browse"
            disabled={isFocused || !sleeveState.canFlip}
            onClick={() => engineRef.current?.toggleSleeveFace()}
            aria-label={sleeveFlipAriaLabel}
          >
            <span>{sleeveState.flipping ? "Turning" : sleeveFlipLabel}</span>
            <span aria-hidden="true">↻</span>
          </button>
          {activeRecord.localSource?.provider === "spotify" ? (
            <button
              type="button"
              className="delete-record-button delete-record-button--browse"
              data-testid="delete-record-browse"
              disabled={isBusy || deletingRecordId === activeRecord.id}
              onClick={() => void deleteLocalRecord(activeRecord)}
              aria-label={`Delete ${activeRecord.title}`}
            >
              {deletingRecordId === activeRecord.id ? "Deleting…" : "Delete"}
            </button>
          ) : null}
        </div>
      </section>

      <nav
        className="archive-edge-navigation"
        aria-label="Jump to collection edge"
      >
        <button
          type="button"
          className="archive-arrow archive-arrow--left"
          data-testid="browse-first"
          aria-label="Go to first record"
          aria-keyshortcuts="Meta+ArrowLeft Control+ArrowLeft"
          title="First record · Command or Control + Left Arrow"
          disabled={isFocused || activeIndex === 0}
          onClick={() => engineRef.current?.browseTo(0)}
        >
          <span className="archive-arrow__shortcut" aria-hidden="true">
            <kbd>⌘</kbd>
            <ArrowIcon direction="left" />
          </span>
        </button>
        <button
          type="button"
          className="archive-arrow archive-arrow--right"
          data-testid="browse-last"
          aria-label="Go to last record"
          aria-keyshortcuts="Meta+ArrowRight Control+ArrowRight"
          title="Last record · Command or Control + Right Arrow"
          disabled={isFocused || activeIndex === records.length - 1}
          onClick={() =>
            engineRef.current?.browseTo(records.length - 1)
          }
        >
          <span className="archive-arrow__shortcut" aria-hidden="true">
            <kbd>⌘</kbd>
            <ArrowIcon direction="right" />
          </span>
        </button>
      </nav>

      <nav className="archive-index" aria-label="Collection position">
        <button
          type="button"
          className="archive-index__arrow"
          data-testid="browse-previous"
          aria-label="Previous record"
          disabled={isFocused || activeIndex === 0}
          onClick={() => engineRef.current?.browseBy(-1)}
        >
          <ArrowIcon direction="left" />
        </button>
        <span className="archive-index__position" aria-live="polite">
          <strong>{String(activeIndex + 1).padStart(2, "0")}</strong>
          <i aria-hidden="true">/</i>
          <span>{String(records.length).padStart(2, "0")}</span>
        </span>
        <div className="archive-index__targets">
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
        <button
          type="button"
          className="archive-index__arrow"
          data-testid="browse-next"
          aria-label="Next record"
          disabled={isFocused || activeIndex === records.length - 1}
          onClick={() => engineRef.current?.browseBy(1)}
        >
          <ArrowIcon direction="right" />
        </button>
      </nav>

      <aside
        className="album-panel"
        aria-hidden={!isFocused}
        inert={isFocused ? undefined : true}
        aria-label={
          selectedRecord ? `Details for ${selectedRecord.title}` : "Album details"
        }
        data-testid="album-panel"
      >
        {selectedRecord ? (
          <div className="album-panel__inner">
            <div className="album-panel__topline">
              <button
                type="button"
                className="back-button"
                data-testid="return-to-archive"
                onClick={returnToShelf}
              >
                <ArrowIcon direction="left" />
                <span>{siteConfig.returnLabel}</span>
              </button>
              <button
                type="button"
                className="mobile-sleeve-flip"
                data-testid="flip-sleeve-mobile"
                disabled={!sleeveState.canFlip}
                onClick={() => engineRef.current?.toggleSleeveFace()}
                aria-label={sleeveFlipAriaLabel}
              >
                <span aria-hidden="true">↻</span>
                <span>
                  {sleeveState.flipping ? "Turning" : sleeveFlipLabel}
                </span>
              </button>
            </div>

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
                              onClick={() => playTrack(track)}
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
                  className="delete-record-button delete-record-button--inspect"
                  data-testid="delete-record-inspect"
                  disabled={isBusy || deletingRecordId === selectedRecord.id}
                  onClick={() => void deleteLocalRecord(selectedRecord)}
                  aria-label={`Delete ${selectedRecord.title}`}
                >
                  {deletingRecordId === selectedRecord.id
                    ? "Deleting record…"
                    : "Delete record"}
                </button>
              ) : null}
            </div>

            <div className="focus-controls" aria-label="Inspection controls">
              <span>Drag to orbit · scroll to zoom</span>
              <button
                type="button"
                data-testid="flip-sleeve-inspect"
                disabled={!sleeveState.canFlip}
                onClick={() => engineRef.current?.toggleSleeveFace()}
                aria-label={sleeveFlipAriaLabel}
              >
                {sleeveState.flipping ? "Turning sleeve" : sleeveFlipLabel}
              </button>
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
            <PlayIcon key={isPlaying ? "pause" : "play"} paused={!isPlaying} />
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
            <StopIcon />
          </button>
          <button
            type="button"
            className="transport-button transport-button--secondary"
            data-testid="next-track"
            aria-label={
              nextTrack ? `Play next track: ${nextTrack.title}` : "No next track"
            }
            disabled={!nextTrack || isBusy}
            onClick={() => {
              if (nextTrack) playTrack(nextTrack);
            }}
          >
            <NextIcon />
          </button>
        </div>

        <div className="player__main">
          <div
            className="player__track"
            key={selectedTrack?.id ?? "no-track"}
          >
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
        <span className="experience-status__message" key={playback.error ?? status}>
          {playback.error ?? status}
        </span>
      </div>

      <div className="loading-screen" aria-hidden={ready}>
        <div className="loading-screen__mark" />
        <p>Cataloging {physicalDiscCount} pressings</p>
      </div>

      <p className="independent-note">{siteConfig.independentNote}</p>

      {settingsPresence.mounted ? (
        <div
          className={`turntable-settings motion-overlay is-${settingsPresence.state}`}
          data-motion-state={settingsPresence.state}
          aria-hidden={!settingsOpen}
          inert={settingsOpen ? undefined : true}
        >
          <button
            type="button"
            className="turntable-settings__backdrop motion-backdrop"
            aria-label="Close player settings"
            onClick={closeSettings}
          />
          <section
            className="turntable-settings__dialog motion-dialog"
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
        onImportComplete={revealImportedRecord}
        onOpenAudioManager={openLocalAudio}
      />
      <RearrangeLibrary
        open={rearrangeOpen}
        records={records}
        saving={rearrangeSaving}
        error={rearrangeError}
        onCancel={closeRearrange}
        onSave={saveRecordOrder}
      />
      <LocalAudioManager
        open={localAudioOpen}
        records={records}
        onClose={closeLocalAudio}
        onLibraryChanged={refreshLocalLibrary}
      />
      <YouTubeDownloadDialog
        target={youtubeDownloadTarget}
        onClose={closeYouTubeDownload}
        onLibraryChanged={refreshLocalLibrary}
      />

      <div className="sr-only" aria-live="polite">
        {isFocused && selectedRecord
          ? `Inspecting ${selectedRecord.title} by ${selectedRecord.artist}. ${sleeveState.face} cover visible. Playback is ${playback.mode}.`
          : `Selected ${activeRecord.title} by ${activeRecord.artist}. ${sleeveState.face} cover visible.`}
      </div>
    </main>
  );
}
