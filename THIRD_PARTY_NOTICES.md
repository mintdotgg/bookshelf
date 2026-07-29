# Third-party notices

The project source depends on the open-source packages listed in `package.json`
and `package-lock.json`. Their copyrights and licenses remain their own.

## Mint Three.js Skills

The repository vendors Mint Three.js Skills under
`.agents/skills/mint-threejs-skills`. Its MIT license is included at
`.agents/skills/mint-threejs-skills/LICENSE`.

Mint tooling is development-only and is not required by the default browser
experience. The starter archive does not include Mint-generated runtime assets.

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

## Starter catalog, procedural artwork, and preview audio

The included record titles, artist names, labels, descriptions, track names,
palettes, motifs, and release metadata are fictional demonstration content
created for Needle Archive.

`app/record-art.ts` generates sleeve and label artwork in the browser from
catalog metadata and deterministic drawing primitives. It does not contain or
download third-party album covers.

`scripts/generate-record-previews.mjs` generates the included preview WAV files
from oscillators and deterministic noise. It does not read sample libraries,
commercial recordings, or third-party compositions. No third-party recordings
or samples are knowingly embedded in the starter previews.

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
