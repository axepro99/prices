# Run in the cloud (GitHub Actions)

What it does
- Scrapes EA Play Pro monthly prices per locale, converts to EUR, ranks the top 5 cheapest.
- Prints the Top 5 in the job summary.
- Uploads `results.json` and `results.csv` as artifacts.

How to use
1) Create a new GitHub repo and add these files.
2) Go to the “Actions” tab → select “EA Play Pro Prices (EUR)” → “Run workflow”.
3) After it finishes:
   - Check the job summary for the Top 5 list.
   - Download the `ea-play-pro-prices` artifact for full results.

Notes and limitations
- EA may geolocate pricing by IP and/or require account context. GitHub runners are usually US/EU IPs; some locales might show default/global pricing.
- Treat results as approximate. For authoritative per-country prices, you’d need region-specific egress (proxies/VPN) and a headless browser.
- If parsing breaks because EA changes the page, adjust `extractProMonthlyPrice()`.

Optional improvements
- Add proxies and run each locale through a country-specific exit node.
- Switch to Playwright if the page becomes JS-rendered.