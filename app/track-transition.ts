import type {
  RecordSide,
  RecordTrack,
  VinylDiscNumber,
} from "./record-catalog";
import type { PlaybackState } from "./audio/playback-state";

export type TrackTransitionKind =
  | "same-side"
  | "flip-side"
  | "swap-disc";

type PhysicalTrackPosition = {
  side?: RecordSide;
  discNumber?: VinylDiscNumber;
};

export function classifyTrackTransition(
  current: PhysicalTrackPosition,
  next: PhysicalTrackPosition,
): TrackTransitionKind {
  const currentDisc = current.discNumber ?? 1;
  const nextDisc = next.discNumber ?? 1;
  if (currentDisc !== nextDisc) return "swap-disc";
  return (current.side ?? "A") === (next.side ?? "A")
    ? "same-side"
    : "flip-side";
}

export function shouldResumeTrackTransition(
  state: Pick<PlaybackState, "mode" | "resumeAfterSeek">,
  requestedAutoplay = false,
) {
  return (
    requestedAutoplay ||
    state.mode === "playing" ||
    state.mode === "cueing" ||
    (state.mode === "seeking" && state.resumeAfterSeek === "playing")
  );
}

export function trackGrooveProgress(
  track: RecordTrack,
  recordTracks: RecordTrack[],
  trackProgress = 0,
): number {
  const side = track.side ?? "A";
  const discNumber = track.discNumber ?? 1;
  const sideTracks = recordTracks
    .filter(
      (candidate) =>
        (candidate.discNumber ?? 1) === discNumber &&
        (candidate.side ?? "A") === side,
    )
    .sort(
      (left, right) =>
        (left.sideTrackNumber ?? left.trackNumber) -
        (right.sideTrackNumber ?? right.trackNumber),
    );
  const targetIndex = Math.max(
    0,
    sideTracks.findIndex((candidate) => candidate.id === track.id),
  );
  const durations = sideTracks.map((candidate) =>
    Math.max(candidate.duration ?? 0, 1),
  );
  const totalDuration = durations.reduce((total, duration) => total + duration, 0);
  const elapsedBeforeTrack = durations
    .slice(0, targetIndex)
    .reduce((total, duration) => total + duration, 0);
  const elapsedWithinTrack =
    durations[targetIndex] * Math.min(1, Math.max(0, trackProgress));

  // Leave a small lead-in/runout margin while preserving the relative
  // positions of tracks with very different durations.
  return (
    0.04 +
    ((elapsedBeforeTrack + elapsedWithinTrack) /
      Math.max(totalDuration, 1)) *
      0.9
  );
}
