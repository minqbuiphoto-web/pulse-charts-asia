# Pulse Charts

Pulse Charts is an independent Asian music discovery and lyric-production web app. It currently ships 19 charts with 50 ranked rows each, embedded YouTube playback, lyrics tools, a lyric-writing studio, cover studio, and MV studio.

## Run locally

1. Install Node.js 22 or newer.
2. Run `npm install`.
3. Run `npm run dev`.

## Verify and build

Run `npm run sync` to validate and export all 19 charts / 950 ranked rows.
Run `npm run build:pages` to create the static production build.

## Free weekly automation

The workflow in `.github/workflows/weekly-refresh.yml` runs every Monday at 09:00 Bangkok time. It:

1. retrieves current YouTube view counts for the videos already used by the charts;
2. re-sorts every evergreen chart by measured views;
3. keeps unavailable videos unchanged and aborts if too many results are missing;
4. validates all chart, recency, OST grouping, ballad, R&B and video rules;
5. builds the production site;
6. commits verified data changes to GitHub, which triggers Vercel's Git deployment.

The refresh uses the public Return YouTube Dislike statistics endpoint, so no API key or paid service is required.

## Deploy with Vercel

Import the GitHub repository into Vercel once. Keep the included `vercel.json`; Vercel will deploy every verified commit automatically. No database or paid server is required.
