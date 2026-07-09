// Local dev + optional UA-relay server for testing the plugin in Lampa.
//
// 1) Serve the plugin:
//      node serve.js  →  add  http://<your-mac-ip>:8080/lampa-ua.js  in
//      Lampa → Settings → Plugins.  (CORS *, no-cache, always latest build.)
//
// 2) Optional UA relay (to unblock geo-gated sources with Windscribe):
//      - Connect THIS machine's Windscribe to a Ukraine server (device-wide).
//      - In the plugin settings, set the proxy field to:
//            http://<your-mac-ip>:8080/proxy/
//      - The plugin then routes its SCRAPING requests as
//            http://<mac-ip>:8080/proxy/https://target...   → fetched from
//        this machine (i.e. from Ukraine) and returned with CORS.
//      NOTE: this relays the plugin's HTML/player-page requests only. The video
//      player fetches HLS segments directly, so this fixes sources whose *page*
//      is geo-gated but whose CDN is open (e.g. uafix series on ashdi). Sources
//      whose *CDN* is geo-gated (uakino hdvbua/ortified) still need a full
//      device VPN. It also cannot solve a Cloudflare JS challenge (kinoukr
//      search) — a relay has no browser. For full coverage, run the Windscribe
//      VPN (IKEv2/WireGuard) on the TV/device itself instead of this relay.
//
// Personal/local use only. Binds to the LAN so the TV can reach it.
var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var urllib = require('url');

var PORT = process.env.PORT || 8080;
var ROOT = __dirname;
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

function cors(extra) {
  var h = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS'
  };
  if (extra) for (var k in extra) h[k] = extra[k];
  return h;
}

// Relay GET /proxy/<full target url> through this machine's current network
// (= Ukraine, when Windscribe is connected here). Forwards Referer + a browser UA.
function relay(req, res, target, depth) {
  if (depth > 4) { res.writeHead(508, cors()); return res.end('too many redirects'); }
  if (!/^https?:\/\//i.test(target)) { res.writeHead(400, cors()); return res.end('bad target'); }
  var lib = target.slice(0, 5).toLowerCase() === 'https' ? https : http;
  var u = urllib.parse(target);
  var ref = req.headers['x-referer'] || req.headers['referer'] || (u.protocol + '//' + u.host + '/');
  var preq = lib.request(target, {
    method: 'GET',
    headers: { 'User-Agent': req.headers['user-agent'] || UA, 'Referer': ref, 'Accept': '*/*' }
  }, function (pres) {
    if (pres.statusCode >= 300 && pres.statusCode < 400 && pres.headers.location) {
      pres.resume();
      return relay(req, res, urllib.resolve(target, pres.headers.location), depth + 1);
    }
    var h = cors();
    if (pres.headers['content-type']) h['Content-Type'] = pres.headers['content-type'];
    res.writeHead(pres.statusCode || 502, h);
    pres.pipe(res);
  });
  preq.on('error', function (e) { res.writeHead(502, cors()); res.end('relay error: ' + e.message); });
  preq.setTimeout(20000, function () { preq.destroy(); });
  preq.end();
}

http.createServer(function (req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors()); return res.end(); }

  // Relay endpoint: everything after "/proxy/" (raw, query preserved) is the target.
  var p = req.url.indexOf('/proxy/');
  if (p === 0) {
    return relay(req, res, req.url.slice(7), 0);
  }

  var urlPath = decodeURIComponent(req.url.split('?')[0]);
  var file = path.normalize(path.join(ROOT, urlPath === '/' ? 'lampa-ua.js' : urlPath));
  if (file.indexOf(ROOT) !== 0) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, function (err, data) {
    if (err) {
      res.writeHead(404, cors());
      return res.end('Not found: ' + urlPath);
    }
    res.writeHead(200, cors({
      'Content-Type': file.slice(-3) === '.js' ? 'application/javascript; charset=utf-8' : 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    }));
    res.end(data);
  });
}).listen(PORT, function () {
  console.log('Serving  http://0.0.0.0:' + PORT + '/lampa-ua.js');
  console.log('UA relay http://0.0.0.0:' + PORT + '/proxy/   (set as plugin proxy; connect Windscribe→UA on this machine)');
  console.log('Find your IP: ipconfig getifaddr en0');
});
