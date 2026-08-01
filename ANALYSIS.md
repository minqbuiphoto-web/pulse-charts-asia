# Data-source correction

The original build used Apple Music storefront rankings. Those rankings measured activity inside Apple Music and were not domestic national charts.

The current build replaces all main-chart data with transparent snapshots from Circle Chart, Billboard Japan and Tencent Music. No list is derived from or labeled from Apple data.

Because these publishers do not provide one common open API, the MVP stores a verified snapshot and links every list back to its publisher. This avoids unstable scraping and makes the chart period and methodology visible to users.