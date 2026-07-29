export type RecordMotif =
  | "signal-bloom"
  | "tidal-lines"
  | "night-grid"
  | "cut-paper"
  | "orbit-cluster"
  | "magnetic-field"
  | "glass-prism"
  | "topographic";

export type RecordTrack = {
  id: string;
  title: string;
  trackNumber: number;
  side?: "A" | "B";
  /** Preview duration in seconds. */
  duration?: number;
  /** Browser URL for an original or appropriately licensed preview. */
  previewUrl?: string;
};

export type CatalogRecord = {
  id: string;
  title: string;
  shortTitle: string;
  artist: string;
  year: number;
  description: string;

  label?: string;
  catalogNumber?: string;
  edition?: string;
  genres: string[];

  sleeveColor: string;
  accent: string;
  ink: string;
  motif: RecordMotif;

  sleeveSize?: number;
  sleeveThickness?: number;

  /**
   * Optional contributor-owned artwork. Keep local replacements under
   * `public/records/<record-id>/` and reference them with `recordAssetUrl`.
   */
  coverImage?: string;
  backCoverImage?: string;
  labelImage?: string;

  vinylColor: string;
  vinylOpacity?: number;
  vinylMarbling?: boolean;
  rpm: 33.333 | 45;

  tracks: RecordTrack[];

  links?: Array<{
    label: string;
    url: string;
  }>;

  featured?: boolean;
};

export const RECORD_ASSET_ROOT = "/records" as const;

/**
 * Builds a stable public URL without coupling catalog entries to a deployment
 * origin. `filename` may contain subdirectories, but must be relative.
 */
export function recordAssetUrl(recordId: string, filename: string) {
  const cleanId = recordId.replace(/^\/+|\/+$/g, "");
  const cleanFilename = filename.replace(/^\/+/, "");
  return `${RECORD_ASSET_ROOT}/${cleanId}/${cleanFilename}`;
}

/**
 * A rights-safe starter catalog. Every artist, release, description, and track
 * title is fictional and original to this project. The preview paths are
 * intentionally conventional so a fork can replace the audio in place.
 */
export const recordCatalog: CatalogRecord[] = [
  {
    id: "afterimage-transit",
    title: "Afterimage Transit",
    shortTitle: "Afterimage",
    artist: "Lumen Fields",
    year: 2026,
    description:
      "Patient synthesizer arcs and softly struck percussion trace the memory of a late train through a city that has already gone quiet.",
    label: "North Window Editions",
    catalogNumber: "NWE-001",
    edition: "First pressing · translucent smoke",
    genres: ["Ambient", "Electronic", "Minimal"],
    sleeveColor: "#18242d",
    accent: "#f0a45d",
    ink: "#f4ead9",
    motif: "signal-bloom",
    sleeveSize: 2.18,
    sleeveThickness: 0.09,
    vinylColor: "#2f3940",
    vinylOpacity: 0.86,
    vinylMarbling: true,
    rpm: 33.333,
    tracks: [
      {
        id: "platform-light",
        title: "Platform Light",
        trackNumber: 1,
        side: "A",
        duration: 18,
        previewUrl: recordAssetUrl(
          "afterimage-transit",
          "preview-platform-light.wav",
        ),
      },
      {
        id: "windows-in-motion",
        title: "Windows in Motion",
        trackNumber: 2,
        side: "B",
        duration: 18,
        previewUrl: recordAssetUrl(
          "afterimage-transit",
          "preview-windows-in-motion.wav",
        ),
      },
    ],
    featured: true,
  },
  {
    id: "salt-meridian",
    title: "Salt Meridian",
    shortTitle: "Salt Meridian",
    artist: "Mara Venn",
    year: 2024,
    description:
      "Close-miked strings, dry hand drums, and an open horizon of tape echo form a coastal folk record shaped by wind and distance.",
    label: "Sounding Line",
    catalogNumber: "SL-017",
    edition: "Sea-glass pressing",
    genres: ["Folk", "Experimental", "Acoustic"],
    sleeveColor: "#d9d0bb",
    accent: "#176b70",
    ink: "#1d292b",
    motif: "tidal-lines",
    sleeveSize: 2.14,
    sleeveThickness: 0.082,
    vinylColor: "#4c9b96",
    vinylOpacity: 0.72,
    vinylMarbling: true,
    rpm: 33.333,
    tracks: [
      {
        id: "low-water-mark",
        title: "Low Water Mark",
        trackNumber: 1,
        side: "A",
        duration: 18,
        previewUrl: recordAssetUrl(
          "salt-meridian",
          "preview-low-water-mark.wav",
        ),
      },
      {
        id: "lanterns-at-dusk",
        title: "Lanterns at Dusk",
        trackNumber: 2,
        side: "B",
        duration: 18,
        previewUrl: recordAssetUrl(
          "salt-meridian",
          "preview-lanterns-at-dusk.wav",
        ),
      },
    ],
  },
  {
    id: "night-geometry",
    title: "Night Geometry",
    shortTitle: "Night Geometry",
    artist: "Static Palace",
    year: 2025,
    description:
      "Angular bass figures and luminous drum-machine patterns turn empty architecture into a precise, nocturnal dance floor.",
    label: "Measured Air",
    catalogNumber: "MA-044",
    edition: "Midnight blue vinyl",
    genres: ["Synthwave", "Post-punk", "Electronic"],
    sleeveColor: "#10142a",
    accent: "#7b83ff",
    ink: "#f0efe4",
    motif: "night-grid",
    sleeveSize: 2.2,
    sleeveThickness: 0.086,
    vinylColor: "#171f5c",
    vinylOpacity: 0.94,
    rpm: 45,
    tracks: [
      {
        id: "blue-corridor",
        title: "Blue Corridor",
        trackNumber: 1,
        side: "A",
        duration: 18,
        previewUrl: recordAssetUrl(
          "night-geometry",
          "preview-blue-corridor.wav",
        ),
      },
      {
        id: "vanishing-point",
        title: "Vanishing Point",
        trackNumber: 2,
        side: "B",
        duration: 18,
        previewUrl: recordAssetUrl(
          "night-geometry",
          "preview-vanishing-point.wav",
        ),
      },
    ],
    featured: true,
  },
  {
    id: "glass-orchard",
    title: "Glass Orchard",
    shortTitle: "Glass Orchard",
    artist: "Juniper Radio",
    year: 2023,
    description:
      "Warm electric piano and small, bright guitar phrases grow into weightless pop arrangements with a hand-cut, tactile character.",
    label: "Field Note Recording Co.",
    catalogNumber: "FNR-009",
    edition: "Recycled clear pressing",
    genres: ["Dream Pop", "Indie", "Psychedelic"],
    sleeveColor: "#e8b871",
    accent: "#bd3b49",
    ink: "#272224",
    motif: "cut-paper",
    sleeveSize: 2.12,
    sleeveThickness: 0.078,
    vinylColor: "#d9d5c8",
    vinylOpacity: 0.58,
    vinylMarbling: true,
    rpm: 33.333,
    tracks: [
      {
        id: "fruit-of-the-wire",
        title: "Fruit of the Wire",
        trackNumber: 1,
        side: "A",
        duration: 18,
        previewUrl: recordAssetUrl(
          "glass-orchard",
          "preview-fruit-of-the-wire.wav",
        ),
      },
      {
        id: "small-sun",
        title: "Small Sun",
        trackNumber: 2,
        side: "B",
        duration: 18,
        previewUrl: recordAssetUrl("glass-orchard", "preview-small-sun.wav"),
      },
    ],
  },
  {
    id: "common-satellites",
    title: "Common Satellites",
    shortTitle: "Satellites",
    artist: "Cinder Atlas",
    year: 2022,
    description:
      "A loose constellation of brushed drums, upright bass, and analog keys circles themes of friendship, signal, and shared time.",
    label: "Perigee Works",
    catalogNumber: "PW-028",
    edition: "Black vinyl · tip-on sleeve",
    genres: ["Jazz", "Downtempo", "Instrumental"],
    sleeveColor: "#563b34",
    accent: "#e3c668",
    ink: "#f3ead8",
    motif: "orbit-cluster",
    sleeveSize: 2.17,
    sleeveThickness: 0.092,
    vinylColor: "#161616",
    vinylOpacity: 0.98,
    rpm: 33.333,
    tracks: [
      {
        id: "friendly-orbit",
        title: "Friendly Orbit",
        trackNumber: 1,
        side: "A",
        duration: 18,
        previewUrl: recordAssetUrl(
          "common-satellites",
          "preview-friendly-orbit.wav",
        ),
      },
      {
        id: "receiver-warm",
        title: "Receiver Warm",
        trackNumber: 2,
        side: "B",
        duration: 18,
        previewUrl: recordAssetUrl(
          "common-satellites",
          "preview-receiver-warm.wav",
        ),
      },
    ],
  },
  {
    id: "soft-machinery",
    title: "Soft Machinery",
    shortTitle: "Soft Machinery",
    artist: "Oriel Drive",
    year: 2026,
    description:
      "Interlocking mallets, elastic bass, and gently overdriven electronics imagine a machine built for care instead of speed.",
    label: "Kind Current",
    catalogNumber: "KC-103",
    edition: "Copper-swirl pressing",
    genres: ["Art Rock", "Krautrock", "Electronic"],
    sleeveColor: "#31554f",
    accent: "#e4774f",
    ink: "#f1e7d2",
    motif: "magnetic-field",
    sleeveSize: 2.19,
    sleeveThickness: 0.096,
    vinylColor: "#a54b35",
    vinylOpacity: 0.9,
    vinylMarbling: true,
    rpm: 45,
    tracks: [
      {
        id: "useful-motion",
        title: "Useful Motion",
        trackNumber: 1,
        side: "A",
        duration: 18,
        previewUrl: recordAssetUrl(
          "soft-machinery",
          "preview-useful-motion.wav",
        ),
      },
      {
        id: "hands-in-the-loop",
        title: "Hands in the Loop",
        trackNumber: 2,
        side: "B",
        duration: 18,
        previewUrl: recordAssetUrl(
          "soft-machinery",
          "preview-hands-in-the-loop.wav",
        ),
      },
    ],
    featured: true,
  },
  {
    id: "tidal-memory",
    title: "Tidal Memory",
    shortTitle: "Tidal Memory",
    artist: "House of Serein",
    year: 2021,
    description:
      "Slow chamber harmonies surface through field recordings and submerged voices, then recede before their edges fully resolve.",
    label: "Stillwater Assembly",
    catalogNumber: "SA-006",
    edition: "Frosted lavender pressing",
    genres: ["Ambient", "Modern Classical", "Field Recording"],
    sleeveColor: "#b8b5cc",
    accent: "#514b79",
    ink: "#20202a",
    motif: "glass-prism",
    sleeveSize: 2.13,
    sleeveThickness: 0.08,
    vinylColor: "#9289b2",
    vinylOpacity: 0.66,
    vinylMarbling: true,
    rpm: 33.333,
    tracks: [
      {
        id: "room-below-the-tide",
        title: "Room Below the Tide",
        trackNumber: 1,
        side: "A",
        duration: 18,
        previewUrl: recordAssetUrl(
          "tidal-memory",
          "preview-room-below-the-tide.wav",
        ),
      },
      {
        id: "names-in-sea-glass",
        title: "Names in Sea Glass",
        trackNumber: 2,
        side: "B",
        duration: 18,
        previewUrl: recordAssetUrl(
          "tidal-memory",
          "preview-names-in-sea-glass.wav",
        ),
      },
    ],
  },
  {
    id: "amber-index",
    title: "Amber Index",
    shortTitle: "Amber Index",
    artist: "Paper Cities",
    year: 2025,
    description:
      "Dusty breakbeats, clipped brass, and library-room textures make a compact atlas of imagined streets and half-remembered addresses.",
    label: "Margin Audio",
    catalogNumber: "MGA-031",
    edition: "Honey amber vinyl",
    genres: ["Trip-hop", "Instrumental Hip-hop", "Sample-free"],
    sleeveColor: "#b5542f",
    accent: "#f1c36d",
    ink: "#241d1a",
    motif: "topographic",
    sleeveSize: 2.16,
    sleeveThickness: 0.088,
    vinylColor: "#c66f22",
    vinylOpacity: 0.8,
    rpm: 33.333,
    tracks: [
      {
        id: "folded-blocks",
        title: "Folded Blocks",
        trackNumber: 1,
        side: "A",
        duration: 18,
        previewUrl: recordAssetUrl(
          "amber-index",
          "preview-folded-blocks.wav",
        ),
      },
      {
        id: "streetlight-catalog",
        title: "Streetlight Catalog",
        trackNumber: 2,
        side: "B",
        duration: 18,
        previewUrl: recordAssetUrl(
          "amber-index",
          "preview-streetlight-catalog.wav",
        ),
      },
    ],
  },
];

/** Compatibility-friendly short name for consumers that treat this as primary data. */
export const catalog = recordCatalog;
