# Pulse Charts

Pulse Charts is an independent English-language music discovery site with nine Top 20 views:

- Korea Pop
- Korea Ballad
- Japan Billboard
- China QQ Music
- Korea OST
- Japan OST
- China OST

It includes market filters, track and artist search, chart switching, source links, and a focused track panel. The visual covers use CSS instead of external image files, preventing broken artwork icons.

## Data transparency

The Japan Billboard and China QQ Music views link to their named sources. Korea Pop, Korea Ballad, and the OST views are restored discovery snapshots from the original seven-chart system. Curated views are labelled as snapshots and are not presented as official national rankings.

## Run locally

Install Node.js, run npm install, then run npm run dev.

## Verify and build

Run npm test. It validates seven charts and 70 ranked tracks, creates the production build, and runs rendering checks.

## Deploy

Import this folder into Vercel or run vercel --prod. The site is static-first and needs no database or paid API.