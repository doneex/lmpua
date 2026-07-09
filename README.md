# UA Онлайн — Lampa plugin

Ukrainian streaming sources for the [Lampa](https://github.com/lampa-app/LAMPA) media player, as a **single client-side JavaScript file**. No server, no proxy to host, no credentials. It adds a **"Дивитися (UA)"** button to the standard Lampa card and integrates as a normal online source (source selector, inline series, watched progress, availability/quality badges).

## Install

In Lampa: **Settings → Plugins → Add plugin**, and paste:

```
https://raw.githubusercontent.com/doneex/lmpua/main/lampa-ua.js
```

Then open any movie/series and press **Дивитися (UA)**.

> Reachable from anywhere, including with a VPN enabled on the device — unlike a local dev server on your LAN.

## Sources

| Source | Content | Works without VPN |
|--------|---------|-------------------|
| **UAFilm** (klon.fun) | films + series, UA | ✅ yes |
| **UASerials** (uaserials.fm) | films + series, UA | ✅ yes |
| **UAFix** (uafix.net) | Netflix dubbed UA | ⚠️ films only (series geo-locked to UA) |
| **UAKino** (uakino.com.ua) | films + series, UA | ▶️ needs a Ukraine VPN (players geo-locked) |
| **KinoUkr** (kinoukr.tv) | films + series, UA | ▶️ streams yes; search may be blocked by the site's Cloudflare check |

Sources you can't reach directly show an honest message ("недоступно у вашому регіоні" / "пошук заблоковано"), never a fake result.

## Geo-locked content

Some Ukrainian CDNs only serve viewers in Ukraine. To watch those, enable a **Ukraine VPN on the device** (WireGuard recommended) — everything then routes through Ukraine and plays. This plugin never ships or requires a proxy of its own.

### Optional proxy field

Settings → *UA Онлайн* has an optional **Proxy** field (blank by default). If you run your own CORS/relay proxy you can paste it there; it's used only as a last resort after a direct request fails. Nothing is baked in.

## Local development

`serve.js` is a zero-dependency Node static server for testing an unreleased build over your LAN:

```
node serve.js
# then add  http://<your-computer-ip>:8080/lampa-ua.js  in Lampa
```

(Only works when the device is on the same network and not tunneling through a VPN.)

## Notes

- Single hand-maintained ES5 file (`lampa-ua.js`) — works on old Android-TV WebViews. No build step.
- Targets the native Lampa apps (Android / Android TV / Tizen), where requests bypass browser CORS.
- No accounts, tokens, or secrets anywhere in the code.

## License

For personal use only.
