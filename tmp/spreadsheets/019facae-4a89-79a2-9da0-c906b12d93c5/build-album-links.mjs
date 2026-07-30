import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const workDir =
  "/Users/ac-finc/Documents/book-fork/tmp/spreadsheets/019facae-4a89-79a2-9da0-c906b12d93c5";
const outputDir =
  "/Users/ac-finc/Documents/book-fork/outputs/019facae-4a89-79a2-9da0-c906b12d93c5";
const outputPath = `${outputDir}/album-youtube-links.xlsx`;

const lanyTracks = [
  [1, "Dumb Stuff", "", 152, "https://www.youtube.com/watch?v=gxMlgCou6Jk", "Official Audio", "LANYVEVO"],
  [2, "The Breakup", "", 236, "https://www.youtube.com/watch?v=fm9dWLDAN2k", "Official Audio", "LANYVEVO"],
  [3, "Super Far", "", 203, "https://www.youtube.com/watch?v=HlNyHrTm38M", "Official Audio", "LANYVEVO"],
  [4, "Overtime", "", 211, "https://www.youtube.com/watch?v=RZ7HbLbwi68", "Official Audio", "LANYVEVO"],
  [5, "Flowers on the Floor", "", 258, "https://www.youtube.com/watch?v=850jN-ABbm8", "Official Audio", "LANYVEVO"],
  [6, "Parents", "", 78, "https://www.youtube.com/watch?v=wAJ2jisBcYA", "Official Audio", "LANYVEVO"],
  [7, "ILYSB", "", 211, "https://www.youtube.com/watch?v=z-SrH7XY1lc", "Auto-generated album audio", "LANY - Topic"],
  [8, "13", "", 234, "https://www.youtube.com/watch?v=NDWJWILEA7o", "Official Audio", "LANYVEVO"],
  [9, "Hericane", "", 346, "https://www.youtube.com/watch?v=CTDfbigxcK0", "Official Audio", "LANYVEVO"],
  [10, "Hurts", "", 216, "https://www.youtube.com/watch?v=SEZrMORa4uk", "Official Audio", "LANYVEVO"],
  [11, "Good Girls", "", 249, "https://www.youtube.com/watch?v=GInSL3bCCyU", "Official Audio", "LANYVEVO"],
  [12, "Pancakes", "", 232, "https://www.youtube.com/watch?v=ioGv3uIic2E", "Official Audio", "LANYVEVO"],
  [13, "Tampa", "", 221, "https://www.youtube.com/watch?v=KonHAN_957c", "Official Audio", "LANYVEVO"],
  [14, "Purple Teeth", "", 233, "https://www.youtube.com/watch?v=8UNi6i_HDxM", "Official Audio", "LANYVEVO"],
  [15, "So, Soo Pretty", "", 102, "https://www.youtube.com/watch?v=q0OztqLbAEk", "Official Audio", "LANYVEVO"],
  [16, "It Was Love", "", 228, "https://www.youtube.com/watch?v=Xgxhevo0K10", "Official Audio", "LANYVEVO"],
];

const sunTracks = [
  [1, "Believe It", "Madeon", 150, "https://www.youtube.com/watch?v=TBx5Hy53Xyw", "Official Visualizer", "LouistheChildVEVO"],
  [2, "Supercharger", "1996Montana", 171, "https://www.youtube.com/watch?v=3q97N2xAPGE", "Official Visualizer", "LouistheChildVEVO"],
  [3, "Underground", "", 200, "https://www.youtube.com/watch?v=6WhBpeEtAdM", "Official Visualizer", "LouistheChildVEVO"],
  [4, "tip toe", "", 180, "https://www.youtube.com/watch?v=O-fFpfOXpJ0", "Official Visualizer", "LouistheChildVEVO"],
  [5, "Falling", "NJOMZA; Daniel Allan", 204, "https://www.youtube.com/watch?v=3cy8PoR7zfw", "Official Visualizer", "LouistheChildVEVO"],
  [6, "Slow", "Łaszewo; pluko", 191, "https://www.youtube.com/watch?v=PvUUZaSl84Q", "Official Visualizer", "LouistheChildVEVO"],
  [7, "Wonderful", "", 184, "https://www.youtube.com/watch?v=m-E8w8ozBvc", "Official Visualizer", "LouistheChildVEVO"],
  [8, "Make You Mine", "Whethan; Hayley May", 169, "https://www.youtube.com/watch?v=flZei3EVMoY", "Official Visualizer", "LouistheChildVEVO"],
  [9, "Cloud Monsters", "", 171, "https://www.youtube.com/watch?v=zQ_Hd2S_xs8", "Official Visualizer", "LouistheChildVEVO"],
  [10, "Let You Go", "Drew Love", 202, "https://www.youtube.com/watch?v=6Sbs0e1NrD8", "Official Visualizer", "LouistheChildVEVO"],
  [11, "How High", "", 191, "https://www.youtube.com/watch?v=N3nfZ4iC5Uk", "Official Visualizer", "LouistheChildVEVO"],
  [12, "Stay With Me", "Absolutely", 205, "https://www.youtube.com/watch?v=lBcwE6_UGiA", "Official Audio", "Louis The Child"],
  [13, "I'm Not Giving Up", "MEMBA", 160, "https://www.youtube.com/watch?v=i93vajpvsEY", "Official Visualizer", "LouistheChildVEVO"],
];

function secondsToExcelTime(seconds) {
  return seconds / 86400;
}

function styleTitle(sheet, rangeAddress, fill, title, subtitle, note) {
  sheet.showGridLines = false;
  sheet.getRange(rangeAddress).merge();
  sheet.getRange(rangeAddress).values = [[title]];
  sheet.getRange(rangeAddress).format = {
    fill,
    font: {
      name: "Aptos Display",
      size: 22,
      bold: true,
      color: "#FFF8EC",
    },
    verticalAlignment: "center",
  };
  sheet.getRange(rangeAddress).format.rowHeight = 34;

  sheet.getRange("A2:G2").merge();
  sheet.getRange("A2:G2").values = [[subtitle]];
  sheet.getRange("A2:G2").format = {
    fill: "#F3EFE7",
    font: { name: "Aptos", size: 11, bold: true, color: "#2B2A27" },
    verticalAlignment: "center",
  };
  sheet.getRange("A2:G2").format.rowHeight = 23;

  sheet.getRange("A3:G3").merge();
  sheet.getRange("A3:G3").values = [[note]];
  sheet.getRange("A3:G3").format = {
    fill: "#FBF9F4",
    font: { name: "Aptos", size: 9, italic: true, color: "#68645C" },
    verticalAlignment: "center",
    wrapText: true,
    borders: {
      bottom: { style: "thin", color: "#D7D0C5" },
    },
  };
  sheet.getRange("A3:G3").format.rowHeight = 30;
}

function buildAlbumSheet({
  workbook,
  name,
  artist,
  year,
  tracks,
  titleFill,
  playlistUrl,
  tracklistSource,
  tableName,
}) {
  const sheet = workbook.worksheets.add(name);
  const lastDataRow = 5 + tracks.length;
  const totalRow = lastDataRow + 1;

  styleTitle(
    sheet,
    "A1:G1",
    titleFill,
    name,
    `${artist} · ${year} · ${tracks.length} tracks`,
    "Official YouTube links only. No audio files are included in this workbook.",
  );

  sheet.getRange("A5:G5").values = [[
    "Track",
    "Title",
    "Featured artist(s)",
    "Duration",
    "YouTube URL",
    "Upload type",
    "Channel",
  ]];

  const rows = tracks.map(([number, title, featured, seconds, url, type, channel]) => [
    number,
    title,
    featured,
    secondsToExcelTime(seconds),
    url,
    type,
    channel,
  ]);
  sheet.getRange(`A6:G${lastDataRow}`).values = rows;

  const table = sheet.tables.add(`A5:G${lastDataRow}`, true, tableName);
  table.style = "TableStyleMedium2";
  table.showFilterButton = true;

  sheet.getRange(`C${totalRow}`).values = [["Album total"]];
  sheet.getRange(`D${totalRow}`).formulas = [[`=SUM(D6:D${lastDataRow})`]];
  sheet.getRange(`E${totalRow}`).values = [[playlistUrl]];
  sheet.getRange(`F${totalRow}`).values = [["Tracklist source"]];
  sheet.getRange(`G${totalRow}`).values = [[tracklistSource]];

  sheet.getRange(`A${totalRow}:G${totalRow}`).format = {
    fill: "#E9E3D8",
    font: { name: "Aptos", size: 9, bold: true, color: "#2C2925" },
    verticalAlignment: "center",
    borders: {
      top: { style: "medium", color: titleFill },
    },
  };
  sheet.getRange(`A${totalRow}:G${totalRow}`).format.rowHeight = 48;

  sheet.getRange(`A6:A${lastDataRow}`).format = {
    horizontalAlignment: "center",
    numberFormat: "0",
  };
  sheet.getRange(`D6:D${totalRow}`).format = {
    horizontalAlignment: "right",
    numberFormat: "[m]:ss",
  };
  sheet.getRange(`E6:E${totalRow}`).format = {
    font: { name: "Aptos", size: 8, color: "#0B57D0" },
  };
  sheet.getRange(`E${totalRow}:G${totalRow}`).format.wrapText = true;
  sheet.getRange(`G${totalRow}`).format = {
    font: { name: "Aptos", size: 7, color: "#0B57D0" },
  };
  sheet.getRange(`A6:G${lastDataRow}`).format.rowHeight = 22;

  const widths = [
    ["A1:A" + totalRow, 8],
    ["B1:B" + totalRow, 24],
    ["C1:C" + totalRow, 24],
    ["D1:D" + totalRow, 12],
    ["E1:E" + totalRow, 43],
    ["F1:F" + totalRow, 24],
    ["G1:G" + totalRow, 46],
  ];
  for (const [range, width] of widths) {
    sheet.getRange(range).format.columnWidth = width;
  }

  sheet.freezePanes.freezeRows(5);
  return { sheet, lastDataRow, totalRow };
}

const workbook = Workbook.create();

const summary = workbook.worksheets.add("Album Index");
summary.showGridLines = false;
summary.getRange("A1:G1").merge();
summary.getRange("A1:G1").values = [["OFFICIAL YOUTUBE ALBUM INDEX"]];
summary.getRange("A1:G1").format = {
  fill: "#17263A",
  font: {
    name: "Aptos Display",
    size: 22,
    bold: true,
    color: "#FFF7E8",
  },
  verticalAlignment: "center",
};
summary.getRange("A1:G1").format.rowHeight = 36;
summary.getRange("A2:G2").merge();
summary.getRange("A2:G2").values = [[
  "LANY (2017) and The Sun Comes Up (2024) · official YouTube links",
]];
summary.getRange("A2:G2").format = {
  fill: "#E8EDF3",
  font: { name: "Aptos", size: 11, bold: true, color: "#27364A" },
  verticalAlignment: "center",
};
summary.getRange("A2:G2").format.rowHeight = 24;
summary.getRange("A3:G3").merge();
summary.getRange("A3:G3").values = [[
  "Links point to official artist, VEVO, or auto-generated Topic uploads. Full URLs are shown for portability; no audio is embedded.",
]];
summary.getRange("A3:G3").format = {
  fill: "#F7F5F0",
  font: { name: "Aptos", size: 9, italic: true, color: "#625E57" },
  wrapText: true,
  verticalAlignment: "center",
};
summary.getRange("A3:G3").format.rowHeight = 28;
summary.getRange("A5:G5").values = [[
  "Album",
  "Artist",
  "Year",
  "Tracks",
  "Runtime",
  "Official playlist URL",
  "Tracklist source",
]];
summary.getRange("A6:G7").values = [
  [
    "LANY",
    "LANY",
    2017,
    null,
    null,
    "https://www.youtube.com/playlist?list=OLAK5uy_l5sdX-GlI8iivRk9jwsEBBbK3CMHdE3So",
    "https://www.universalmusic.ca/2017/03/03/lany-announce-debut-self-titled-album-available-june-30/",
  ],
  [
    "The Sun Comes Up",
    "Louis The Child",
    2024,
    null,
    null,
    "https://www.youtube.com/playlist?list=OLAK5uy_nVzH9ayG-N5pLbSwSLXQCKzJ3HgmoCUt4",
    "https://interscope.com/products/9418284013129495",
  ],
];

const lany = buildAlbumSheet({
  workbook,
  name: "LANY",
  artist: "LANY",
  year: 2017,
  tracks: lanyTracks,
  titleFill: "#D84B67",
  playlistUrl:
    "https://www.youtube.com/playlist?list=OLAK5uy_l5sdX-GlI8iivRk9jwsEBBbK3CMHdE3So",
  tracklistSource:
    "https://www.universalmusic.ca/2017/03/03/lany-announce-debut-self-titled-album-available-june-30/",
  tableName: "LANYTracks",
});

const sun = buildAlbumSheet({
  workbook,
  name: "The Sun Comes Up",
  artist: "Louis The Child",
  year: 2024,
  tracks: sunTracks,
  titleFill: "#E36F47",
  playlistUrl:
    "https://www.youtube.com/playlist?list=OLAK5uy_nVzH9ayG-N5pLbSwSLXQCKzJ3HgmoCUt4",
  tracklistSource: "https://interscope.com/products/9418284013129495",
  tableName: "SunComesUpTracks",
});

summary.getRange("D6:D7").formulas = [
  ["=COUNTA('LANY'!B6:B21)"],
  ["=COUNTA('The Sun Comes Up'!B6:B18)"],
];
summary.getRange("E6:E7").formulas = [
  [`='LANY'!D${lany.totalRow}`],
  [`='The Sun Comes Up'!D${sun.totalRow}`],
];
const summaryTable = summary.tables.add("A5:G7", true, "AlbumIndex");
summaryTable.style = "TableStyleMedium2";
summaryTable.showFilterButton = false;
summary.getRange("C6:D7").format = {
  horizontalAlignment: "center",
  numberFormat: "0",
};
summary.getRange("E6:E7").format = {
  horizontalAlignment: "right",
  numberFormat: "[m]:ss",
};
summary.getRange("F6:G7").format = {
  font: { name: "Aptos", size: 8, color: "#0B57D0" },
  wrapText: true,
};
summary.getRange("A6:G7").format.rowHeight = 48;
for (const [range, width] of [
  ["A1:A7", 24],
  ["B1:B7", 20],
  ["C1:C7", 9],
  ["D1:D7", 10],
  ["E1:E7", 12],
  ["F1:F7", 47],
  ["G1:G7", 52],
]) {
  summary.getRange(range).format.columnWidth = width;
}
summary.freezePanes.freezeRows(5);

for (const [sheetName, range] of [
  ["Album Index", "A1:G7"],
  ["LANY", `A1:G${lany.totalRow}`],
  ["The Sun Comes Up", `A1:G${sun.totalRow}`],
]) {
  const rendered = await workbook.render({
    sheetName,
    range,
    scale: 1.25,
    format: "png",
  });
  await fs.writeFile(
    `${workDir}/${sheetName.replaceAll(" ", "-").toLowerCase()}-preview.png`,
    new Uint8Array(await rendered.arrayBuffer()),
  );
}

const albumIndexCheck = await workbook.inspect({
  kind: "table",
  range: "Album Index!A1:G7",
  include: "values,formulas",
  tableMaxRows: 10,
  tableMaxCols: 10,
});
console.log(albumIndexCheck.ndjson);

const lanyCheck = await workbook.inspect({
  kind: "table",
  range: `LANY!A5:G${lany.totalRow}`,
  include: "values,formulas",
  tableMaxRows: 25,
  tableMaxCols: 10,
});
console.log(lanyCheck.ndjson);

const sunCheck = await workbook.inspect({
  kind: "table",
  range: `The Sun Comes Up!A5:G${sun.totalRow}`,
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 10,
});
console.log(sunCheck.ndjson);

const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(formulaErrors.ndjson);

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`OUTPUT ${outputPath}`);
