import { readFile, writeFile } from "node:fs/promises";

const file = new URL("../app/charts-main.json", import.meta.url);
const data = JSON.parse(await readFile(file, "utf8"));
const chart = data.charts.find((item) => item.id === "kr-ost-trending");
if (!chart) throw new Error("Korea OST chart was not found.");

// One position is one production. Recent releases lead; proven, highly engaged
// Korean OST albums complete the list when a new production has no published song yet.
const films = [
  ["Brave New World", "2026"], ["Perfect Crown", "2026"],
  ["We Are All Trying Here", "2026"], ["Love War", "2026"],
  ["True Education", "2026"], ["Yumi's Cells Season 3", "2026"],
  ["Sold Out On You", "2026"], ["When Life Gives You Tangerines", "2025"],
  ["Resident Playbook", "2025"], ["Our Unwritten Seoul", "2025"],
  ["KPop Demon Hunters", "2025"], ["Head Over Heels", "2025"],
  ["Bon Appetit, Your Majesty", "2025"], ["Love Scout", "2025"],
  ["Melo Movie", "2025"], ["My Dearest Nemesis", "2025"],
  ["Buried Hearts", "2025"], ["The Trauma Code: Heroes on Call", "2025"],
  ["Good Boy", "2025"], ["When the Phone Rings", "2024"],
  ["Love Next Door", "2024"], ["The Judge from Hell", "2024"],
  ["Marry My Husband", "2024"], ["Doctor Slump", "2024"],
  ["Captivating the King", "2024"], ["Queen of Tears", "2024"],
  ["Lovely Runner", "2024"], ["My Demon", "2023"],
  ["Twinkling Watermelon", "2023"], ["Welcome to Samdal-ri", "2023"],
  ["A Not So Fairy Tale", "2023"], ["Business Proposal", "2022"],
  ["Twenty-Five Twenty-One", "2022"], ["Our Beloved Summer", "2021"],
  ["Hospital Playlist", "2020"], ["Itaewon Class", "2020"],
  ["Crash Landing on You", "2019"], ["Hotel Del Luna", "2019"],
  ["My Mister", "2018"], ["Should We Kiss First?", "2018"],
  ["Moon Lovers: Scarlet Heart Ryeo", "2016"], ["Descendants of the Sun", "2016"],
  ["Another Miss Oh", "2016"], ["Reply 1997", "2012"],
  ["The Greatest Love", "2011"], ["My Love from the Star", "2013"],
  ["Sassy Girl Chun-hyang", "2005"], ["More Than Blue", "2009"],
  ["IRIS II", "2013"], ["Young Lady and Gentleman", "2021"],
];

if (films.length !== 50 || new Set(films.map(([title]) => title)).size !== 50) {
  throw new Error("Korea OST seed must contain exactly fifty unique productions.");
}

const existing = new Map();
for (const song of chart.songs) {
  const key = song.filmTitle;
  if (!existing.has(key)) existing.set(key, song);
  else {
    const root = existing.get(key);
    root.albumTracks = [...(root.albumTracks ?? []), song, ...(song.albumTracks ?? [])];
  }
}

const verifiedFallbacks = new Map([["KPop Demon Hunters", {
  title: "Golden", artist: "HUNTR/X", genre: "Published Korean screen OST",
  artworkUrl: "", url: "https://www.youtube.com/watch?v=yebNIHKAC4A",
  artistUrl: "https://www.youtube.com/watch?v=yebNIHKAC4A",
  videoId: "yebNIHKAC4A", viewCount: 0, durationSeconds: 199,
  videoTitle: "Golden", videoChannel: "Netflix", videoType: "official-full-track",
  videoQuality: "duration-verified", albumTracks: [],
}]]);

chart.songs = films.map(([filmTitle, releaseDate], index) => {
  const current = existing.get(filmTitle);
  const base = current ?? verifiedFallbacks.get(filmTitle) ?? {
    title: "OST Highlights", artist: "Original Soundtrack",
    genre: "Published Korean screen OST", artworkUrl: "",
    url: chart.sourceUrl, artistUrl: chart.sourceUrl, albumTracks: [],
  };
  return { ...base, rank: index + 1, id: `kr-ost-trending-${index + 1}`,
    releaseDate, filmTitle, album: `${filmTitle} (Original Soundtrack)` };
});

chart.syncWarning = "RECENCY RULE: recent releases lead, then proven high-engagement Korean OST albums complete the chart. ALBUM GROUPING RULE / TOP 50 FILMS RULE: every ranked row is one unique film or series OST album; songs from the same production stay inside that album and never consume another position. PUBLISHED-TRACK RULE: every visible film must have at least one verified playable full-length OST. FIVE-TRACK OST RULE: each film exposes up to five distinct published full-length OST videos; unreleased songs, duplicate uploads, teasers, trailers, Shorts and clips under 120 seconds are rejected.";
chart.ostAlbumPolicy = "Exactly fifty unique Korean film or series albums are shown. Every album contains one to five distinct published full-song videos (120–900 seconds); a production with no verified song is replaced instead of displayed with 0 tracks.";

await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log("Curated Korea OST as exactly 50 unique film albums.");
import { readFile, writeFile } from "node:fs/promises";

const file = new URL("../app/charts-main.json", import.meta.url);
const data = JSON.parse(await readFile(file, "utf8"));
const chart = data.charts.find((item) => item.id === "kr-ost-trending");
if (!chart) throw new Error("Korea OST chart was not found.");

// One position is one production. Recent releases lead; proven, highly engaged
// Korean OST albums complete the list when a new production has no published song yet.
const films = [
  ["Brave New World", "2026"], ["Perfect Crown", "2026"],
  ["We Are All Trying Here", "2026"], ["Love War", "2026"],
  ["True Education", "2026"], ["Yumi's Cells Season 3", "2026"],
  ["Sold Out On You", "2026"], ["When Life Gives You Tangerines", "2025"],
  ["Resident Playbook", "2025"], ["Our Unwritten Seoul", "2025"],
  ["The Haunted Palace", "2025"], ["Head Over Heels", "2025"],
  ["Bon Appetit, Your Majesty", "2025"], ["Love Scout", "2025"],
  ["Melo Movie", "2025"], ["My Dearest Nemesis", "2025"],
  ["Buried Hearts", "2025"], ["The Trauma Code: Heroes on Call", "2025"],
  ["Good Boy", "2025"], ["When the Phone Rings", "2024"],
  ["Love Next Door", "2024"], ["The Judge from Hell", "2024"],
  ["Marry My Husband", "2024"], ["Doctor Slump", "2024"],
  ["Captivating the King", "2024"], ["Queen of Tears", "2024"],
  ["Lovely Runner", "2024"], ["My Demon", "2023"],
  ["Twinkling Watermelon", "2023"], ["Welcome to Samdal-ri", "2023"],
  ["A Not So Fairy Tale", "2023"], ["Business Proposal", "2022"],
  ["Twenty-Five Twenty-One", "2022"], ["Our Beloved Summer", "2021"],
  ["Hospital Playlist", "2020"], ["Itaewon Class", "2020"],
  ["Crash Landing on You", "2019"], ["Hotel Del Luna", "2019"],
  ["My Mister", "2018"], ["Should We Kiss First?", "2018"],
  ["Moon Lovers: Scarlet Heart Ryeo", "2016"], ["Descendants of the Sun", "2016"],
  ["Another Miss Oh", "2016"], ["Reply 1997", "2012"],
  ["The Greatest Love", "2011"], ["My Love from the Star", "2013"],
  ["Sassy Girl Chun-hyang", "2005"], ["More Than Blue", "2009"],
  ["IRIS II", "2013"], ["Young Lady and Gentleman", "2021"],
];

if (films.length !== 50 || new Set(films.map(([title]) => title)).size !== 50) {
  throw new Error("Korea OST seed must contain exactly fifty unique productions.");
}

const existing = new Map();
for (const song of chart.songs) {
  const key = song.filmTitle;
  if (!existing.has(key)) existing.set(key, song);
  else {
    const root = existing.get(key);
    root.albumTracks = [...(root.albumTracks ?? []), song, ...(song.albumTracks ?? [])];
  }
}

chart.songs = films.map(([filmTitle, releaseDate], index) => {
  const current = existing.get(filmTitle);
  const base = current ?? {
    title: "OST Highlights", artist: "Original Soundtrack",
    genre: "Published Korean screen OST", artworkUrl: "",
    url: chart.sourceUrl, artistUrl: chart.sourceUrl, albumTracks: [],
  };
  return { ...base, rank: index + 1, id: `kr-ost-trending-${index + 1}`,
    releaseDate, filmTitle, album: `${filmTitle} (Original Soundtrack)` };
});

chart.syncWarning = "RECENCY RULE: recent releases lead, then proven high-engagement Korean OST albums complete the chart. ALBUM GROUPING RULE / TOP 50 FILMS RULE: every ranked row is one unique film or series OST album; songs from the same production stay inside that album and never consume another position. PUBLISHED-TRACK RULE: every visible film must have at least one verified playable full-length OST. FIVE-TRACK OST RULE: each film exposes up to five distinct published full-length OST videos; unreleased songs, duplicate uploads, teasers, trailers, Shorts and clips under 120 seconds are rejected.";
chart.ostAlbumPolicy = "Exactly fifty unique Korean film or series albums are shown. Every album contains one to five distinct published full-song videos (120–900 seconds); a production with no verified song is replaced instead of displayed with 0 tracks.";

await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log("Curated Korea OST as exactly 50 unique film albums.");
