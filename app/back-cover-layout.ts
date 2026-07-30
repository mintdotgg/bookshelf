import type { RecordTrack } from "./record-catalog";

const SURFACE_RESOLUTION = 768;
const IMPORTED_TRACK_TOP = 216;
const IMPORTED_TRACK_BOTTOM = 648;
const IMPORTED_TRACKS_PER_COLUMN = 13;
const IMPORTED_MAX_COLUMNS = 4;

export function formatBackCoverTrack(
  track: RecordTrack,
  includeArtists = false,
) {
  const prefix = track.side
    ? `${track.side}${track.sideTrackNumber ?? track.trackNumber}`
    : String(track.trackNumber).padStart(2, "0");
  const artists =
    includeArtists && track.artists?.length
      ? ` — ${[...new Set(track.artists)].join(", ")}`
      : "";
  return `${prefix}  ${track.title}${artists}`;
}

export type ImportedBackCoverTrackLayout = {
  columnCount: number;
  rowsPerColumn: number;
  columnGap: number;
  columnWidth: number;
  lineHeight: number;
  fontSize: number;
  trackTop: number;
  trackBottom: number;
};

export function getImportedBackCoverTrackLayout(
  trackCount: number,
): ImportedBackCoverTrackLayout {
  const safeTrackCount = Math.max(1, Math.floor(trackCount));
  const columnCount = Math.min(
    IMPORTED_MAX_COLUMNS,
    Math.max(1, Math.ceil(safeTrackCount / IMPORTED_TRACKS_PER_COLUMN)),
  );
  const rowsPerColumn = Math.ceil(safeTrackCount / columnCount);
  const columnGap = columnCount >= 3 ? 18 : 28;
  const columnWidth =
    (SURFACE_RESOLUTION - 118 - columnGap * (columnCount - 1)) / columnCount;
  const availableHeight = IMPORTED_TRACK_BOTTOM - IMPORTED_TRACK_TOP;
  const lineHeight = Math.min(27, availableHeight / rowsPerColumn);
  const maximumFontSize =
    columnCount === 1 ? 18 : columnCount === 2 ? 15 : columnCount === 3 ? 12.5 : 10.5;
  const fontSize = Math.max(
    6.5,
    Math.min(maximumFontSize, lineHeight * 0.68),
  );

  return {
    columnCount,
    rowsPerColumn,
    columnGap,
    columnWidth,
    lineHeight,
    fontSize,
    trackTop: IMPORTED_TRACK_TOP,
    trackBottom: IMPORTED_TRACK_BOTTOM,
  };
}
