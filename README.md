# Pulse Charts — Domestic Charts V2

Pulse Charts presents Top 10 snapshots from three domestic Asian music charts:

- South Korea: Circle Digital Chart
- Japan: Billboard Japan Hot 100
- Mainland China: Tencent Music Uni Chart

The main rankings no longer use or derive data from Apple Music. Every chart displays its source, market, period and scoring context.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run sync
npm run dev
```

`npm run sync` validates the committed domestic-chart snapshot. It does not scrape or relabel platform feeds.

## Validate and publish

```bash
npm test
npm run build
```

The project can be deployed to Vercel without a database, paid API or environment variables.

## Current scope

- Three official domestic Top 10 snapshots
- Market filters for Korea, Japan and Mainland China
- Search by song, artist or score
- Source, publication period and methodology shown in the interface
- Direct links to the official chart and YouTube search
- Responsive English interface

Chart data belongs to its respective publishers and rights holders. Pulse Charts is an independent discovery interface and clearly attributes every source.