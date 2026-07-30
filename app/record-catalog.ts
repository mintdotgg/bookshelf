export type RecordMotif =
  | "signal-bloom"
  | "tidal-lines"
  | "night-grid"
  | "cut-paper"
  | "orbit-cluster"
  | "magnetic-field"
  | "glass-prism"
  | "topographic";

export type RecordSide = "A" | "B" | "C" | "D";
export type VinylDiscNumber = 1 | 2;

export type YouTubeTrackMatch = {
  id: string;
  url: string;
  title: string;
  channel?: string;
  duration?: number;
  confidence: number;
  verified: boolean;
  matchedAt: string;
};

export type LocalTrackAudio = {
  filename: string;
  contentType?: string;
  bytes?: number;
  source: "upload" | "youtube";
  sourceUrl?: string;
  updatedAt: string;
};

export type RecordTrack = {
  id: string;
  title: string;
  /** Track-level artists when they differ from the release artist. */
  artists?: string[];
  /** Album-wide sequence number. */
  trackNumber: number;
  side?: RecordSide;
  /** Number printed within the physical side, such as A1 or C3. */
  sideTrackNumber?: number;
  discNumber?: VinylDiscNumber;
  /** Preview or full recording duration in seconds. */
  duration?: number;
  /** Browser URL for an original or appropriately licensed local recording. */
  previewUrl?: string;
  /** Exact local-file association returned by the loopback library. */
  localAudio?: LocalTrackAudio;
  /** Locally cached YouTube candidate metadata; never an audio source itself. */
  youtubeMatch?: YouTubeTrackMatch;
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
   * Optional authorized catalog artwork. Keep local files under
   * `public/records/<record-id>/`, reference them with `recordAssetUrl`, and
   * document third-party provenance in `THIRD_PARTY_NOTICES.md`.
   */
  coverImage?: string;
  backCoverImage?: string;
  labelImage?: string;

  vinylColor: string;
  vinylOpacity?: number;
  vinylMarbling?: boolean;
  rpm: 33.333 | 45;
  discCount: VinylDiscNumber;

  tracks: RecordTrack[];

  links?: Array<{
    label: string;
    url: string;
  }>;

  /** Present only for records loaded from the loopback filesystem library. */
  localSource?: {
    provider: "spotify" | "catalog";
    url: string | null;
    importedAt: string;
  };

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

function discForSide(side: RecordSide): VinylDiscNumber {
  return side === "C" || side === "D" ? 2 : 1;
}

function catalogTrack(
  id: string,
  title: string,
  trackNumber: number,
  side: RecordSide,
  sideTrackNumber: number,
  duration: number,
): RecordTrack {
  return {
    id,
    title,
    trackNumber,
    side,
    sideTrackNumber,
    discNumber: discForSide(side),
    duration,
  };
}

/**
 * Seven factual releases across nine physical records. The catalog contains
 * complete vinyl-side track layouts and local cover images, but no commercial
 * audio. Official listening and release links accompany every album.
 */
export const recordCatalog: CatalogRecord[] = [
  {
    id: "the-essential-bob-dylan",
    title: "The Essential Bob Dylan",
    shortTitle: "Essential Dylan",
    artist: "Bob Dylan",
    year: 2000,
    description:
      "The twenty-three-song 2016 vinyl edition of Bob Dylan's career-spanning Columbia and Legacy collection, sequenced across two black records.",
    label: "Columbia · Legacy",
    catalogNumber: "88985309551",
    edition: "2016 2×LP · black vinyl",
    genres: ["Folk", "Folk Rock", "Singer-Songwriter"],
    sleeveColor: "#d9d9d8",
    accent: "#6d78b6",
    ink: "#111111",
    motif: "tidal-lines",
    sleeveSize: 2.2,
    sleeveThickness: 0.049,
    coverImage: recordAssetUrl("the-essential-bob-dylan", "cover.jpg"),
    vinylColor: "#111111",
    vinylOpacity: 1,
    rpm: 33.333,
    discCount: 2,
    tracks: [
      catalogTrack("bob-blowin-in-the-wind", "Blowin' in the Wind", 1, "A", 1, 167),
      catalogTrack(
        "bob-dont-think-twice",
        "Don't Think Twice, It's All Right",
        2,
        "A",
        2,
        219,
      ),
      catalogTrack(
        "bob-the-times-they-are-a-changin",
        "The Times They Are A-Changin'",
        3,
        "A",
        3,
        191,
      ),
      catalogTrack("bob-it-aint-me-babe", "It Ain't Me Babe", 4, "A", 4, 213),
      catalogTrack("bob-maggies-farm", "Maggie's Farm", 5, "A", 5, 235),
      catalogTrack(
        "bob-mr-tambourine-man",
        "Mr. Tambourine Man",
        6,
        "A",
        6,
        325,
      ),
      catalogTrack(
        "bob-subterranean-homesick-blues",
        "Subterranean Homesick Blues",
        7,
        "A",
        7,
        138,
      ),
      catalogTrack(
        "bob-like-a-rolling-stone",
        "Like a Rolling Stone",
        8,
        "B",
        1,
        369,
      ),
      catalogTrack(
        "bob-positively-4th-street",
        "Positively 4th Street",
        9,
        "B",
        2,
        247,
      ),
      catalogTrack(
        "bob-just-like-a-woman",
        "Just Like a Woman",
        10,
        "B",
        3,
        290,
      ),
      catalogTrack(
        "bob-rainy-day-women-12-35",
        "Rainy Day Women #12 & 35",
        11,
        "B",
        4,
        274,
      ),
      catalogTrack("bob-lay-lady-lay", "Lay, Lady, Lay", 12, "B", 5, 198),
      catalogTrack(
        "bob-knockin-on-heavens-door",
        "Knockin' on Heaven's Door",
        13,
        "B",
        6,
        150,
      ),
      catalogTrack("bob-forever-young", "Forever Young", 14, "C", 1, 295),
      catalogTrack(
        "bob-tangled-up-in-blue",
        "Tangled Up in Blue",
        15,
        "C",
        2,
        342,
      ),
      catalogTrack(
        "bob-gotta-serve-somebody",
        "Gotta Serve Somebody",
        16,
        "C",
        3,
        325,
      ),
      catalogTrack("bob-jokerman", "Jokerman", 17, "C", 4, 375),
      catalogTrack(
        "bob-make-you-feel-my-love",
        "Make You Feel My Love",
        18,
        "C",
        5,
        211,
      ),
      catalogTrack(
        "bob-things-have-changed",
        "Things Have Changed",
        19,
        "D",
        1,
        308,
      ),
      catalogTrack("bob-mississippi", "Mississippi", 20, "D", 2, 321),
      catalogTrack(
        "bob-when-the-deal-goes-down",
        "When the Deal Goes Down",
        21,
        "D",
        3,
        304,
      ),
      catalogTrack(
        "bob-beyond-here-lies-nothin",
        "Beyond Here Lies Nothin'",
        22,
        "D",
        4,
        228,
      ),
      catalogTrack(
        "bob-long-and-wasted-years",
        "Long and Wasted Years",
        23,
        "D",
        5,
        226,
      ),
    ],
    links: [
      {
        label: "Official album",
        url: "https://www.bobdylan.com/albums/essential-bob-dylan/",
      },
      {
        label: "Official 2LP release",
        url: "https://store.sonymusic.it/products/the-essential-bob-dylan",
      },
    ],
    featured: true,
  },
  {
    id: "lany",
    title: "LANY",
    shortTitle: "LANY",
    artist: "LANY",
    year: 2017,
    description:
      "LANY's complete self-titled debut in its two-record A–D configuration, represented as the standard black-vinyl gatefold edition.",
    label: "Side Street Entertainment · Polydor · Interscope",
    catalogNumber: "B0026559-01",
    edition: "2×LP gatefold · black vinyl",
    genres: ["Alternative", "Dream Pop", "Synth-pop"],
    sleeveColor: "#f3f3f0",
    accent: "#df2438",
    ink: "#242021",
    motif: "signal-bloom",
    sleeveSize: 2.2,
    sleeveThickness: 0.049,
    coverImage: recordAssetUrl("lany", "cover.jpg"),
    vinylColor: "#111111",
    vinylOpacity: 1,
    rpm: 33.333,
    discCount: 2,
    tracks: [
      catalogTrack("dumb-stuff", "Dumb Stuff", 1, "A", 1, 152),
      catalogTrack("the-breakup", "The Breakup", 2, "A", 2, 236),
      catalogTrack("super-far", "Super Far", 3, "A", 3, 203),
      catalogTrack("overtime", "Overtime", 4, "A", 4, 211),
      catalogTrack(
        "flowers-on-the-floor",
        "Flowers on the Floor",
        5,
        "B",
        1,
        258,
      ),
      catalogTrack("parents", "Parents", 6, "B", 2, 78),
      catalogTrack("ilysb", "ILYSB", 7, "B", 3, 211),
      catalogTrack("13", "13", 8, "B", 4, 234),
      catalogTrack("hericane", "Hericane", 9, "C", 1, 346),
      catalogTrack("hurts", "Hurts", 10, "C", 2, 216),
      catalogTrack("good-girls", "Good Girls", 11, "C", 3, 249),
      catalogTrack("pancakes", "Pancakes", 12, "C", 4, 232),
      catalogTrack("tampa", "Tampa", 13, "D", 1, 221),
      catalogTrack("purple-teeth", "Purple Teeth", 14, "D", 2, 233),
      catalogTrack("so-soo-pretty", "So, Soo Pretty", 15, "D", 3, 102),
      catalogTrack("it-was-love", "It Was Love", 16, "D", 4, 228),
    ],
    links: [
      {
        label: "Listen on Apple Music",
        url: "https://music.apple.com/us/album/lany/1440893646",
      },
      {
        label: "Listen on Spotify",
        url: "https://open.spotify.com/album/0HiwsXForePsWdIZW6EEkK",
      },
      {
        label: "Official track listing",
        url: "https://www.universalmusic.ca/press-releases/lany-announce-debut-self-titled-album-available-june-30/",
      },
    ],
    featured: true,
  },
  {
    id: "the-sun-comes-up",
    title: "The Sun Comes Up",
    shortTitle: "Sun Comes Up",
    artist: "Louis The Child",
    year: 2024,
    description:
      "Louis The Child's complete thirteen-track second album, represented by the official blue cloud sleeve and white opaque pressing.",
    label: "Interscope Records",
    edition: "Spotify Fans First · white opaque vinyl",
    genres: ["Electronic", "Dance", "Electropop"],
    sleeveColor: "#73a9df",
    accent: "#f7f2df",
    ink: "#191632",
    motif: "topographic",
    sleeveSize: 2.18,
    sleeveThickness: 0.043,
    coverImage: recordAssetUrl("the-sun-comes-up", "cover.jpg"),
    vinylColor: "#f1eee6",
    vinylOpacity: 1,
    rpm: 33.333,
    discCount: 1,
    tracks: [
      catalogTrack("tscu-believe-it", "Believe It", 1, "A", 1, 150),
      catalogTrack("tscu-supercharger", "Supercharger", 2, "A", 2, 171),
      catalogTrack("tscu-underground", "Underground", 3, "A", 3, 200),
      catalogTrack("tscu-tip-toe", "tip toe", 4, "A", 4, 180),
      catalogTrack("tscu-falling", "Falling", 5, "A", 5, 204),
      catalogTrack("tscu-slow", "Slow", 6, "A", 6, 191),
      catalogTrack("tscu-wonderful", "Wonderful", 7, "A", 7, 184),
      catalogTrack("tscu-make-you-mine", "Make You Mine", 8, "B", 1, 169),
      catalogTrack(
        "tscu-cloud-monsters",
        "Cloud Monsters",
        9,
        "B",
        2,
        171,
      ),
      catalogTrack("tscu-let-you-go", "Let You Go", 10, "B", 3, 202),
      catalogTrack("tscu-how-high", "How High", 11, "B", 4, 191),
      catalogTrack("tscu-stay-with-me", "Stay With Me", 12, "B", 5, 205),
      catalogTrack(
        "tscu-im-not-giving-up",
        "I'm Not Giving Up",
        13,
        "B",
        6,
        160,
      ),
    ],
    links: [
      {
        label: "Official YouTube album",
        url: "https://www.youtube.com/playlist?list=OLAK5uy_nVzH9ayG-N5pLbSwSLXQCKzJ3HgmoCUt4",
      },
      {
        label: "Official vinyl",
        url: "https://interscope.com/products/9418284013129495",
      },
      {
        label: "Track listing",
        url: "https://music.apple.com/us/album/the-sun-comes-up/1769883255",
      },
    ],
    featured: true,
  },
  {
    id: "rumours",
    title: "Rumours",
    shortTitle: "Rumours",
    artist: "Fleetwood Mac",
    year: 1977,
    description:
      "Fleetwood Mac's eleven-song studio album in its original single-record sequence, from “Second Hand News” through “Gold Dust Woman.”",
    label: "Warner Bros. Records",
    catalogNumber: "BSK 3010",
    edition: "1×LP · black vinyl",
    genres: ["Rock", "Pop Rock", "Soft Rock"],
    sleeveColor: "#f0ecdc",
    accent: "#171717",
    ink: "#171717",
    motif: "cut-paper",
    sleeveSize: 2.18,
    sleeveThickness: 0.041,
    coverImage: recordAssetUrl("rumours", "cover.jpg"),
    vinylColor: "#111111",
    vinylOpacity: 1,
    rpm: 33.333,
    discCount: 1,
    tracks: [
      catalogTrack(
        "rumours-second-hand-news",
        "Second Hand News",
        1,
        "A",
        1,
        163,
      ),
      catalogTrack("rumours-dreams", "Dreams", 2, "A", 2, 254),
      catalogTrack(
        "rumours-never-going-back-again",
        "Never Going Back Again",
        3,
        "A",
        3,
        122,
      ),
      catalogTrack("rumours-dont-stop", "Don't Stop", 4, "A", 4, 191),
      catalogTrack(
        "rumours-go-your-own-way",
        "Go Your Own Way",
        5,
        "A",
        5,
        218,
      ),
      catalogTrack("rumours-songbird", "Songbird", 6, "A", 6, 200),
      catalogTrack("rumours-the-chain", "The Chain", 7, "B", 1, 268),
      catalogTrack(
        "rumours-you-make-loving-fun",
        "You Make Loving Fun",
        8,
        "B",
        2,
        211,
      ),
      catalogTrack(
        "rumours-i-dont-want-to-know",
        "I Don't Want to Know",
        9,
        "B",
        3,
        191,
      ),
      catalogTrack("rumours-oh-daddy", "Oh Daddy", 10, "B", 4, 234),
      catalogTrack(
        "rumours-gold-dust-woman",
        "Gold Dust Woman",
        11,
        "B",
        5,
        291,
      ),
    ],
    links: [
      {
        label: "Official album",
        url: "https://www.fleetwoodmacofficial.com/album/rumours",
      },
      {
        label: "Official vinyl",
        url: "https://shop.warnermusic.it/products/rumours-lp-1",
      },
    ],
    featured: true,
  },
  {
    id: "the-dark-side-of-the-moon",
    title: "The Dark Side of the Moon",
    shortTitle: "Dark Side",
    artist: "Pink Floyd",
    year: 1973,
    description:
      "Pink Floyd's continuous ten-track studio suite in its original A/B sequence, represented by the black gatefold prism edition.",
    label: "Harvest · Pink Floyd Records",
    catalogNumber: "19658720271",
    edition: "50th Anniversary remaster · black vinyl",
    genres: ["Progressive Rock", "Psychedelic Rock", "Art Rock"],
    sleeveColor: "#090909",
    accent: "#ee5e4f",
    ink: "#f1eee5",
    motif: "glass-prism",
    sleeveSize: 2.19,
    sleeveThickness: 0.044,
    coverImage: recordAssetUrl("the-dark-side-of-the-moon", "cover.jpg"),
    vinylColor: "#0f0f0f",
    vinylOpacity: 1,
    rpm: 33.333,
    discCount: 1,
    tracks: [
      catalogTrack("dsotm-speak-to-me", "Speak to Me", 1, "A", 1, 68),
      catalogTrack(
        "dsotm-breathe-in-the-air",
        "Breathe (In the Air)",
        2,
        "A",
        2,
        169,
      ),
      catalogTrack("dsotm-on-the-run", "On the Run", 3, "A", 3, 216),
      catalogTrack("dsotm-time", "Time", 4, "A", 4, 421),
      catalogTrack(
        "dsotm-the-great-gig-in-the-sky",
        "The Great Gig in the Sky",
        5,
        "A",
        5,
        276,
      ),
      catalogTrack("dsotm-money", "Money", 6, "B", 1, 382),
      catalogTrack("dsotm-us-and-them", "Us and Them", 7, "B", 2, 466),
      catalogTrack(
        "dsotm-any-colour-you-like",
        "Any Colour You Like",
        8,
        "B",
        3,
        205,
      ),
      catalogTrack("dsotm-brain-damage", "Brain Damage", 9, "B", 4, 228),
      catalogTrack("dsotm-eclipse", "Eclipse", 10, "B", 5, 123),
    ],
    links: [
      {
        label: "Official album",
        url: "https://www.pinkfloyd.com/albums/the-dark-side-of-the-moon/",
      },
      {
        label: "Official vinyl",
        url: "https://store.pinkfloyd.com/products/the-dark-side-of-the-moon-50th-anniversary-remaster",
      },
    ],
    featured: true,
  },
  {
    id: "kind-of-blue",
    title: "Kind of Blue",
    shortTitle: "Kind of Blue",
    artist: "Miles Davis",
    year: 1959,
    description:
      "Miles Davis's five-piece modal jazz landmark in its original single-LP sequence, with side two devoted to “All Blues” and “Flamenco Sketches.”",
    label: "Columbia Records",
    catalogNumber: "CS 8163",
    edition: "180 g 1×LP · black vinyl",
    genres: ["Modal Jazz", "Jazz", "Cool Jazz"],
    sleeveColor: "#111313",
    accent: "#2a78a9",
    ink: "#f4f1e9",
    motif: "night-grid",
    sleeveSize: 2.18,
    sleeveThickness: 0.041,
    coverImage: recordAssetUrl("kind-of-blue", "cover.jpg"),
    vinylColor: "#111111",
    vinylOpacity: 1,
    rpm: 33.333,
    discCount: 1,
    tracks: [
      catalogTrack("kob-so-what", "So What", 1, "A", 1, 562),
      catalogTrack(
        "kob-freddie-freeloader",
        "Freddie Freeloader",
        2,
        "A",
        2,
        586,
      ),
      catalogTrack("kob-blue-in-green", "Blue in Green", 3, "A", 3, 337),
      catalogTrack("kob-all-blues", "All Blues", 4, "B", 1, 693),
      catalogTrack(
        "kob-flamenco-sketches",
        "Flamenco Sketches",
        5,
        "B",
        2,
        566,
      ),
    ],
    links: [
      {
        label: "Official album",
        url: "https://www.milesdavis.com/albums/kind-of-blue/",
      },
      {
        label: "Official vinyl",
        url: "https://shop.milesdavisstore.com/products/kind-of-blue-180-gram-vinyl",
      },
    ],
    featured: true,
  },
  {
    id: "in-the-wee-small-hours",
    title: "In the Wee Small Hours",
    shortTitle: "Wee Small Hours",
    artist: "Frank Sinatra",
    year: 1955,
    description:
      "Frank Sinatra's sixteen-song midnight meditation on lost love, arranged by Nelson Riddle and preserved in its original single-LP mono sequence.",
    label: "Capitol Records",
    catalogNumber: "W 581",
    edition: "Original 12″ mono LP · black vinyl",
    genres: ["Traditional Pop", "Vocal Jazz", "Torch Songs"],
    sleeveColor: "#72a89f",
    accent: "#d8e9dc",
    ink: "#222523",
    motif: "tidal-lines",
    sleeveSize: 2.18,
    sleeveThickness: 0.042,
    coverImage: recordAssetUrl("in-the-wee-small-hours", "cover.jpg"),
    vinylColor: "#111111",
    vinylOpacity: 1,
    rpm: 33.333,
    discCount: 1,
    tracks: [
      catalogTrack(
        "sinatra-in-the-wee-small-hours-of-the-morning",
        "In the Wee Small Hours of the Morning",
        1,
        "A",
        1,
        181,
      ),
      catalogTrack("sinatra-mood-indigo", "Mood Indigo", 2, "A", 2, 210),
      catalogTrack(
        "sinatra-glad-to-be-unhappy",
        "Glad to Be Unhappy",
        3,
        "A",
        3,
        155,
      ),
      catalogTrack(
        "sinatra-i-get-along-without-you-very-well",
        "I Get Along Without You Very Well",
        4,
        "A",
        4,
        223,
      ),
      catalogTrack(
        "sinatra-deep-in-a-dream",
        "Deep in a Dream",
        5,
        "A",
        5,
        169,
      ),
      catalogTrack(
        "sinatra-i-see-your-face-before-me",
        "I See Your Face Before Me",
        6,
        "A",
        6,
        204,
      ),
      catalogTrack(
        "sinatra-cant-we-be-friends",
        "Can't We Be Friends?",
        7,
        "A",
        7,
        168,
      ),
      catalogTrack(
        "sinatra-when-your-lover-has-gone",
        "When Your Lover Has Gone",
        8,
        "A",
        8,
        190,
      ),
      catalogTrack(
        "sinatra-what-is-this-thing-called-love",
        "What Is This Thing Called Love?",
        9,
        "B",
        1,
        156,
      ),
      catalogTrack(
        "sinatra-last-night-when-we-were-young",
        "Last Night When We Were Young",
        10,
        "B",
        2,
        197,
      ),
      catalogTrack(
        "sinatra-ill-be-around",
        "I'll Be Around",
        11,
        "B",
        3,
        179,
      ),
      catalogTrack("sinatra-ill-wind", "Ill Wind", 12, "B", 4, 226),
      catalogTrack(
        "sinatra-it-never-entered-my-mind",
        "It Never Entered My Mind",
        13,
        "B",
        5,
        162,
      ),
      catalogTrack(
        "sinatra-dancing-on-the-ceiling",
        "Dancing on the Ceiling",
        14,
        "B",
        6,
        177,
      ),
      catalogTrack(
        "sinatra-ill-never-be-the-same",
        "I'll Never Be the Same",
        15,
        "B",
        7,
        186,
      ),
      catalogTrack(
        "sinatra-this-love-of-mine",
        "This Love of Mine",
        16,
        "B",
        8,
        214,
      ),
    ],
    links: [
      {
        label: "Official album history",
        url: "https://www.sinatra.com/frank-sinatras-seminal-1955-capitol-album-in-the-wee-small-hours-to-be-reissued-in-blue-notes-tone-poet-vinyl-series-on-nov-14-marking-the-albums-70th-anniversary/",
      },
      {
        label: "Official vinyl",
        url: "https://shop.udiscovermusic.com/products/frank-sinatra-in-the-wee-small-hours-blue-note-tone-poet-vinyl-series-lp",
      },
    ],
    featured: true,
  },
];

/** Compatibility-friendly short name for consumers that treat this as primary data. */
export const catalog = recordCatalog;
