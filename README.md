# UA Онлайн — Lampa plugin

Ukrainian streaming sources for the [Lampa](https://github.com/lampa-app/LAMPA) media player, as a **single client-side JavaScript file**. No server, no proxy to host, no credentials. It adds a **"Дивитися (UA)"** button to the standard Lampa card and integrates as a normal online source (source selector, inline series, watched progress, availability/quality badges).

## Install

In Lampa: **Settings → Plugins → Add plugin**, and paste one of:

```
https://doneex.github.io/lmpua/lu.js
```
```
https://raw.githubusercontent.com/doneex/lmpua/main/lu.js
```

The first (GitHub Pages) is preferred once Pages is enabled (Settings → Pages → Deploy from branch → `main` / root). The raw URL works immediately either way. Then open any movie/series and press **Дивитися (UA)**.

> Reachable from anywhere, including with a VPN enabled on the device — unlike a local dev server on your LAN.
>
> After updating: remove and re-add the plugin (or restart Lampa) so it re-fetches; GitHub's CDN can lag a few minutes.

## Sources

| Source | Content | Works without VPN |
|--------|---------|-------------------|
| **UAFilm** (klon.fun) | films + series, UA | ✅ yes |
| **UASerials** (uaserials.vip) | films + series, UA | ✅ yes |
| **UAFix** (uafix.net) | Netflix dubbed UA | ⚠️ films only (series geo-locked to UA) |
| **UAKino** (uakino.com.ua) | films + series, UA | ▶️ needs a Ukraine VPN (players geo-locked) |
| **KinoUkr** (kinoukr.tv) | films + series, UA | ▶️ streams yes; search may be blocked by the site's Cloudflare check |

Sources you can't reach directly show an honest message ("недоступно у вашому регіоні" / "пошук заблоковано"), never a fake result.

## Geo-locked content

Some Ukrainian CDNs only serve viewers in Ukraine. To watch those, enable a **Ukraine VPN on the device** (WireGuard recommended) — everything then routes through Ukraine and plays. This plugin never ships or requires a proxy of its own.

### Optional proxy field

Settings → *UA Онлайн* has an optional **Proxy** field (blank by default). If you run your own CORS/relay proxy you can paste it there; it's tried right after a direct request fails, before the built-in public fallbacks. The value is used as a prefix before the target URL; if it ends with `=` (e.g. `https://my.host/fetch?url=`), the target URL is percent-encoded first.

## LG / webOS / Media Station X (browser-based Lampa)

On **Android / Android TV** the Lampa app fetches sites through its native network stack, so everything works directly. On **LG TVs (Media Station X)** and other browser-based setups, Lampa runs inside the TV's browser engine, where cross-origin requests to the source sites are blocked by CORS — without help, every source shows *"Помилка з'єднання"*.

The plugin handles this with a fallback chain, per request: **direct → your proxy (if set) → public CORS proxies** (`api.allorigins.win`, `api.codetabs.com`). Once a tier works for a host, later requests go straight to it. The public proxies are free, shared, and **flaky** — search may be slow or occasionally fail; retry usually works.

For a reliable setup, deploy your own free [Cloudflare Worker](https://workers.cloudflare.com) (5 minutes, no card required) and paste its URL (e.g. `https://your-name.workers.dev/`) into the **Proxy** field:

```js
// Cloudflare Worker: personal CORS relay, restricted to this plugin's source hosts.
const ALLOW = /(^|\.)(uafix\.net|klon\.fun|uaserials\.vip|uakino\.com\.ua|bambooua\.com|ashdi\.vip|zetvideo\.net|kinoukr\.tv|hdvbua\.pro)$/;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': '*' };
// Player hosts that hide the real page unless the embedding site's Referer is sent
// (browsers strip Referer from XHR, so the relay must add it):
const REFERER = { 'zetvideo.net': 'https://uafix.net/' };
export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    // target = everything after the worker origin, e.g. /https://uafix.net/... (query preserved)
    let target = req.url.slice(new URL(req.url).origin.length + 1);
    target = target.replace(/^(https?:\/)([^/])/, '$1/$2'); // undo path normalization of "//"
    if (!/^https?:\/\//.test(target)) return new Response('Bad target', { status: 400, headers: CORS });
    let host; try { host = new URL(target).hostname; } catch { return new Response('Bad URL', { status: 400, headers: CORS }); }
    if (!ALLOW.test(host)) return new Response('Host not allowed', { status: 403, headers: CORS });
    const headers = { 'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36', 'Accept': '*/*' };
    const ct0 = req.headers.get('Content-Type'); if (ct0) headers['Content-Type'] = ct0;
    const rg = req.headers.get('Range'); if (rg) headers['Range'] = rg;
    const ref = REFERER[host.replace(/^www\./, '')]; if (ref) headers['Referer'] = ref;
    const r = await fetch(target, {
      method: req.method,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
      headers, redirect: 'follow'
    });
    const h = new Headers(r.headers);
    for (const k in CORS) h.set(k, CORS[k]);
    h.delete('Content-Security-Policy'); h.delete('X-Frame-Options'); h.delete('Set-Cookie');
    h.delete('Content-Encoding'); h.delete('Content-Length'); // body is already decoded by the runtime
    // HLS playlists reference variants/segments/keys by RELATIVE URL — rewrite every URI
    // to absolute and back through this relay, so hls.js on the TV streams via the worker too.
    const ct = r.headers.get('Content-Type') || '';
    const finalUrl = r.url || target;
    if (/mpegurl/i.test(ct) || /\.m3u8(\?|$)/.test(finalUrl)) {
      const text = await r.text();
      if (text.slice(0, 7) === '#EXTM3U') {
        const origin = new URL(req.url).origin;
        const base = new URL(finalUrl);
        const prox = (u) => { try { return origin + '/' + new URL(u, base).href; } catch (e) { return u; } };
        const out = text.split('\n').map((line) => {
          const t = line.trim();
          if (!t) return line;
          if (t[0] === '#') return line.replace(/URI="([^"]+)"/g, (m, u) => 'URI="' + prox(u) + '"');
          return prox(t);
        }).join('\n');
        return new Response(out, { status: r.status, headers: h });
      }
      return new Response(text, { status: r.status, headers: h });
    }
    return new Response(r.body, { status: r.status, headers: h });
  }
};
```

Playback on browser-based platforms goes through the relay too: Lampa plays HLS there with hls.js, whose manifest/segment requests are also CORS-blocked (`manifestLoadError`). When no native network stack is detected and a proxy is set in settings, the plugin hands the player relay-prefixed stream and subtitle URLs, and the worker above rewrites `.m3u8` manifests so segments keep flowing through it. On Android everything plays direct as before. This only works with your own worker (prefix-style) — the `?url=`-style public proxies can't rewrite manifests, so playback skips them.

(Historical note: the plugin originally used uaserials.fm, whose Cloudflare protection silently drops relay traffic — it has since switched to the uaserials.vip install, which has no such gate and works through the relay like every other source.)

## Local development

`serve.js` is a zero-dependency Node static server for testing an unreleased build over your LAN:

```
node serve.js
# then add  http://<your-computer-ip>:8080/lu.js  in Lampa
```

(Only works when the device is on the same network and not tunneling through a VPN.)

## Notes

- Shipped as a single ES5 file (`lu.js`) — works on old Android-TV WebViews.
- Native Lampa apps (Android / Android TV / Tizen) fetch everything directly; browser-based setups (LG webOS / Media Station X) fall back to CORS proxies — see the section above.
- No accounts, tokens, or secrets anywhere in the code.

## License

For personal use only.
