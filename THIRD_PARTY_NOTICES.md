# Third-party notices

The project source depends on the open-source packages listed in `package.json`
and `package-lock.json`. Their copyrights and licenses remain their own.

## Mint Three.js Skills

The repository vendors Mint Three.js Skills under
`.agents/skills/mint-threejs-skills`. Its MIT license is included at
`.agents/skills/mint-threejs-skills/LICENSE`.

Mint tooling is development-only and is not required by the default browser
experience. The starter archive does not include Mint-generated runtime assets.

## spotify-to-mp3 reference implementation

The local YouTube matcher was informed by the query-variation and small-batch
matching approach in
[carrabre/spotify-to-mp3](https://github.com/carrabre/spotify-to-mp3), which is
distributed under the MIT License. Side One uses its own local `yt-dlp`
search, confidence scoring, authorization gate, and filesystem download
pipeline; it does not use the reference project's external converter services
or unrelated-video fallbacks.

## Runtime libraries, build tools, data, and fonts

Three.js is distributed under the MIT License. The Inter and Newsreader font
packages are distributed under the SIL Open Font License 1.1. Sharp is
distributed under the Apache License 2.0; its platform packages can include
libvips under the GNU Lesser General Public License 3.0 or later. Caniuse data
used by the build toolchain is distributed under Creative Commons Attribution
4.0.

Transitive dependencies retain their upstream copyright notices and license
terms. Consult `package-lock.json` and the installed packages for the complete
dependency graph.

## Catalog metadata, cover artwork, and audio

The bundled catalog contains factual metadata for seven commercial releases:
Bob Dylan's *The Essential Bob Dylan*, LANY's self-titled debut, Louis The
Child's *The Sun Comes Up*, Fleetwood Mac's *Rumours*, Pink Floyd's *The Dark
Side of the Moon*, Miles Davis's *Kind of Blue*, and Frank Sinatra's *In the
Wee Small Hours*. The artists, labels, publishers, designers, photographers,
and other rights holders retain their respective names, marks, recordings,
compositions, artwork, and other rights.

Track order, vinyl-side configuration, and edition details were checked against
the following artist or label sources:

- [The Essential Bob Dylan — Sony Music](https://store.sonymusic.it/products/the-essential-bob-dylan)
- [LANY — Universal Music Canada](https://www.universalmusic.ca/press-releases/lany-announce-debut-self-titled-album-available-june-30/)
- [The Sun Comes Up — Interscope Records](https://interscope.com/products/9418284013129495)
- [Rumours — Fleetwood Mac](https://www.fleetwoodmacofficial.com/album/rumours)
- [The Dark Side of the Moon — Pink Floyd](https://www.pinkfloyd.com/albums/the-dark-side-of-the-moon-50th-anniversary/)
- [Kind of Blue — Miles Davis](https://www.milesdavis.com/albums/kind-of-blue/)
- [In the Wee Small Hours — Frank Sinatra](https://www.sinatra.com/frank-sinatras-seminal-1955-capitol-album-in-the-wee-small-hours-to-be-reissued-in-blue-notes-tone-poet-vinyl-series-on-nov-14-marking-the-albums-70th-anniversary/)

The catalog-display JPEGs under `public/records/` were retrieved from the
[Cover Art Archive](https://coverartarchive.org/) release groups for
[The Essential Bob Dylan](https://coverartarchive.org/release-group/b70e1d6d-dc14-30a0-81a0-24e80da9faba),
[LANY](https://coverartarchive.org/release-group/ccdb33b0-ee64-47c4-88a9-444c24f3522f),
[The Sun Comes Up](https://coverartarchive.org/release-group/9dc67e5b-d5cb-4d05-9aac-62710b9971b9),
[Rumours](https://coverartarchive.org/release-group/416bb5e5-c7d1-3977-8fd7-7c9daf6c2be6),
[The Dark Side of the Moon](https://coverartarchive.org/release-group/f5093c06-23e3-404f-aeaa-40f72885ee3a),
[Kind of Blue](https://coverartarchive.org/release-group/8e8a594f-2175-38c7-a871-abb68ec363e7),
and [In the Wee Small Hours](https://coverartarchive.org/release-group/5a5d9938-38a9-3f32-b03b-8f14f62b880a).
The Cover Art Archive makes cover images available as a cataloging service; it
does not transfer copyright in the underlying artwork.

No commercial recording is bundled with the seed catalog. Album entries link
to official listening or release pages instead.

`app/record-art.ts` continues to generate fallback sleeve, spine, back-cover,
and label artwork in the browser from catalog metadata and deterministic
drawing primitives.

`scripts/generate-record-previews.mjs` can generate contributor-owned
placeholder WAV files from oscillators and deterministic noise. It does not
read sample libraries, commercial recordings, or third-party compositions.

These statements describe provenance; they do not expand or replace the
repository’s applicable licensing terms.

## Contributor media

Files added under `public/records/<record-id>/` remain subject to their own
copyright and license terms. Contributors must have permission to redistribute
every artwork file, composition, performance, recording, and embedded sample.
Public availability, purchase, or access through a streaming service does not
grant redistribution rights.

Add required attribution, copyright, and license notices here when introducing
third-party media. Do not commit credentials, private media, temporary signed
URLs, or assets whose license is incompatible with public source and
deployment.
