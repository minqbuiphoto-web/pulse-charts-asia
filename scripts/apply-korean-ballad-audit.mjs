import fs from "node:fs";

const file = new URL("../app/charts-classics.json", import.meta.url);
const data = JSON.parse(fs.readFileSync(file, "utf8"));

const verified = new Map(Object.entries({
  "I Will Go to You Like the First Snow|Ailee": ["6rS7OUGXUik", 86495160, "official-audio", "STONE MUSIC"],
  "Drowning|WOODZ": ["NbKH4iZqq1Y", 225099799, "official-audio", "WOODZ"],
  "Like It|Yoon Jong Shin": ["jy_UiIQn_d0", 42521786, "official-live", "Dingo Music"],
  "Goodbye|Park Hyo Shin": ["NGznnPbpZa4", 23672129, "official-video", "PARK HYO SHIN"],
  "Dear Name|IU": ["JSOBF_WhqEM", 32710717, "official-audio", "IU Official"],
  "Always|Yoon Mirae": ["aE0eV2YR51k", 113233422, "official-mv", "MUSIC&NEW"],
  "Love, Maybe|MeloMance": ["UoBsiQW23IY", 65797329, "official-mv", "1theK"],
  "You Are My Everything|Gummy": ["ToASX6axGuw", 97879464, "official-mv", "MUSIC&NEW"],
  "Someday, The Boy|Kim Feel": ["qho6wWlsANw", 46038396, "official-mv", "VLENDING"],
  "Goodbye|WENDY": ["A-emJHnVtZ8", 11375239, "official-mv", "VEM"],
  "Event Horizon|YOUNHA": ["BBdC1rl5sKY", 40634986, "official-mv", "YOUNHA OFFICIAL"],
  "I Give You My Heart|IU": ["euI-C1YONaU", 57212524, "official-audio", "IU Official"],
  "Flower Way|Kim Sejeong": ["OnnzqzlcCaY", 9694470, "official-live", "Dingo Music"],
  "The Snowman|Jung Seung Hwan": ["iOxd2wGatAk", 8928168, "official-live", "Beginagain"],
  "Every Day, Every Moment|Paul Kim": ["EXV8TwTo0A0", 11513659, "official-live", "JTBC"],
  "Run With Me|Sunwoojunga": ["wyN27QpglGE", 9885736, "official-live", "JTBC"],
  "If There Was Practice in Love|Lim Jae Hyun": ["lNNPWLC8sTo", 29942772, "official-audio", "Lim Jae Hyun Official"],
  "Let's Say Goodbye|Parc Jae Jung": ["EYzgL19wj2g", 15650428, "official-live", "KBS Kpop"],
  "Love Always Runs Away|Lim Young Woong": ["LKQ-18LoFQk", 23014021, "official-mv", "MOSTCONTENTS"],
  "The Day Was Beautiful|Kassy": ["5RN97CV9I6k", 1446630, "official-live", "Kassy Official"],
  "Please Don't|K.Will": ["PdUiCJnRptk", 85566639, "official-mv", "STARSHIP"],
  "IF|TAEYEON": ["jJKHTJy_eek", 50197436, "official-live", "JTBC"],
  "Wedding Dress|TAEYANG": ["qIt6KCwlFPw", 81067834, "official-mv", "YG ENTERTAINMENT"],
  "Turtle|Davichi": ["12u5oZpowzs", 13940786, "official-audio", "DAVICHI"],
  "On Rainy Days|BEAST": ["NY47mqz4yCg", 80303436, "official-audio", "BEAST Topic"],
  "8282|Davichi": ["kXgVibbrLaQ", 8975697, "official-audio", "DAVICHI"],
  "Every Moment of You|Sung Si Kyung": ["Dbxzh078jr4", 27612098, "official-mv", "1theK"],
  "Back in Time|Lyn": ["yBPZ8Kyrssc", 11512620, "official-live", "JTBC"],
  "Snow Flower|Gummy": ["DvxPS--TgWs", 4601591, "official-live", "JTBC"],
  "Hello|Huh Gak": ["R9qjc2bvdrY", 6697351, "official-audio", "Huh Gak Topic"],
  "Sing For You|EXO": ["nqaSboKBIuA", 45437885, "official-mv", "SMTOWN"],
  "My Destiny|Lyn": ["D07Q2k04uCU", 40031435, "official-mv", "1theK"],
  "Singing Got Better|Ailee": ["S66XVYn6lnE", 1179029, "official-live", "SBSKPOP"],
  "Will You Marry Me|Lee Seung Gi": ["7MPHlqNhh4M", 6296357, "official-audio", "Lee Seung Gi"],
  "Dropping Tears|K.Will": ["MKkrSBjNIvw", 13195645, "official-audio", "K.Will"],
  "Last Love|Kim Bum Soo": ["9LI3k1XWDIc", 4412165, "official-live", "SBSKPOP"],
  "Time Walking on Memories|NELL": ["83IfZhO4Pd0", 20492489, "official-live", "ONSTAGE"],
  "I Miss You|Kim Bum Soo": ["1uk7176wJFk", 26894382, "official-live", "SBS"],
  "Endless|Flower": ["UgHAESJ74XY", 7040827, "official-live", "JTBC"],
  "For You|Yim Jae Beum": ["cDS3vu_Ep6E", 16123196, "official-live", "MBCkpop"],
  "Fixing My Makeup|Wax": ["luwdlYsCQ6M", 15400591, "official-mv", "WEJHYS J"],
  "Forbidden Love|Kim Kyung Ho": ["Mc2XnrvB9DE", 9316017, "official-live", "SBS"],
  "One Love|M.C the Max": ["eo3RlZyls9k", 9446589, "official-audio", "M.C the MAX Official"],
  "Aloha|Cool": ["vJRDg1ZCRl8", 17731839, "official-audio", "COOL Topic"],
  "Do You Know|Jo Sung Mo": ["12W5qcG2vXw", 6954888, "official-audio", "Jo Sung Mo Topic"],
  "Already One Year|Brown Eyes": ["7mJLmpuxzaQ", 20623849, "original-recording", "pops8090"],
  "Saldaga|SG Wannabe": ["ymY-gWJjCQU", 11594244, "official-live", "Hangout with Yoo"],
  "Thorn|Buzz": ["o3fXfrS0wSU", 3214614, "original-live", "BuzzLegends"],
  "Coward|Buzz": ["G7eLG4Tnc9c", 1556741, "original-recording", "웅키"],
  "Missing You|Fly to the Sky": ["bmyRW23d5Ps", 3118405, "official-audio", "FLY TO THE SKY OFFICIAL"],
  "Still Beautiful|Toy": ["nuAiFzEkFZM", 55672048, "official-audio", "Toy Topic"],
  "If You Come Back|Gummy": ["aWVB3CjkPW0", 918833, "official-audio", "GUMMY"],
  "Blue Rain|Fin.K.L": ["laOjX70fI_M", 968041, "official-live", "JTBC"],
  "Day by Day|As One": ["_1dfbpT00fE", 5954437, "original-recording", "Lukeiru"],
  "In Dreams|Lena Park": ["a2QYzdvzpvA", 8327492, "official-live", "JTBC"],
  "P.S. I Love You|Lena Park": ["4CKcZN_9JXg", 2062210, "official-live", "JTBC"],
  "Timeless|SG Wannabe": ["SJk5Nks2Xvg", 13702754, "official-live", "Hangout with Yoo"],
  "I Believe|Shin Seung Hun": ["-UZnpcufkbc", 14007573, "original-recording", "pops8090"],
  "Crime and Punishment|SG Wannabe": ["yMAzoEHbmzg", 3556257, "official-video", "STONE MUSIC"],
  "Amnesia|Gummy": ["k0YihgysbVs", 583198, "official-mv", "YG ENTERTAINMENT"],
  "I Believe|Lee Soo Young": ["dGqMD-dgBEE", 1958806, "original-recording", "carcass1178"],
  "Parting Taxi|Kim Yeon Woo": ["ic_DQjII5bE", 6937654, "official-audio", "Kim Yeon Woo Topic"],
  "Already Sad Love|Yada": ["Cq2O6bdIEoE", 4834355, "official-audio", "Yada Topic"],
  "Emergency Room|izi": ["E-BvyQb7mWE", 50585678, "official-audio", "izi Oh Jin Sung"],
  "Good Person|Toy": ["ddiUp-mnXHw", 2642677, "official-live", "JTBC"],
  "Should I Say I Love You Again|Kim Dong Ryul": ["np0s2col2I4", 22620479, "official-live", "KBS"],
}));

let changed = 0;
for (const chart of data.charts.filter((item) => item.id.startsWith("kr-ballad-evergreen-"))) {
  for (const song of chart.songs) {
    const update = verified.get(`${song.title}|${song.artist}`);
    if (!update) continue;
    const [videoId, viewCount, videoType, videoChannel] = update;
    Object.assign(song, {
      videoId,
      viewCount,
      videoType,
      videoChannel,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      artistUrl: `https://www.youtube.com/watch?v=${videoId}`,
      reviewed: true,
    });
    changed += 1;
  }
  chart.songs.sort((a, b) => b.viewCount - a.viewCount);
  chart.songs.forEach((song, index) => {
    song.rank = index + 1;
    song.id = `${chart.id}-${index + 1}`;
    song.genre = `Ballad · ${song.viewCount.toLocaleString("en-US")} YouTube views`;
  });
  chart.updatedAt = "2026-08-04T05:00:00.000Z";
  chart.syncWarning = "EVERGREEN TOP 50 · BALLAD ONLY. Ranked strictly by the highest verified public YouTube view count for the original artist and song. Compared sources include official MV, official/topic audio, licensed original-artist live stages, and verified original recordings where no canonical upload exists. Covers, karaoke, reactions, compilations, wrong artists and similarly named songs are excluded. Counts are a public YouTube snapshot and may change.";
}

data.generatedAt = "2026-08-04T05:00:00.000Z";
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Applied ${changed} verified video upgrades and reranked 3 charts.`);
