/* UA Онлайн (lu) — Lampa plugin. Source & docs: github.com/doneex/lmpua (see docs/). ES5, single-file, no server. */
(function() {
  "use strict";
  if (window.online_ua_plugin) return;
  window.online_ua_plugin = true;
  var CONFIG = {
    PLUGIN_ID: "online_ua",
    VERSION: "0.1.0",
    NAME: "UA Онлайн",
    PROXY_CHAIN: [ "https://api.allorigins.win/raw?url=", "https://api.codetabs.com/v1/proxy?quest=" ],
    STORAGE: {
      proxy: "online_ua_proxy_url",
      source: "online_ua_source",
      enabled_prefix: "online_ua_enabled_",
      probe: "online_ua_probe",
      movie_voice: "online_ua_movie_voice"
    }
  };
  var NET_TIER_HINT = {};
  function urlHost(url) {
    var m = /^https?:\/\/([^\/]+)/.exec("" + url);
    return m ? m[1] : "";
  }
  function proxied(prefix, url) {
    return prefix.charAt(prefix.length - 1) === "=" ? prefix + encodeURIComponent(url) : prefix + url;
  }
  function userProxyPrefix() {
    var p = ((Lampa.Storage.field(CONFIG.STORAGE.proxy) || "") + "").trim();
    if (!p) return "";
    var last = p.charAt(p.length - 1);
    if (last !== "/" && last !== "=" && last !== "?" && last !== "&") p += "/";
    return p;
  }
  function net(url, opts, ok, err) {
    opts = opts || {};
    ok = ok || function() {};
    err = err || function() {};
    var request = new Lampa.Reguest;
    var timeout = opts.timeout || 15e3;
    var post = opts.post || false;
    var params = {
      dataType: opts.dataType || "text"
    };
    if (opts.headers) params.headers = opts.headers;
    var chain = [];
    chain.push(url);
    var user_proxy = userProxyPrefix();
    if (user_proxy && !(post && user_proxy.charAt(user_proxy.length - 1) === "=")) chain.push(proxied(user_proxy, url));
    for (var i = 0; i < CONFIG.PROXY_CHAIN.length; i++) {
      var prefix = CONFIG.PROXY_CHAIN[i];
      if (post && prefix.charAt(prefix.length - 1) === "=") continue;
      chain.push(proxied(prefix, url));
    }
    var host = urlHost(url);
    var start = NET_TIER_HINT[host] || 0;
    if (start >= chain.length) start = 0;
    var index = start;
    var stopped = false;
    function attempt(last_a, last_c) {
      if (stopped) return;
      if (index >= chain.length) {
        if (start > 0) delete NET_TIER_HINT[host];
        err(last_a, last_c);
        return;
      }
      var tier = index;
      var target = chain[index];
      index++;
      request.clear();
      request.timeout(timeout);
      request["native"](target, function(body) {
        if (stopped) return;
        if (body === "" || body === null || body === undefined) {
          attempt(body, "empty");
          return;
        }
        NET_TIER_HINT[host] = tier;
        ok(body, target);
      }, function(a, c) {
        attempt(a, c);
      }, post, params);
    }
    attempt();
    return {
      clear: function() {
        stopped = true;
        request.clear();
      }
    };
  }
  var SOURCES = {};
  function canDirect() {
    try {
      if (window.AndroidJS) return true;
      var p = Lampa.Platform;
      if (!p || !p.is) return true;
      return !!(p.is("android") || p.is("tizen"));
    } catch (e) {
      return true;
    }
  }
  function playableUrl(url) {
    if (!url || canDirect()) return url;
    if (!/^https?:\/\//.test("" + url)) return url;
    var prefix = userProxyPrefix();
    if (!prefix) return url;
    if (prefix.charAt(prefix.length - 1) === "=") return url;
    return prefix + url;
  }
  function proxySubtitles(subs) {
    if (!subs || !subs.length || canDirect()) return subs;
    var out = [];
    for (var i = 0; i < subs.length; i++) {
      out.push({
        label: subs[i].label,
        url: playableUrl(subs[i].url)
      });
    }
    return out;
  }
  function allSourceKeys() {
    var keys = [];
    for (var k in SOURCES) {
      if (!SOURCES.hasOwnProperty(k) || SOURCES[k].hidden) continue;
      if (SOURCES[k].requiresDirect && !canDirect()) continue;
      keys.push(k);
    }
    keys.sort(function(a, b) {
      return (SOURCES[a].priority || 0) - (SOURCES[b].priority || 0);
    });
    return keys;
  }
  function sourceEnabled(id) {
    return Lampa.Storage.get(CONFIG.STORAGE.enabled_prefix + id, true) !== false;
  }
  function enabledSourceKeys() {
    return allSourceKeys().filter(function(id) {
      return sourceEnabled(id);
    });
  }
  function absUrl(url, base) {
    if (!url) return "";
    url = ("" + url).trim();
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("http") === 0) return url;
    if (url.charAt(0) === "/") return base + url;
    return base + "/" + url;
  }
  function htmlDoc(html) {
    return (new DOMParser).parseFromString(html, "text/html");
  }
  function metaContent(doc, prop) {
    var el = doc.querySelector('meta[property="' + prop + '"]');
    return el ? el.getAttribute("content") || "" : "";
  }
  function isGeoHost(url) {
    return /(ashdi|tortuga|moon)/i.test("" + (url || ""));
  }
  function parseSubtitles(str) {
    var out = [];
    ("" + (str || "")).split(",").forEach(function(s) {
      var mm = s.match(/\[([^\]]+)\](.*)/);
      if (mm && mm[2]) out.push({
        label: mm[1],
        url: mm[2].trim()
      }); else if (s.indexOf("http") === 0) out.push({
        label: "sub",
        url: s.trim()
      });
    });
    return out;
  }
  function parsePlayerjs(text) {
    var res = {
      file: "",
      poster: "",
      subtitles: [],
      playlist: null
    };
    var m = text.match(/file\s*:\s*'(\[[\s\S]*?\])'\s*[,}]/);
    if (!m) m = text.match(/file\s*:\s*"(\[[\s\S]*?\])"\s*[,}]/);
    if (m) {
      try {
        res.playlist = JSON.parse(m[1]);
      } catch (e) {
        res.playlist = null;
      }
    }
    if (!res.playlist) {
      var fm = text.match(/file\s*:\s*"([^"]*)"/);
      if (!fm) fm = text.match(/file\s*:\s*'([^']*)'/);
      if (fm) res.file = fm[1];
    }
    var pm = text.match(/poster\s*:\s*"([^"]*)"/);
    if (pm) res.poster = pm[1];
    var sm = text.match(/subtitle\s*:\s*"([^"]*)"/);
    if (sm && sm[1]) res.subtitles = parseSubtitles(sm[1]);
    return res;
  }
  function playlistToVoices(playlist) {
    function eps(arr) {
      return arr.map(function(ep, i) {
        return {
          title: (ep.title || "Серія " + (i + 1)).replace(/\s+/g, " ").trim(),
          file: ep.file || "",
          id: ep.id || ep.vid || "",
          poster: ep.poster || "",
          subtitle: ep.subtitle || ""
        };
      });
    }
    function seas(arr) {
      return arr.map(function(s) {
        return {
          title: (s.title || "").replace(/\s+/g, " ").trim(),
          episodes: s.folder ? eps(s.folder) : s.file ? eps([ s ]) : []
        };
      });
    }
    return playlist.map(function(v) {
      return {
        title: (v.title || "").replace(/\s+/g, " ").trim(),
        seasons: v.folder ? seas(v.folder) : v.file ? [ {
          title: "",
          episodes: eps([ v ])
        } ] : []
      };
    });
  }
  function labelVoices(voices, pairs) {
    if (!voices || !voices.length || !pairs || !pairs.length) return voices;
    function norm(s) {
      return ("" + s).toLowerCase().replace(/[^0-9a-zа-яіїєґ]+/gi, "");
    }
    function withType(base, type) {
      return type ? (base ? base + " · " + type : type) : base;
    }
    if (voices.length === 1) {
      var p = pairs[0];
      var cur = (voices[0].title || "").trim();
      var lab = withType(cur || p.studio, p.type);
      if (lab) voices[0].label = lab;
      return voices;
    }
    for (var i = 0; i < voices.length; i++) {
      var cur2 = (voices[i].title || "").trim();
      var vt = norm(cur2);
      if (!vt) continue;
      for (var j = 0; j < pairs.length; j++) {
        var ns = norm(pairs[j].studio);
        if (ns && (ns === vt || ns.indexOf(vt) >= 0 || vt.indexOf(ns) >= 0)) {
          voices[i].label = withType(cur2, pairs[j].type);
          break;
        }
      }
    }
    return voices;
  }
  function dubPairsTypeFirst(str) {
    str = ("" + (str || "")).replace(/\s+/g, " ").trim();
    if (!str) return [];
    var kv = str.split("|");
    var type = (kv[0] || "").trim();
    var pairs = [];
    for (var k = 1; k < kv.length; k++) {
      var studio = kv[k].trim();
      if (studio) pairs.push({
        studio: studio,
        type: type
      });
    }
    if (!pairs.length && type) pairs.push({
      studio: "",
      type: type
    });
    return pairs;
  }
  var QUALITY_TYPE_RULES = [ [ /web-?dl/, "WEB-DL" ], [ /web-?rip/, "WEBRip" ], [ /hd-?rip/, "HDRip" ], [ /bd-?rip/, "BDRip" ], [ /blu-?ray/, "BluRay" ], [ /dvd-?rip/, "DVDRip" ], [ /hd-?tv/, "HDTV" ], [ /cam-?rip/, "CAM" ], [ /(?:^|[^a-z])cam(?:[^a-z]|$)/, "CAM" ], [ /(?:^|[^a-z])ts(?:[^a-z]|$)/, "TS" ], [ /(?:^|[^a-z])hd(?:[^a-z]|$)/, "HD" ] ];
  function qualityType(s) {
    for (var i = 0; i < QUALITY_TYPE_RULES.length; i++) {
      if (QUALITY_TYPE_RULES[i][0].test(s)) return QUALITY_TYPE_RULES[i][1];
    }
    return "";
  }
  function parseStreamQuality(fileUrl, listingHint) {
    var out = {
      resolution: "",
      type: ""
    };
    var u = ("" + (fileUrl || "")).toLowerCase();
    if (/(?:^|[^0-9])2160p?(?:[^0-9]|$)|(?:^|[^a-z0-9])4k(?:[^a-z0-9]|$)/.test(u)) out.resolution = "4K"; else if (/(?:^|[^0-9])1080p?(?:[^0-9]|$)|x1080/.test(u)) out.resolution = "1080p"; else if (/(?:^|[^0-9])720p?(?:[^0-9]|$)|x720/.test(u)) out.resolution = "720p"; else if (/(?:^|[^0-9])480p?(?:[^0-9]|$)|x480/.test(u)) out.resolution = "480p";
    out.type = qualityType(u);
    if (!out.type && listingHint) {
      var h = ("" + listingHint).trim();
      out.type = qualityType(h.toLowerCase()) || h.toUpperCase();
    }
    return out;
  }
  function movieYear(movie) {
    if (!movie) return "";
    if (movie.year) return ("" + movie.year).replace(/\D/g, "").slice(0, 4);
    var d = movie.release_date || movie.first_air_date || movie.last_air_date || "";
    var m = ("" + d).match(/(\d{4})/);
    return m ? m[1] : "";
  }
  function normTitle(s) {
    s = ("" + (s || "")).toLowerCase();
    if (s.normalize) {
      try {
        s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
      } catch (e) {}
    }
    s = s.replace(/[^0-9a-zЀ-ӿ]+/g, " ");
    return s.replace(/\s+/g, " ").trim();
  }
  function titleSimilarity(a, b) {
    var na = normTitle(a), nb = normTitle(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    var ta = na.split(" "), tb = nb.split(" ");
    var aset = {}, bset = {}, i, k;
    for (i = 0; i < ta.length; i++) aset[ta[i]] = true;
    for (i = 0; i < tb.length; i++) bset[tb[i]] = true;
    var inter = 0, uni = 0;
    for (k in aset) if (aset.hasOwnProperty(k)) {
      uni++;
      if (bset[k]) inter++;
    }
    for (k in bset) if (bset.hasOwnProperty(k) && !aset[k]) uni++;
    var jaccard = uni ? inter / uni : 0;
    var contained = false;
    if (inter) {
      var shorter = ta.length <= tb.length ? aset : bset;
      var longer = shorter === aset ? bset : aset;
      contained = true;
      for (k in shorter) if (shorter.hasOwnProperty(k) && !longer[k]) {
        contained = false;
        break;
      }
    }
    return jaccard + (contained ? .15 : 0);
  }
  function rankResults(items, target) {
    target = target || {};
    var list = (items || []).slice();
    var ty = parseInt(("" + (target.year || "")).replace(/\D/g, ""), 10);
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var s1 = target.title ? titleSimilarity(it.title, target.title) : 0;
      var s2 = target.original_title ? titleSimilarity(it.title, target.original_title) : 0;
      // Some sources (uakino) also expose the result's own original/latin title —
      // match it against the TMDB target so a mismatched UA localization doesn't drop the hit.
      var s3 = it.original_title && target.original_title ? titleSimilarity(it.original_title, target.original_title) : 0;
      var s4 = it.original_title && target.title ? titleSimilarity(it.original_title, target.title) : 0;
      var score = Math.max(s1, s2, s3, s4);
      if (ty && it.year) {
        var iy = parseInt(("" + it.year).replace(/\D/g, ""), 10);
        if (iy && Math.abs(iy - ty) <= 1) score += .5;
      }
      it.rank_score = score;
    }
    list.sort(function(a, b) {
      return (b.rank_score || 0) - (a.rank_score || 0);
    });
    return list;
  }
  function filterResults(ranked, target) {
    var MIN = .05, KEEP_TOP = 3;
    var kept = [];
    for (var i = 0; i < ranked.length; i++) {
      if ((ranked[i].rank_score || 0) > MIN) kept.push(ranked[i]);
    }
    if (!kept.length) kept = ranked.slice(0, Math.min(ranked.length, KEEP_TOP));
    return kept;
  }
  function fillMissingYears(list, target) {
    if (!target || !target.year) return;
    var tt = normTitle(target.title), ot = normTitle(target.original_title);
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.year) continue;
      var nt = normTitle(it.title);
      if (nt && (nt === tt || ot && nt === ot)) it.year = ("" + target.year).replace(/\D/g, "").slice(0, 4);
    }
  }
  function firstEpisode(voices) {
    if (!voices) return null;
    for (var v = 0; v < voices.length; v++) {
      var seasons = voices[v] && voices[v].seasons || [];
      for (var s = 0; s < seasons.length; s++) {
        var eps = seasons[s].episodes || [];
        if (eps.length) return eps[0];
      }
    }
    return null;
  }
  function probeResolve(src, item, done) {
    done = done || function() {};
    var handle = {
      req: null,
      done: false,
      cancelled: false
    };
    handle.clear = function() {
      handle.cancelled = true;
      if (handle.req && handle.req.clear) handle.req.clear();
    };
    function finish(result) {
      if (handle.cancelled || handle.done) return;
      handle.done = true;
      done(result);
    }
    function no() {
      return {
        state: "no",
        url: "",
        quality: {
          resolution: "",
          type: ""
        }
      };
    }
    function unknown() {
      return {
        state: "unknown",
        url: "",
        quality: {
          resolution: "",
          type: ""
        }
      };
    }
    function ok(url, file) {
      return {
        state: "ok",
        url: url || "",
        quality: parseStreamQuality(file || url, item && item.quality)
      };
    }
    function fromErr(reason) {
      return reason && reason.geo ? no() : unknown();
    }
    if (!src || typeof src.detail !== "function") {
      finish(unknown());
      return handle;
    }
    handle.req = src.detail(item.url, function(d) {
      if (handle.cancelled) return;
      if (!d) {
        finish(unknown());
        return;
      }
      if (d.is_series) {
        var ep = firstEpisode(d.voices);
        if (ep) {
          if (ep.file) {
            finish(ok("", ep.file));
            return;
          }
          handle.req = src.extract(ep.file || ep.page, function(data) {
            if (handle.cancelled) return;
            if (data && data.url) {
              finish(ok("", data.url));
              return;
            }
            finish(unknown());
          }, function(reason) {
            if (handle.cancelled) return;
            finish(fromErr(reason));
          });
          return;
        }
        if (d.playerUrl) {
          handle.req = src.extract(d.playerUrl, function(data) {
            if (handle.cancelled) return;
            if (data && (data.url || data.voices && data.voices.length)) {
              finish(ok("", data.url || ""));
              return;
            }
            finish(unknown());
          }, function(reason) {
            if (handle.cancelled) return;
            finish(fromErr(reason));
          });
          return;
        }
        finish(unknown());
        return;
      }
      if (!d.playerUrl) {
        finish(unknown());
        return;
      }
      handle.req = src.extract(d.playerUrl, function(data) {
        if (handle.cancelled) return;
        if (data && data.url) {
          finish(ok(data.url, data.url));
          return;
        }
        if (data && data.voices && data.voices.length) {
          var mep = firstEpisode(data.voices);
          finish(ok("", mep && mep.file || ""));
          return;
        }
        finish(unknown());
      }, function(reason) {
        if (handle.cancelled) return;
        finish(fromErr(reason));
      });
    }, function(reason) {
      if (handle.cancelled) return;
      finish(fromErr(reason));
    });
    return handle;
  }
  function availabilitySvg(state) {
    var title, cls, inner;
    if (state === "ok") {
      title = Lampa.Lang.translate("online_ua_available");
      cls = "online-prestige__avail--ok";
      inner = '<circle cx="12" cy="12" r="11" fill="#39b54a"/>' + '<path d="M6.8 12.4l3.3 3.3 7.1-7.4" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
    } else if (state === "no") {
      title = Lampa.Lang.translate("online_ua_unavailable");
      cls = "online-prestige__avail--no";
      inner = '<circle cx="12" cy="12" r="11" fill="#e0483e"/>' + '<path d="M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>';
    } else if (state === "unknown") {
      title = Lampa.Lang.translate("online_ua_unknown");
      cls = "online-prestige__avail--unknown";
      inner = '<circle cx="12" cy="12" r="9" fill="none" stroke="#9aa0a6" stroke-width="2.2"/>';
    } else {
      title = Lampa.Lang.translate("online_ua_checking");
      cls = "online-prestige__avail--check";
      inner = '<circle cx="12" cy="12" r="9" fill="none" stroke="#9aa0a6" stroke-width="2.2"/>';
    }
    return '<span class="online-prestige__badge online-prestige__avail ' + cls + '" title="' + title + '">' + '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' + inner + "</svg></span>";
  }
  function badgeText(v) {
    return ("" + v).replace(/[<>]/g, "");
  }
  function badgesHtml(b) {
    var html = "";
    if (b.availability) html += availabilitySvg(b.availability);
    if (b.resolution) html += '<span class="online-prestige__badge online-prestige__badge--res">' + badgeText(b.resolution) + "</span>";
    if (b.type) html += '<span class="online-prestige__badge online-prestige__badge--type">' + badgeText(b.type) + "</span>";
    return html;
  }
  function setCardBadges(cardEl, result) {
    if (!cardEl || !cardEl.find) return;
    var el = cardEl.find(".online-prestige__badges");
    if (!el.length) return;
    var q = result && result.quality || {};
    el.html(badgesHtml({
      availability: result && result.state || "no",
      resolution: q.resolution || "",
      type: q.type || ""
    }));
  }
  var PROBE_CACHE = {};
  function probeCacheable(result) {
    return !!(result && result.state === "ok");
  }
  SOURCES.uafix = {
    id: "uafix",
    title: "UAFix",
    baseUrl: "https://uafix.net",
    priority: 1,
    headers: function() {
      return {
        Referer: this.baseUrl + "/"
      };
    },
    search: function(query, ok, err) {
      var self = this;
      var url = self.baseUrl + "/index.php?do=search&subaction=search&story=" + encodeURIComponent(query);
      return net(url, {
        dataType: "text",
        headers: self.headers()
      }, function(html) {
        ok(self.parseSearch(html));
      }, err);
    },
    parseSearch: function(html) {
      var self = this;
      var doc = htmlDoc(html);
      var out = [];
      var seen = {};
      function push(href, title, poster) {
        href = absUrl(href, self.baseUrl);
        title = (title || "").replace(/\s+/g, " ").trim();
        if (!href || !title || seen[href]) return;
        seen[href] = true;
        var is_series = href.indexOf("/serials/") >= 0 || href.indexOf("/serial/") >= 0;
        var ym = title.match(/\((\d{4})\)/);
        out.push({
          title: title,
          year: ym ? ym[1] : "",
          url: href,
          poster: poster ? absUrl(poster, self.baseUrl) : "",
          is_series: is_series
        });
      }
      var cards = doc.querySelectorAll(".video-item");
      for (var i = 0; i < cards.length; i++) {
        var a = cards[i].querySelector("a[href]");
        var img = cards[i].querySelector("img");
        var t = cards[i].querySelector(".vi-title");
        push(a ? a.getAttribute("href") : "", t ? t.textContent : img ? img.getAttribute("alt") : "", img ? img.getAttribute("data-src") || img.getAttribute("src") : "");
      }
      if (!out.length) {
        var links = doc.querySelectorAll("a.sres-wrap");
        for (var j = 0; j < links.length; j++) {
          var im = links[j].querySelector(".sres-img img");
          var h2 = links[j].querySelector("h2");
          push(links[j].getAttribute("href"), h2 ? h2.textContent : "", im ? im.getAttribute("data-src") || im.getAttribute("src") : "");
        }
      }
      return out;
    },
    detail: function(url, ok, err) {
      var self = this;
      return net(url, {
        dataType: "text",
        headers: self.headers()
      }, function(html) {
        ok(self.parseDetail(url, html));
      }, err);
    },
    parseDetail: function(url, html) {
      var self = this;
      var doc = htmlDoc(html);
      var ogType = metaContent(doc, "og:type");
      var ogTitle = metaContent(doc, "og:title");
      var poster = absUrl(metaContent(doc, "og:image"), self.baseUrl);
      var h1 = doc.querySelector(".fright h1") || doc.querySelector("h1");
      var title = h1 ? h1.textContent.replace(/\s*дивит[\s\S]*$/i, "").trim() : "";
      if (!title) title = ogTitle.replace(/\s*\([^)]*\).*/, "").trim() || ogTitle;
      var descEl = doc.querySelector("#serial-kratko, .sbox-text, .fdesc, .fdescr, .ftext");
      var description = descEl ? descEl.textContent.trim() : "";
      var epLinks = doc.querySelectorAll('a[href*="season-"][href*="episode-"]');
      var is_series = url.indexOf("/serials/") >= 0 || ogType.indexOf("episode") >= 0 || epLinks.length > 0;
      if (is_series && epLinks.length) {
        return {
          title: title,
          poster: poster,
          description: description,
          is_series: true,
          voices: [ {
            title: "",
            seasons: self.parseSeasons(doc)
          } ]
        };
      }
      return {
        title: title,
        poster: poster,
        description: description,
        is_series: false,
        playerUrl: self.findPlayer(doc)
      };
    },
    findPlayer: function(doc) {
      var og = metaContent(doc, "og:video:iframe");
      if (og) {
        var m = og.match(/src=['"]([^'"]+)['"]/);
        if (m && m[1] && m[1].indexOf("youtu") < 0) return m[1];
      }
      var ifs = doc.querySelectorAll(".video-box iframe, .fplayer iframe, iframe");
      for (var i = 0; i < ifs.length; i++) {
        var src = ifs[i].getAttribute("src") || ifs[i].getAttribute("data-src") || "";
        if (src && src.indexOf("youtu") < 0) return src;
      }
      return "";
    },
    parseSeasons: function(doc) {
      var self = this;
      var byseason = {};
      var order = [];
      var have = {};
      function add(href, name, poster) {
        href = absUrl(href, self.baseUrl);
        var m = href.match(/season-(\d+)-episode-(\d+)/);
        if (!m) return;
        var s = parseInt(m[1], 10), e = parseInt(m[2], 10);
        var key = s + "|" + e;
        if (have[key]) return;
        have[key] = true;
        if (!byseason[s]) {
          byseason[s] = {
            title: "Сезон " + s,
            season: s,
            episodes: []
          };
          order.push(s);
        }
        byseason[s].episodes.push({
          season: s,
          episode: e,
          title: "Серія " + e,
          name: (name || "").replace(/\s+/g, " ").trim(),
          page: href,
          poster: poster ? absUrl(poster, self.baseUrl) : ""
        });
      }
      var cards = doc.querySelectorAll(".video-item");
      for (var i = 0; i < cards.length; i++) {
        var a = cards[i].querySelector('a[href*="season-"][href*="episode-"]');
        if (!a) continue;
        var rate = cards[i].querySelector(".vi-rate");
        var img = cards[i].querySelector("img");
        add(a.getAttribute("href"), rate ? rate.textContent : "", img ? img.getAttribute("data-src") || img.getAttribute("src") : "");
      }
      var links = doc.querySelectorAll('a[href*="season-"][href*="episode-"]');
      for (var j = 0; j < links.length; j++) add(links[j].getAttribute("href"), "", "");
      order.sort(function(x, y) {
        return x - y;
      });
      var seasons = [];
      for (var k = 0; k < order.length; k++) {
        var sn = byseason[order[k]];
        sn.episodes.sort(function(p, q) {
          return p.episode - q.episode;
        });
        seasons.push(sn);
      }
      return seasons;
    },
    extract: function(target, ok, err) {
      var self = this;
      ok = ok || function() {};
      err = err || function() {};
      if (!target) {
        err();
        return;
      }
      if (/\.m3u8(\?|$)/.test(target) || /\.mp4(\?|$)/.test(target)) {
        ok({
          url: target,
          quality: null,
          subtitles: [],
          poster: ""
        });
        return;
      }
      if (target.indexOf("uafix.net") >= 0) {
        return net(target, {
          dataType: "text",
          headers: self.headers()
        }, function(html) {
          var playerUrl = self.findPlayer(htmlDoc(html));
          if (!playerUrl) {
            err({
              geo: true
            });
            return;
          }
          self.extractPlayer(playerUrl, ok, err);
        }, err);
      }
      return self.extractPlayer(target, ok, err);
    },
    extractPlayer: function(playerUrl, ok, err) {
      var self = this;
      return net(playerUrl, {
        dataType: "text",
        headers: self.headers()
      }, function(text) {
        var p = parsePlayerjs(text);
        if (p.playlist) {
          ok({
            voices: self.playlistToVoices(p.playlist),
            poster: p.poster
          });
          return;
        }
        if (!p.file) {
          err(isGeoHost(playerUrl) ? {
            geo: true
          } : undefined);
          return;
        }
        ok({
          url: p.file,
          quality: null,
          subtitles: p.subtitles,
          poster: p.poster
        });
      }, err);
    },
    playlistToVoices: playlistToVoices
  };
  SOURCES.uafilm = {
    id: "uafilm",
    title: "UAFilm",
    baseUrl: "https://klon.fun",
    priority: 2,
    headers: function() {
      return {
        Referer: this.baseUrl + "/"
      };
    },
    search: function(query, ok, err) {
      var self = this;
      var url = self.baseUrl + "/index.php?do=search&subaction=search&story=" + encodeURIComponent(query);
      return net(url, {
        dataType: "text",
        headers: self.headers()
      }, function(html) {
        ok(self.parseSearch(html));
      }, err);
    },
    parseSearch: function(html) {
      var self = this;
      var doc = htmlDoc(html);
      var out = [];
      var seen = {};
      var cards = doc.querySelectorAll(".short-news__small-card");
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var a = card.querySelector("a.short-news__small-card__link") || card.querySelector("a[href]");
        var href = a ? absUrl(a.getAttribute("href"), self.baseUrl) : "";
        if (!href || seen[href]) continue;
        seen[href] = true;
        var img = card.querySelector(".card-poster img.card-poster__img") || card.querySelector("img");
        var tEl = card.querySelector(".card-title__block .card-link__text") || card.querySelector(".card-link__text");
        var title = tEl ? tEl.textContent : "";
        if (!title && img) {
          title = (img.getAttribute("title") || img.getAttribute("alt") || "").replace(/^\s*постер\s+/i, "").replace(/\s*дивит[\s\S]*$/i, "");
        }
        title = (title || "").replace(/\s+/g, " ").trim();
        if (!title) continue;
        var poster = img ? img.getAttribute("data-src") || img.getAttribute("src") || "" : "";
        var sub = card.querySelector(".card-module__subscribe");
        var subText = sub ? sub.textContent.replace(/\s+/g, " ").trim() : "";
        var ym = subText.match(/(\d{4})/);
        out.push({
          title: title,
          year: ym ? ym[1] : "",
          url: href,
          poster: poster ? absUrl(poster, self.baseUrl) : "",
          is_series: self.isSeriesUrl(href) || /^\s*Серіал/i.test(subText)
        });
      }
      return out;
    },
    isSeriesUrl: function(url) {
      url = "" + (url || "");
      return url.indexOf("/serialy/") >= 0 || url.indexOf("/multserialy/") >= 0;
    },
    dubRow: function(doc) {
      var cats = doc.querySelectorAll(".table__category");
      for (var i = 0; i < cats.length; i++) {
        if (/Озвучення/i.test(cats[i].textContent || "")) {
          var par = cats[i].parentNode;
          var v = par ? par.querySelector(".table-text__category") : cats[i].nextElementSibling;
          return v ? v.textContent.replace(/\s+/g, " ").trim() : "";
        }
      }
      return "";
    },
    detail: function(url, ok, err) {
      var self = this;
      ok = ok || function() {};
      err = err || function() {};
      return net(url, {
        dataType: "text",
        headers: self.headers()
      }, function(html) {
        var doc = htmlDoc(html);
        var poster = absUrl(metaContent(doc, "og:image"), self.baseUrl);
        var h1 = doc.querySelector("h1.info-title__title-h1") || doc.querySelector("h1");
        var title = h1 ? h1.textContent.replace(/\s*\(\d{4}\)[\s\S]*$/, "").replace(/\s+/g, " ").trim() : "";
        if (!title) title = metaContent(doc, "og:title").replace(/\s*[—-]\s*дивит[\s\S]*$/i, "").replace(/\s+/g, " ").trim();
        var descEl = doc.querySelector(".full-text.clearfix");
        var description = descEl ? descEl.textContent.replace(/\s+/g, " ").trim() : metaContent(doc, "og:description");
        var playerUrl = self.findPlayer(doc);
        var is_series = self.isSeriesUrl(url) || /\/serial\//.test(playerUrl);
        if (is_series) {
          if (!playerUrl) {
            ok({
              is_series: true,
              voices: [],
              title: title,
              poster: poster,
              description: description
            });
            return;
          }
          var dub = dubPairsTypeFirst(self.dubRow(doc));
          self.extract(playerUrl, function(data) {
            ok({
              is_series: true,
              voices: labelVoices(data && data.voices || [], dub),
              title: title,
              poster: poster,
              description: description
            });
          }, err);
          return;
        }
        ok({
          is_series: false,
          playerUrl: playerUrl,
          title: title,
          poster: poster,
          description: description
        });
      }, err);
    },
    findPlayer: function(doc) {
      var box = doc.querySelector(".film-player iframe") || doc.querySelector('iframe[data-src*="ashdi"], iframe[src*="ashdi"]');
      if (!box) return "";
      return box.getAttribute("data-src") || box.getAttribute("src") || "";
    },
    extract: function(target, ok, err) {
      var self = this;
      ok = ok || function() {};
      err = err || function() {};
      if (!target) {
        err();
        return;
      }
      if (/\.m3u8(\?|$)/.test(target) || /\.mp4(\?|$)/.test(target)) {
        ok({
          url: target,
          quality: null,
          subtitles: [],
          poster: ""
        });
        return;
      }
      return net(target, {
        dataType: "text",
        headers: self.headers()
      }, function(text) {
        var p = parsePlayerjs(text);
        if (p.playlist) {
          var voices = playlistToVoices(p.playlist);
          for (var vi = 0; vi < voices.length; vi++) {
            var seasons = voices[vi].seasons || [];
            for (var si = 0; si < seasons.length; si++) {
              var episodes = seasons[si].episodes || [];
              for (var ei = 0; ei < episodes.length; ei++) {
                episodes[ei].season = si + 1;
                episodes[ei].episode = ei + 1;
              }
            }
          }
          ok({
            voices: voices,
            poster: p.poster
          });
          return;
        }
        if (!p.file) {
          err(isGeoHost(target) ? {
            geo: true
          } : undefined);
          return;
        }
        ok({
          url: p.file,
          quality: null,
          subtitles: p.subtitles,
          poster: p.poster
        });
      }, err);
    }
  };
  SOURCES.uakino = {
    id: "uakino",
    title: "UAKino",
    baseUrl: "https://uakino.com.ua",
    priority: 4,
    headers: function() {
      return {
        Referer: this.baseUrl + "/"
      };
    },
    search: function(query, ok, err) {
      var self = this;
      var url = self.baseUrl + "/index.php?do=search&subaction=search&story=" + encodeURIComponent(query);
      return net(url, {
        dataType: "text",
        headers: self.headers()
      }, function(html) {
        ok(self.parseSearch(html));
      }, err);
    },
    parseSearch: function(html) {
      var self = this;
      var doc = htmlDoc(html);
      var out = [];
      var seen = {};
      var cards = doc.querySelectorAll("a.ua-card");
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var href = absUrl(card.getAttribute("href"), self.baseUrl);
        if (!href || seen[href]) continue;
        var nameEl = card.querySelector(".ua-card-name");
        var raw = nameEl ? nameEl.textContent : "";
        raw = (raw || "").replace(/\s+/g, " ").trim();
        if (!raw) continue;
        seen[href] = true;
        var ym = raw.match(/\((\d{4})\)/);
        var title = raw.replace(/\s*\(\d{4}\)[\s\S]*$/, "").trim() || raw;
        var img = card.querySelector(".ua-poster img") || card.querySelector("img");
        var poster = img ? img.getAttribute("src") || img.getAttribute("data-src") || "" : "";
        var badge = card.querySelector(".ua-badges .ua-badge") || card.querySelector(".ua-badge");
        var is_series = !!(badge && /сезон/i.test(badge.textContent || ""));
        var origEl = card.querySelector(".ua-card-origin");
        var original_title = origEl ? origEl.textContent.replace(/\s+/g, " ").trim() : "";
        out.push({
          title: title,
          original_title: original_title,
          year: ym ? ym[1] : "",
          url: href,
          poster: poster ? absUrl(poster, self.baseUrl) : "",
          is_series: is_series
        });
      }
      return out;
    },
    classifyHost: function(url) {
      var u = "" + (url || "");
      if (/hdvbua/i.test(u)) return "hdvbua";
      if (/ortified/i.test(u)) return "ortified";
      return "other";
    },
    findPlayer: function(doc) {
      var tab = doc.querySelector("#tab-player");
      if (tab) {
        var f = tab.querySelector("iframe");
        if (f) {
          var src = f.getAttribute("src") || f.getAttribute("data-src") || "";
          if (src && !/trailer-imdb/i.test(src)) return src;
        }
      }
      var ifs = doc.querySelectorAll(".ua-player iframe, iframe");
      for (var i = 0; i < ifs.length; i++) {
        var s = ifs[i].getAttribute("src") || ifs[i].getAttribute("data-src") || "";
        if (s && !/trailer-imdb/i.test(s) && (/hdvbua/i.test(s) || /ortified/i.test(s))) return s;
      }
      return "";
    },
    isSeries: function(doc, ogTitle) {
      if (/^\s*Серіал\s/i.test(ogTitle || "")) return true;
      return this.isSeriesByBreadcrumb(doc);
    },
    isSeriesByBreadcrumb: function(doc) {
      var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length; i++) {
        var data;
        try {
          data = JSON.parse(scripts[i].textContent);
        } catch (e) {
          continue;
        }
        var list = this.breadcrumbList(data);
        if (!list) continue;
        for (var j = 0; j < list.length; j++) {
          var el = list[j];
          if (!el) continue;
          if (el.position === 2 || el.position === "2") {
            var id = el.item && (el.item["@id"] || el.item.id) || "";
            if (/\/(seriali|multseriali)\//.test("" + id)) return true;
          }
        }
      }
      return false;
    },
    breadcrumbList: function(data) {
      if (!data) return null;
      if (data["@type"] === "BreadcrumbList" && data.itemListElement) return data.itemListElement;
      var graph = data["@graph"];
      if (graph && graph.length) {
        for (var g = 0; g < graph.length; g++) {
          if (graph[g] && graph[g]["@type"] === "BreadcrumbList" && graph[g].itemListElement) {
            return graph[g].itemListElement;
          }
        }
      }
      return null;
    },
    detail: function(url, ok, err) {
      var self = this;
      ok = ok || function() {};
      err = err || function() {};
      return net(url, {
        dataType: "text",
        headers: self.headers()
      }, function(html) {
        var doc = htmlDoc(html);
        var ogTitle = metaContent(doc, "og:title");
        var poster = absUrl(metaContent(doc, "og:image"), self.baseUrl);
        if (!poster) {
          var pimg = doc.querySelector(".ua-full-poster img");
          if (pimg) poster = absUrl(pimg.getAttribute("src") || pimg.getAttribute("data-src") || "", self.baseUrl);
        }
        var h1 = doc.querySelector("h1.ua-full-title") || doc.querySelector("h1");
        var title = h1 ? h1.textContent.replace(/\s*\(\d{4}\)[\s\S]*$/, "").replace(/\s+/g, " ").trim() : "";
        if (!title) title = ogTitle.replace(/^\s*Серіал\s+/i, "").replace(/\s*\(\d{4}\)[\s\S]*$/, "").replace(/\s+/g, " ").trim();
        var descEl = doc.querySelector(".ua-description");
        var description = descEl ? descEl.textContent.replace(/\s+/g, " ").trim() : metaContent(doc, "og:description");
        var playerUrl = self.findPlayer(doc);
        var playerHost = self.classifyHost(playerUrl);
        var is_series = self.isSeries(doc, ogTitle);
        if (is_series) {
          var base = {
            is_series: true,
            voices: [],
            playerUrl: playerUrl,
            playerHost: playerHost,
            title: title,
            poster: poster,
            description: description
          };
          if (!playerUrl) {
            ok(base);
            return;
          }
          self.extract(playerUrl, function(data) {
            base.voices = data && data.voices || [];
            ok(base);
          }, function() {
            ok(base);
          });
          return;
        }
        ok({
          is_series: false,
          playerUrl: playerUrl,
          playerHost: playerHost,
          title: title,
          poster: poster,
          description: description
        });
      }, err);
    },
    extract: function(target, ok, err) {
      var self = this;
      ok = ok || function() {};
      err = err || function() {};
      if (!target) {
        err();
        return;
      }
      if (/\.m3u8(\?|$)/.test(target) || /\.mp4(\?|$)/.test(target)) {
        ok({
          url: target,
          quality: null,
          subtitles: [],
          poster: ""
        });
        return;
      }
      return net(target, {
        dataType: "text",
        headers: self.headers()
      }, function(text) {
        if (/недоступ|вашего региона|вашого регіону|регіон недоступ/i.test(text)) {
          err({
            geo: true
          });
          return;
        }
        var p = parsePlayerjs(text);
        if (p.playlist) {
          var voices = playlistToVoices(p.playlist);
          for (var vi = 0; vi < voices.length; vi++) {
            var seasons = voices[vi].seasons || [];
            for (var si = 0; si < seasons.length; si++) {
              var episodes = seasons[si].episodes || [];
              for (var ei = 0; ei < episodes.length; ei++) {
                episodes[ei].season = si + 1;
                episodes[ei].episode = ei + 1;
              }
            }
          }
          ok({
            voices: voices,
            poster: p.poster
          });
          return;
        }
        if (!p.file) {
          err({
            geo: true
          });
          return;
        }
        ok({
          url: p.file,
          quality: null,
          subtitles: p.subtitles,
          poster: p.poster
        });
      }, err);
    },
    playlistToVoices: playlistToVoices
  };
  SOURCES.kinoukr = {
    id: "kinoukr",
    title: "KinoUkr",
    baseUrl: "https://kinoukr.tv",
    priority: 3,
    hidden: true,
    headers: function() {
      return {
        Referer: this.baseUrl + "/"
      };
    },
    search: function(query, ok, err) {
      var self = this;
      ok = ok || function() {};
      err = err || function() {};
      var handle = {
        req: null,
        clear: function() {
          if (handle.req && handle.req.clear) handle.req.clear();
        }
      };
      handle.req = net(self.baseUrl + "/home/", {
        dataType: "text",
        headers: self.headers()
      }, function(home) {
        if (self.isCloudflareChallenge(home)) {
          err({
            cf: true
          });
          return;
        }
        var m = ("" + home).match(/dle_login_hash\s*=\s*['"]([a-f0-9]{32,40})['"]/i);
        if (!m) {
          err({
            cf: true
          });
          return;
        }
        var body = "story=" + encodeURIComponent(query) + "&dle_hash=" + m[1] + "&thisUrl=" + encodeURIComponent("/home/");
        handle.req = net(self.baseUrl + "/engine/lazydev/dle_search/ajax.php", {
          dataType: "text",
          post: body,
          headers: {
            Referer: self.baseUrl + "/home/",
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded"
          }
        }, function(text) {
          if (self.isCloudflareChallenge(text)) {
            err({
              cf: true
            });
            return;
          }
          var content = "";
          try {
            content = (JSON.parse(text) || {}).content || "";
          } catch (e) {
            content = "";
          }
          if (!content) {
            err({
              cf: true
            });
            return;
          }
          ok(self.parseSearch(content));
        }, function() {
          err({
            cf: true
          });
        });
      }, function() {
        err({
          cf: true
        });
      });
      return handle;
    },
    isCloudflareChallenge: function(html) {
      var s = "" + (html || "");
      return /just a moment/i.test(s) || /cf-challenge|cf_chl|challenge-platform/i.test(s) || /enable javascript and cookies/i.test(s);
    },
    parseSearch: function(content) {
      var self = this;
      var doc = htmlDoc(content);
      var out = [];
      var seen = {};
      var links = doc.querySelectorAll("a[href]");
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        var href = absUrl(a.getAttribute("href"), self.baseUrl);
        if (!href || seen[href] || href.indexOf(".html") < 0) continue;
        var head = a.querySelector(".searchheading");
        var raw = ("" + (head ? head.textContent : "")).replace(/\s+/g, " ").trim();
        if (!raw) continue;
        seen[href] = true;
        var ym = raw.match(/\((\d{4})\)\s*$/);
        var img = a.querySelector("img");
        var poster = img ? img.getAttribute("data-src") || img.getAttribute("src") || "" : "";
        out.push({
          title: raw.replace(/\s*\(\d{4}\)\s*$/, "").trim(),
          year: ym ? ym[1] : "",
          url: href,
          poster: poster ? absUrl(poster, self.baseUrl) : "",
          is_series: false
        });
      }
      return out;
    },
    detail: function(url, ok, err) {
      var self = this;
      ok = ok || function() {};
      err = err || function() {};
      return net(url, {
        dataType: "text",
        headers: self.headers()
      }, function(html) {
        var doc = htmlDoc(html);
        var ogTitle = metaContent(doc, "og:title");
        var poster = absUrl(metaContent(doc, "og:image"), self.baseUrl);
        var h1 = doc.querySelector('h1[itemprop="name"]') || doc.querySelector("h1");
        var title = h1 ? h1.textContent.replace(/\s+/g, " ").trim() : "";
        if (!title) {
          title = ogTitle.replace(/^\s*(?:Фільм|Серіал)\s+/i, "").replace(/\s+\d{4}[\s\S]*$/, "").replace(/\s+/g, " ").trim();
        }
        var year = self.parseYear(doc, ogTitle);
        var descEl = doc.querySelector(".fdesc");
        var description = descEl ? descEl.textContent.replace(/\s+/g, " ").trim() : metaContent(doc, "og:description");
        var playerUrl = self.findPlayer(doc);
        var is_series = /ashdi\.vip\/serial\//.test(playerUrl) || /^\s*Серіал/i.test(ogTitle);
        if (is_series) {
          if (!playerUrl) {
            ok({
              is_series: true,
              voices: [],
              title: title,
              year: year,
              poster: poster,
              description: description
            });
            return;
          }
          var zvuk = self.parseZvuk(doc);
          self.extract(playerUrl, function(data) {
            ok({
              is_series: true,
              voices: self.applyVoiceLabels(data && data.voices || [], zvuk),
              title: title,
              year: year,
              poster: poster,
              description: description
            });
          }, err);
          return;
        }
        ok({
          is_series: false,
          playerUrl: playerUrl,
          title: title,
          year: year,
          poster: poster,
          description: description
        });
      }, err);
    },
    parseYear: function(doc, ogTitle) {
      var lines = doc.querySelectorAll(".finfo .sd-line, .sd-line");
      for (var i = 0; i < lines.length; i++) {
        var span = lines[i].querySelector("span");
        if (span && /Рік/i.test(span.textContent)) {
          var m = (lines[i].textContent || "").match(/\b(?:19|20)\d{2}\b/);
          if (m) return m[0];
        }
      }
      var m2 = ("" + (ogTitle || "")).match(/\b(?:19|20)\d{2}\b/);
      return m2 ? m2[0] : "";
    },
    parseZvuk: function(doc) {
      var lines = doc.querySelectorAll(".finfo .sd-line, .sd-line");
      for (var i = 0; i < lines.length; i++) {
        var span = lines[i].querySelector("span");
        if (span && /Звук/i.test(span.textContent)) {
          return (lines[i].textContent || "").replace(/\s+/g, " ").replace(/^\s*Звук\s*:?\s*/i, "").trim();
        }
      }
      return "";
    },
    applyVoiceLabels: function(voices, zvuk) {
      if (!voices || !voices.length || !zvuk) return voices;
      // Звук has two multi-voice shapes: per-pair "Studio | Type, Studio | Type"
      // (pipes === commas+1) and shared-type "Studio1, Studio2 | Type" (one type
      // after the last pipe). Normalise both to [{studio, type}] pairs.
      var pipes = (zvuk.match(/\|/g) || []).length;
      var commas = (zvuk.match(/,/g) || []).length;
      var pairs = [];
      if (pipes === commas + 1) {
        zvuk.split(",").forEach(function(seg) {
          var kv = seg.split("|");
          var studio = (kv[0] || "").replace(/\s+/g, " ").trim();
          if (studio) pairs.push({
            studio: studio,
            type: (kv[1] || "").replace(/\s+/g, " ").trim()
          });
        });
      } else {
        var pi = zvuk.lastIndexOf("|");
        var type = pi >= 0 ? zvuk.slice(pi + 1).replace(/\s+/g, " ").trim() : "";
        (pi >= 0 ? zvuk.slice(0, pi) : zvuk).split(",").forEach(function(s) {
          var studio = s.replace(/\s+/g, " ").trim();
          if (studio) pairs.push({
            studio: studio,
            type: type
          });
        });
      }
      return labelVoices(voices, pairs);
    },
    findPlayer: function(doc) {
      var box = doc.querySelector('iframe[data-src*="ashdi.vip"], iframe[src*="ashdi.vip"]');
      if (box) return box.getAttribute("data-src") || box.getAttribute("src") || "";
      var ifs = doc.querySelectorAll(".fplayer iframe, .video-box iframe, iframe");
      for (var i = 0; i < ifs.length; i++) {
        var src = ifs[i].getAttribute("data-src") || ifs[i].getAttribute("src") || "";
        if (src && src.indexOf("ashdi") >= 0) return src;
      }
      return "";
    },
    extract: function(target, ok, err) {
      var self = this;
      ok = ok || function() {};
      err = err || function() {};
      if (!target) {
        err();
        return;
      }
      if (/\.m3u8(\?|$)/.test(target) || /\.mp4(\?|$)/.test(target)) {
        ok({
          url: target,
          quality: null,
          subtitles: [],
          poster: ""
        });
        return;
      }
      return net(target, {
        dataType: "text",
        headers: self.headers()
      }, function(text) {
        var p = parsePlayerjs(text);
        if (p.playlist) {
          var voices = playlistToVoices(p.playlist);
          for (var vi = 0; vi < voices.length; vi++) {
            var seasons = voices[vi].seasons || [];
            for (var si = 0; si < seasons.length; si++) {
              var episodes = seasons[si].episodes || [];
              for (var ei = 0; ei < episodes.length; ei++) {
                episodes[ei].season = si + 1;
                episodes[ei].episode = ei + 1;
              }
            }
          }
          ok({
            voices: voices,
            poster: p.poster
          });
          return;
        }
        if (!p.file) {
          err({
            geo: true
          });
          return;
        }
        ok({
          url: p.file,
          quality: null,
          subtitles: p.subtitles,
          poster: p.poster
        });
      }, err);
    }
  };
  SOURCES.uaserials = {
    id: "uaserials",
    title: "UASerials",
    baseUrl: "https://uaserials.fm",
    priority: 5,
    requiresDirect: true,
    headers: function() {
      return {
        Referer: this.baseUrl + "/"
      };
    },
    search: function(query, ok, err) {
      var self = this;
      var url = self.baseUrl + "/index.php?do=search&subaction=search&story=" + encodeURIComponent(query);
      return net(url, {
        dataType: "text",
        headers: self.headers()
      }, function(html) {
        ok(self.parseSearch(html));
      }, err);
    },
    parseSearch: function(html) {
      var self = this;
      var doc = htmlDoc(html);
      var out = [];
      var seen = {};
      var cards = doc.querySelectorAll(".short-item");
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var a = card.querySelector("a.short-img") || card.querySelector("a[href]");
        var href = a ? absUrl(a.getAttribute("href"), self.baseUrl) : "";
        if (!href || seen[href]) continue;
        var tEl = card.querySelector(".th-title");
        var title = tEl ? tEl.textContent.replace(/\s+/g, " ").trim() : "";
        if (!title) {
          var img0 = card.querySelector("img");
          title = img0 ? (img0.getAttribute("alt") || "").replace(/\s+/g, " ").trim() : "";
        }
        if (!title) continue;
        seen[href] = true;
        var img = card.querySelector(".short-img img") || card.querySelector("img");
        var poster = img ? img.getAttribute("data-src") || img.getAttribute("src") || "" : "";
        var lv1 = card.querySelector(".short-label-level-1 span") || card.querySelector(".short-label-level-1");
        var lv2 = card.querySelector(".short-label-level-2 span") || card.querySelector(".short-label-level-2");
        var label = [ lv1 ? lv1.textContent : "", lv2 ? lv2.textContent : "" ].join(" ").replace(/\s+/g, " ").trim();
        out.push({
          title: title,
          year: "",
          url: href,
          poster: poster ? absUrl(poster, self.baseUrl) : "",
          label: label,
          is_series: self.isSeriesUrl(href)
        });
      }
      return out;
    },
    isSeriesUrl: function(url) {
      url = "" + (url || "");
      return url.indexOf("/series/") >= 0 || url.indexOf("/cartoons/") >= 0 || url.indexOf("/anime/") >= 0;
    },
    findPlayer: function(doc) {
      var box = doc.querySelector('iframe[src*="ashdi.vip"], iframe[data-src*="ashdi.vip"]');
      if (box) return box.getAttribute("src") || box.getAttribute("data-src") || "";
      var ifs = doc.querySelectorAll("iframe");
      for (var i = 0; i < ifs.length; i++) {
        var s = ifs[i].getAttribute("src") || ifs[i].getAttribute("data-src") || "";
        if (s && !/youtu/i.test(s)) return s;
      }
      return "";
    },
    parseYear: function(doc, titleText) {
      var lis = doc.querySelectorAll(".short-list li");
      for (var i = 0; i < lis.length; i++) {
        var sp = lis[i].querySelector("span");
        if (sp && /Рік/i.test(sp.textContent || "")) {
          var m = (lis[i].textContent || "").match(/(\d{4})/);
          if (m) return m[1];
        }
      }
      var tm = ("" + (titleText || "")).match(/\((\d{4})\)/);
      return tm ? tm[1] : "";
    },
    dubRow: function(doc) {
      var lis = doc.querySelectorAll(".short-list li");
      for (var i = 0; i < lis.length; i++) {
        var sp = lis[i].querySelector("span");
        if (sp && /Переклад/i.test(sp.textContent || "")) {
          var v = lis[i].querySelector("span[data-popup-title]") || lis[i].querySelectorAll("span")[1];
          return v ? v.textContent.replace(/\s+/g, " ").trim() : "";
        }
      }
      return "";
    },
    detail: function(url, ok, err) {
      var self = this;
      ok = ok || function() {};
      err = err || function() {};
      return net(url, {
        dataType: "text",
        headers: self.headers()
      }, function(html) {
        var doc = htmlDoc(html);
        var ogTitle = metaContent(doc, "og:title");
        var poster = absUrl(metaContent(doc, "og:image"), self.baseUrl);
        var nameEl = doc.querySelector("h1.short-title .oname_ua") || doc.querySelector("h1.short-title") || doc.querySelector("h1");
        var title = nameEl ? nameEl.textContent.replace(/\s+/g, " ").trim() : "";
        if (!title) {
          var ogm = ogTitle.match(/[«"]([^»"]+)[»"]/);
          title = ogm ? ogm[1].replace(/\s+/g, " ").trim() : ogTitle.replace(/\s+/g, " ").trim();
        }
        var descEl = doc.querySelector(".ftext.full-text");
        var description = descEl ? descEl.textContent.replace(/\s+/g, " ").trim() : metaContent(doc, "og:description");
        var year = self.parseYear(doc, ogTitle);
        var playerUrl = self.findPlayer(doc);
        var is_series = self.isSeriesUrl(url) || /\/serial\//.test(playerUrl);
        if (is_series) {
          var base = {
            is_series: true,
            voices: [],
            title: title,
            year: year,
            poster: poster,
            description: description
          };
          if (!playerUrl) {
            ok(base);
            return;
          }
          var dub = dubPairsTypeFirst(self.dubRow(doc));
          self.extract(playerUrl, function(data) {
            base.voices = labelVoices(data && data.voices || [], dub);
            ok(base);
          }, err);
          return;
        }
        ok({
          is_series: false,
          playerUrl: playerUrl,
          title: title,
          year: year,
          poster: poster,
          description: description
        });
      }, err);
    },
    extract: function(target, ok, err) {
      var self = this;
      ok = ok || function() {};
      err = err || function() {};
      if (!target) {
        err();
        return;
      }
      if (/\.m3u8(\?|$)/.test(target) || /\.mp4(\?|$)/.test(target)) {
        ok({
          url: target,
          quality: null,
          subtitles: [],
          poster: ""
        });
        return;
      }
      return net(target, {
        dataType: "text",
        headers: self.headers()
      }, function(text) {
        var p = parsePlayerjs(text);
        if (p.playlist) {
          var voices = playlistToVoices(p.playlist);
          for (var vi = 0; vi < voices.length; vi++) {
            var seasons = voices[vi].seasons || [];
            for (var si = 0; si < seasons.length; si++) {
              var episodes = seasons[si].episodes || [];
              for (var ei = 0; ei < episodes.length; ei++) {
                episodes[ei].season = si + 1;
                episodes[ei].episode = ei + 1;
              }
            }
          }
          ok({
            voices: voices,
            poster: p.poster
          });
          return;
        }
        if (!p.file) {
          err(isGeoHost(target) ? {
            geo: true
          } : undefined);
          return;
        }
        ok({
          url: p.file,
          quality: null,
          subtitles: p.subtitles,
          poster: p.poster
        });
      }, err);
    }
  };
  SOURCES.bamboo = {
    id: "bamboo",
    title: "BambooUA",
    baseUrl: "https://bambooua.com",
    priority: 6,
    headers: function() {
      return {
        Referer: this.baseUrl + "/"
      };
    },
    search: function(query, ok, err) {
      var self = this;
      var url = self.baseUrl + "/index.php?do=search&subaction=search&story=" + encodeURIComponent(query);
      return net(url, {
        dataType: "text",
        headers: self.headers()
      }, function(html) {
        ok(self.parseSearch(html));
      }, err);
    },
    parseSearch: function(html) {
      var self = this;
      var doc = htmlDoc(html);
      var out = [];
      var seen = {};
      var cards = doc.querySelectorAll(".cat-item");
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var a = card.querySelector("a.link-title") || card.querySelector("a[href]");
        var href = a ? absUrl(a.getAttribute("href"), self.baseUrl) : "";
        if (!href || href.indexOf(".html") < 0 || seen[href]) continue;
        var tEl = card.querySelector(".info .title h2") || card.querySelector("h2");
        var title = tEl ? tEl.textContent.replace(/\s+/g, " ").trim() : "";
        if (!title) {
          var alt = card.querySelector("img[alt]");
          title = alt ? (alt.getAttribute("alt") || "").replace(/\s+/g, " ").trim() : "";
        }
        if (!title) continue;
        seen[href] = true;
        var img = card.querySelector(".poster img") || card.querySelector("img");
        var poster = img ? img.getAttribute("data-src") || img.getAttribute("src") || "" : "";
        out.push({
          title: title,
          year: "",
          url: href,
          poster: poster ? absUrl(poster, self.baseUrl) : "",
          is_series: !/\/(cinema|films?|movie)\//i.test(href)
        });
      }
      return out;
    },
    parsePlaylist: function(html) {
      var m = ("" + html).match(/playlist\s*=\s*(\[[\s\S]*?\])\s*;/);
      if (!m) return null;
      try {
        return JSON.parse(m[1]);
      } catch (e) {
        return null;
      }
    },
    seasonNum: function(pl, html) {
      var s = JSON.stringify(pl).match(/\/s(\d+)\//);
      if (s) return parseInt(s[1], 10);
      var t = ("" + html).match(/([0-9]{1,2})\s*Сезон/i);
      return t ? parseInt(t[1], 10) : 1;
    },
    toVoices: function(pl, season) {
      var norm = pl.map(function(v) {
        if (v.folder && v.folder.length && v.folder[0] && v.folder[0].file != null && v.folder[0].folder == null) {
          return {
            title: v.title || "",
            folder: [ {
              title: "Сезон " + season,
              folder: v.folder
            } ]
          };
        }
        return v;
      });
      var voices = playlistToVoices(norm);
      for (var vi = 0; vi < voices.length; vi++) {
        var seasons = voices[vi].seasons || [];
        for (var si = 0; si < seasons.length; si++) {
          var eps = seasons[si].episodes || [];
          for (var ei = 0; ei < eps.length; ei++) {
            eps[ei].season = season || si + 1;
            eps[ei].episode = ei + 1;
          }
        }
      }
      return voices;
    },
    parseMeta: function(doc) {
      var ogTitle = metaContent(doc, "og:title");
      var poster = absUrl(metaContent(doc, "og:image"), this.baseUrl);
      var h1 = doc.querySelector("h1");
      var title = h1 ? h1.textContent.replace(/\s+/g, " ").trim() : "";
      if (!title) title = ogTitle.split("|")[0].replace(/\s*\(\d{4}\)[\s\S]*$/, "").replace(/\s+/g, " ").trim();
      var ym = ogTitle.match(/\((\d{4})\)/);
      return {
        title: title,
        poster: poster,
        year: ym ? ym[1] : ""
      };
    },
    detail: function(url, ok, err) {
      var self = this;
      ok = ok || function() {};
      err = err || function() {};
      return net(url, {
        dataType: "text",
        headers: self.headers()
      }, function(html) {
        var doc = htmlDoc(html);
        var meta = self.parseMeta(doc);
        var pl = self.parsePlaylist(html);
        var is_series = !!(pl && pl.some(function(v) {
          return v.folder;
        }));
        if (is_series) {
          ok({
            is_series: true,
            voices: self.toVoices(pl, self.seasonNum(pl, html)),
            title: meta.title,
            year: meta.year,
            poster: meta.poster
          });
          return;
        }
        ok({
          is_series: false,
          playerUrl: url,
          title: meta.title,
          year: meta.year,
          poster: meta.poster
        });
      }, err);
    },
    extract: function(target, ok, err) {
      var self = this;
      ok = ok || function() {};
      err = err || function() {};
      if (!target) {
        err();
        return;
      }
      if (/\.m3u8(\?|$)/.test(target) || /\.mp4(\?|$)/.test(target)) {
        ok({
          url: target,
          quality: null,
          subtitles: [],
          poster: ""
        });
        return;
      }
      return net(target, {
        dataType: "text",
        headers: self.headers()
      }, function(html) {
        var pl = self.parsePlaylist(html);
        if (!pl || !pl.length) {
          err();
          return;
        }
        if (pl.some(function(v) {
          return v.folder;
        })) {
          ok({
            voices: self.toVoices(pl, self.seasonNum(pl, html))
          });
          return;
        }
        var voices = self.toVoices(pl, 1);
        if (voices.length === 1) {
          var ep = firstEpisode(voices);
          if (ep && ep.file) {
            ok({
              url: ep.file,
              quality: null,
              subtitles: [],
              poster: ""
            });
            return;
          }
        }
        ok({
          voices: voices
        });
      }, err);
    }
  };
  function component(object) {
    var network = new Lampa.Reguest;
    var scroll = new Lampa.Scroll({
      mask: true,
      over: true
    });
    var files = new Lampa.Explorer(object);
    var filter = new Lampa.Filter(object);
    var last;
    var last_request;
    var find_requests = [];
    var PROBE_MAX = 2;
    var probe_queue = [];
    var probe_inflight = {};
    var probe_inflight_n = 0;
    var probe_cards = {};
    var source_keys = enabledSourceKeys();
    var active_source = Lampa.Storage.get(CONFIG.STORAGE.source, "") + "";
    if (source_keys.indexOf(active_source) === -1) {
      active_source = source_keys.length ? source_keys[0] : "";
    }
    var comp = this;
    var mode = "search";
    var results_items = null;
    var series_item = null;
    var series_detail = null;
    var series_voices = null;
    var voice_index = 0;
    var season_index = 0;
    function movieHash(item) {
      var movie = object.movie || {};
      var base = movie.original_title || movie.title || item && item.title || "";
      return Lampa.Utils.hash([ active_source, item ? item.url : "", base ].join("#"));
    }
    function episodeHash(ep, season, voice) {
      var movie = object.movie || {};
      var base = movie.original_title || movie.title || series_detail && series_detail.title || series_item && series_item.title || "";
      return Lampa.Utils.hash([ active_source, series_item ? series_item.url : "", season ? season.title : "", ep.season, ep.episode, voice ? voice.title : "", base ].join("#"));
    }
    function episodeTitle(ep, season) {
      return (season && season.title ? season.title + " " : "") + ep.title + (ep.name ? " — " + ep.name : "");
    }
    function playError(reason) {
      return Lampa.Lang.translate(reason && reason.geo ? "online_ua_geo" : "online_ua_no_video");
    }
    function makeCard(opts) {
      var card = Lampa.Template.get("online_ua_item", {
        title: opts.title || "",
        time: opts.time || "",
        info: opts.info || "",
        quality: opts.quality || ""
      });
      var image = card.find(".online-prestige__img");
      var loader = card.find(".online-prestige__loader");
      var img = image.find("img")[0];
      if (opts.poster && img) {
        var tried_fb = false;
        img.onerror = function() {
          if (opts.posterFallback && !tried_fb && opts.posterFallback !== opts.poster) {
            tried_fb = true;
            img.src = opts.posterFallback;
            return;
          }
          img.onerror = null;
          img.src = "./img/img_broken.svg";
          if (loader.length) loader.remove();
        };
        img.onload = function() {
          image.addClass("online-prestige__img--loaded");
          if (loader.length) loader.remove();
        };
        img.src = opts.poster;
      } else if (loader.length) {
        loader.remove();
      }
      if (opts.hash) {
        var view = Lampa.Timeline.view(opts.hash);
        card.find(".online-prestige__timeline").append(Lampa.Timeline.render(view));
        if (Lampa.Timeline.details) card.find(".online-prestige__quality").append(Lampa.Timeline.details(view, " / "));
        if (view.percent >= 90) image.append('<div class="online-prestige__viewed"><svg width="21" height="21" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">' + '<circle cx="10.5" cy="10.5" r="9" stroke="currentColor" stroke-width="2"/>' + '<path d="M6 11l3 3 6-6" stroke="currentColor" stroke-width="2" fill="none"/></svg></div>');
      }
      var badges = card.find(".online-prestige__badges");
      if (badges.length) badges.html(badgesHtml({
        availability: opts.availability || "",
        resolution: opts.resolution || "",
        type: opts.type || ""
      }));
      return card;
    }
    function probeEnabled() {
      return Lampa.Storage.get(CONFIG.STORAGE.probe, true) !== false;
    }
    function probeKey(item) {
      return active_source + "|" + (item ? item.url : "");
    }
    this.enqueueProbe = function(item, card) {
      if (!probeEnabled()) return;
      if (!this.source()) return;
      var key = probeKey(item);
      probe_cards[key] = card;
      if (PROBE_CACHE[key]) {
        setCardBadges(card, PROBE_CACHE[key]);
        return;
      }
      if (probe_inflight[key]) return;
      for (var i = 0; i < probe_queue.length; i++) if (probe_queue[i].key === key) return;
      probe_queue.push({
        key: key,
        item: item
      });
      this.probeDrain();
    };
    this.probeFocus = function(item) {
      if (!probeEnabled()) return;
      var key = probeKey(item);
      if (PROBE_CACHE[key] || probe_inflight[key]) return;
      for (var i = 0; i < probe_queue.length; i++) {
        if (probe_queue[i].key === key) {
          probe_queue.unshift(probe_queue.splice(i, 1)[0]);
          break;
        }
      }
      this.probeDrain();
    };
    this.probeDrain = function() {
      var _this = this;
      var src = this.source();
      if (!src) return;
      while (probe_inflight_n < PROBE_MAX && probe_queue.length) {
        var job = probe_queue.shift();
        var key = job.key;
        if (PROBE_CACHE[key] || probe_inflight[key]) continue;
        probe_inflight[key] = true;
        probe_inflight_n++;
        (function(key, item) {
          var handle = probeResolve(src, item, function(result) {
            if (!probe_inflight[key]) return;
            delete probe_inflight[key];
            probe_inflight_n--;
            if (probeCacheable(result)) PROBE_CACHE[key] = result;
            var card = probe_cards[key];
            if (card) setCardBadges(card, result);
            _this.probeDrain();
          });
          if (probe_inflight[key]) probe_inflight[key] = handle;
        })(key, job.item);
      }
    };
    this.probeReset = function() {
      for (var k in probe_inflight) {
        if (probe_inflight.hasOwnProperty(k)) {
          var h = probe_inflight[k];
          if (h && h.clear) h.clear();
        }
      }
      probe_inflight = {};
      probe_inflight_n = 0;
      probe_queue = [];
      probe_cards = {};
    };
    scroll.body().addClass("torrent-list");
    scroll.minus(files.render().find(".explorer__files-head"));
    this.create = function() {
      var _this = this;
      this.activity.loader(true);
      filter.onSearch = function(value) {
        Lampa.Activity.replace({
          search: value,
          clarification: true
        });
      };
      filter.onBack = function() {
        _this.start();
      };
      filter.onSelect = function(type, a, b) {
        if (type == "sort") {
          _this.changeSource(a.source);
        } else if (type == "filter") {
          if (a.reset) {
            if (mode === "series") _this.backToResults(); else _this.search();
          } else if (a.stype == "enabled") {
            _this.toggleSource(b.index);
          } else if (a.stype == "season") {
            _this.selectSeason(b.index);
          } else if (a.stype == "voice") {
            _this.selectVoice(b.index);
          }
        }
      };
      filter.render().find(".filter--sort span").text(Lampa.Lang.translate("online_ua_source"));
      files.appendHead(filter.render());
      files.appendFiles(scroll.render());
      this.search();
      return this.render();
    };
    this.changeSource = function(id) {
      if (!id) return;
      active_source = id;
      Lampa.Storage.set(CONFIG.STORAGE.source, id);
      mode = "search";
      this.search();
      setTimeout(this.closeFilter, 10);
    };
    this.toggleSource = function(idx) {
      var all = allSourceKeys();
      var id = all[idx];
      if (!id) return;
      Lampa.Storage.set(CONFIG.STORAGE.enabled_prefix + id, !sourceEnabled(id));
      source_keys = enabledSourceKeys();
      if (source_keys.indexOf(active_source) === -1) {
        active_source = source_keys.length ? source_keys[0] : "";
        Lampa.Storage.set(CONFIG.STORAGE.source, active_source);
      }
      this.search();
      setTimeout(this.closeFilter, 10);
    };
    this.search = function() {
      mode = "search";
      this.activity.loader(true);
      this.buildFilter();
      this.reset();
      this.find();
    };
    this.find = function() {
      if (!source_keys.length) {
        this.empty(Lampa.Lang.translate("online_ua_no_sources"));
        return;
      }
      var src = SOURCES[active_source];
      if (!src || typeof src.search !== "function") {
        this.empty(Lampa.Lang.translate("online_ua_no_sources"));
        return;
      }
      var movie = object.movie || {};
      var manual = !!object.clarification;
      var target = manual ? {
        title: ("" + (object.search || "")).trim(),
        original_title: "",
        year: ""
      } : {
        title: ("" + (movie.title || movie.name || "")).trim(),
        original_title: ("" + (movie.original_title || movie.original_name || "")).trim(),
        year: movieYear(movie)
      };
      var queries = [];
      function addQuery(q) {
        q = ("" + (q || "")).trim();
        if (!q) return;
        for (var i = 0; i < queries.length; i++) {
          if (normTitle(queries[i]) === normTitle(q)) return;
        }
        queries.push(q);
      }
      if (manual) {
        addQuery(object.search);
      } else {
        addQuery(object.search || target.title);
        addQuery(target.original_title);
      }
      if (!queries.length) {
        this.empty(Lampa.Lang.translate("online_ua_no_results"));
        return;
      }
      var _this = this;
      var merged = [];
      var seen = {};
      var pending = queries.length;
      var errors = 0;
      var cf_blocked = false;
      function collect(items) {
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (!it || !it.url || seen[it.url]) continue;
          seen[it.url] = true;
          merged.push(it);
        }
      }
      function settle(isErr) {
        if (isErr) errors++;
        pending--;
        if (pending > 0) return;
        if (!merged.length) {
          var key = cf_blocked ? "online_ua_cf" : errors === queries.length ? "online_ua_error" : "online_ua_no_results";
          _this.empty(Lampa.Lang.translate(key));
          return;
        }
        var list = rankResults(merged, target);
        fillMissingYears(list, target);
        if (!manual && (target.title || target.original_title)) list = filterResults(list, target);
        _this.draw(list);
      }
      find_requests = [];
      for (var qi = 0; qi < queries.length; qi++) {
        (function(query) {
          var req = src.search(query, function(items) {
            collect(items);
            settle(false);
          }, function(reason) {
            if (reason && reason.cf) cf_blocked = true;
            settle(true);
          });
          if (req) find_requests.push(req);
        })(queries[qi]);
      }
    };
    this.buildFilter = function() {
      var select = [];
      select.push({
        title: Lampa.Lang.translate("torrent_parser_reset"),
        reset: true
      });
      if (mode === "series" && series_voices && series_voices.length) {
        var voice = series_voices[voice_index] || series_voices[0];
        if (series_voices.length > 1) {
          var vitems = [];
          for (var vi = 0; vi < series_voices.length; vi++) {
            vitems.push({
              title: series_voices[vi].label || series_voices[vi].title || Lampa.Lang.translate("online_ua_voice") + " " + (vi + 1),
              selected: vi === voice_index,
              index: vi
            });
          }
          select.push({
            title: Lampa.Lang.translate("online_ua_voice"),
            subtitle: voice.label || voice.title || "",
            items: vitems,
            stype: "voice"
          });
        }
        var seasons = voice.seasons || [];
        if (seasons.length) {
          var sitems = [];
          for (var si = 0; si < seasons.length; si++) {
            sitems.push({
              title: seasons[si].title || Lampa.Lang.translate("online_ua_season") + " " + (si + 1),
              selected: si === season_index,
              index: si
            });
          }
          select.push({
            title: Lampa.Lang.translate("online_ua_season"),
            subtitle: seasons[season_index] ? seasons[season_index].title : "",
            items: sitems,
            stype: "season"
          });
        }
      } else {
        var all = allSourceKeys();
        if (all.length) {
          var toggles = [];
          for (var i = 0; i < all.length; i++) {
            var id = all[i];
            toggles.push({
              title: (sourceEnabled(id) ? "✔ " : "– ") + SOURCES[id].title,
              index: i
            });
          }
          select.push({
            title: Lampa.Lang.translate("online_ua_sources_enable"),
            subtitle: "",
            items: toggles,
            stype: "enabled"
          });
        }
      }
      filter.set("filter", select);
      var sorts = [];
      for (var j = 0; j < source_keys.length; j++) {
        var sid = source_keys[j];
        sorts.push({
          title: SOURCES[sid] ? SOURCES[sid].title : sid,
          source: sid,
          selected: sid === active_source
        });
      }
      filter.set("sort", sorts);
      this.selected();
    };
    this.selected = function() {
      var title = active_source && SOURCES[active_source] ? SOURCES[active_source].title : Lampa.Lang.translate("online_ua_no_sources");
      var chosen = [];
      if (mode === "series" && series_voices && series_voices.length) {
        var voice = series_voices[voice_index] || series_voices[0];
        if (series_voices.length > 1 && voice.title) {
          chosen.push(Lampa.Lang.translate("online_ua_voice") + ": " + (voice.label || voice.title));
        }
        var seasons = voice.seasons || [];
        if (seasons.length && seasons[season_index]) {
          chosen.push(Lampa.Lang.translate("online_ua_season") + ": " + (seasons[season_index].title || season_index + 1));
        }
      }
      filter.chosen("filter", chosen);
      filter.chosen("sort", [ title ]);
    };
    this.closeFilter = function() {
      if ($("body").hasClass("selectbox--open")) Lampa.Select.close();
    };
    this.clearFindRequests = function() {
      for (var i = 0; i < find_requests.length; i++) {
        if (find_requests[i] && find_requests[i].clear) find_requests[i].clear();
      }
      find_requests = [];
    };
    this.reset = function() {
      last = false;
      network.clear();
      if (last_request && last_request.clear) last_request.clear();
      this.clearFindRequests();
      this.probeReset();
      scroll.render().find(".empty").remove();
      scroll.clear();
      scroll.reset();
    };
    this.empty = function(msg) {
      var empty = Lampa.Template.get("list_empty");
      if (msg) empty.find(".empty__descr").text(msg);
      scroll.clear();
      scroll.append(empty);
      this.loading(false);
      if (Lampa.Activity.active().activity === this.activity) {
        var sort = filter.render().find(".filter--sort");
        if (sort && sort.length) {
          last = sort[0];
          Lampa.Controller.toggle("content");
        } else {
          Lampa.Controller.toggle("head");
        }
      }
    };
    this.loading = function(status) {
      if (status) this.activity.loader(true); else {
        this.activity.loader(false);
        this.activity.toggle();
      }
    };
    this.draw = function(items) {
      var _this = this;
      mode = "search";
      results_items = items;
      if (!items || !items.length) {
        this.empty(Lampa.Lang.translate("online_ua_no_results"));
        return;
      }
      last = false;
      scroll.clear();
      var enabled = probeEnabled();
      items.forEach(function(item) {
        var info = [];
        if (item.year) info.push(item.year);
        info.push(Lampa.Lang.translate(item.is_series ? "online_ua_series" : "online_ua_movie"));
        if (item.label) info.push(item.label);
        var cached = enabled ? PROBE_CACHE[probeKey(item)] : null;
        var hintQ = enabled ? {
          resolution: "",
          type: ""
        } : parseStreamQuality("", item.quality);
        var seed = cached ? {
          availability: cached.state,
          resolution: cached.quality.resolution,
          type: cached.quality.type
        } : {
          availability: enabled ? "check" : "",
          resolution: hintQ.resolution,
          type: hintQ.type
        };
        var card = makeCard({
          title: item.title,
          info: info.join('<span class="online-prestige-split">●</span>'),
          poster: item.poster,
          hash: item.is_series ? null : movieHash(item),
          availability: seed.availability,
          resolution: seed.resolution,
          type: seed.type
        });
        card.on("hover:focus", function(e) {
          last = e.target;
          scroll.update($(e.target), true);
          _this.probeFocus(item);
        });
        card.on("hover:enter", function() {
          _this.onResult(item);
        });
        scroll.append(card);
        _this.enqueueProbe(item, card);
      });
      this.loading(false);
    };
    this.source = function() {
      return SOURCES[active_source];
    };
    this.onResult = function(item) {
      var _this = this;
      var src = this.source();
      if (!src) return;
      Lampa.Noty.show(Lampa.Lang.translate("online_ua_loading"));
      last_request = src.detail(item.url, function(d) {
        if (!d) {
          Lampa.Noty.show(Lampa.Lang.translate("online_ua_no_video"));
          return;
        }
        _this.onDetail(item, d);
      }, function() {
        Lampa.Noty.show(Lampa.Lang.translate("online_ua_error"));
      });
    };
    this.onDetail = function(item, d) {
      if (d.is_series && d.voices && d.voices.length) {
        this.openSeries(item, d);
      } else if (d.playerUrl) {
        this.playMovie(item, d);
      } else {
        Lampa.Noty.show(Lampa.Lang.translate("online_ua_no_video"));
      }
    };
    this.playMovie = function(item, d) {
      var _this = this;
      var src = this.source();
      last_request = src.extract(d.playerUrl, function(data) {
        var voices = data && data.voices || [];
        if (!voices.length && data && data.url) {
          voices = [ {
            title: "Українською",
            url: data.url,
            quality: data.quality,
            subtitles: data.subtitles,
            poster: data.poster
          } ];
        }
        if (!voices.length) {
          Lampa.Noty.show(Lampa.Lang.translate("online_ua_no_video"));
          return;
        }
        _this.movieVoices(item, d, voices);
      }, function(reason) {
        Lampa.Noty.show(playError(reason));
      });
    };
    this.movieVoices = function(item, d, voices) {
      var _this = this;
      if (voices.length === 1) {
        _this.playMovieVoice(item, d, voices[0]);
        return;
      }
      var pref = Lampa.Storage.get(CONFIG.STORAGE.movie_voice, "") + "";
      var list = [];
      for (var i = 0; i < voices.length; i++) {
        var vt = ("" + (voices[i].label || voices[i].title || Lampa.Lang.translate("online_ua_voice") + " " + (i + 1))).replace(/\s+/g, " ").trim();
        list.push({
          title: vt,
          index: i,
          selected: vt === pref
        });
      }
      Lampa.Select.show({
        title: Lampa.Lang.translate("online_ua_voice"),
        items: list,
        onSelect: function(s) {
          Lampa.Storage.set(CONFIG.STORAGE.movie_voice, list[s.index].title);
          _this.playMovieVoice(item, d, voices[s.index]);
        },
        onBack: function() {
          Lampa.Controller.toggle("content");
        }
      });
    };
    this.playMovieVoice = function(item, d, voice) {
      var _this = this;
      if (voice && voice.url) {
        _this.startMovie(item, d, voice.url, voice);
        return;
      }
      var ep = firstEpisode([ voice ]);
      var target = ep && (ep.file || ep.page);
      if (!target) {
        Lampa.Noty.show(Lampa.Lang.translate("online_ua_no_video"));
        return;
      }
      last_request = this.source().extract(target, function(data) {
        if (!data || !data.url) {
          Lampa.Noty.show(Lampa.Lang.translate("online_ua_no_video"));
          return;
        }
        _this.startMovie(item, d, data.url, data);
      }, function(reason) {
        Lampa.Noty.show(playError(reason));
      });
    };
    this.startMovie = function(item, d, url, data) {
      var movie = object.movie || {};
      var title = movie.title || d.title || item.title;
      if (movie.id) Lampa.Favorite.add("history", movie, 100);
      var play = {
        title: title,
        url: playableUrl(url),
        poster: data && data.poster || d.poster || item.poster || (movie.img || ""),
        timeline: Lampa.Timeline.view(movieHash(item))
      };
      if (data && data.quality) play.quality = data.quality;
      if (data && data.subtitles && data.subtitles.length) play.subtitles = proxySubtitles(data.subtitles);
      Lampa.Player.play(play);
      Lampa.Player.playlist([ play ]);
    };
    this.openSeries = function(item, d) {
      mode = "series";
      series_item = item;
      series_detail = d;
      series_voices = d.voices || [];
      voice_index = 0;
      season_index = 0;
      this.buildFilter();
      this.reset();
      this.drawEpisodes();
    };
    this.drawEpisodes = function() {
      var _this = this;
      var voice = series_voices[voice_index] || series_voices[0];
      var seasons = voice && voice.seasons || [];
      var season = seasons[season_index] || seasons[0];
      var episodes = season && season.episodes || [];
      last = false;
      scroll.clear();
      if (!episodes.length) {
        this.empty(Lampa.Lang.translate("online_ua_no_video"));
        return;
      }
      episodes.forEach(function(ep, i) {
        var seriesPoster = series_detail && series_detail.poster || series_item && series_item.poster || "";
        var card = makeCard({
          title: episodeTitle(ep, season),
          info: ep.name || "",
          poster: ep.poster || seriesPoster,
          posterFallback: seriesPoster,
          hash: episodeHash(ep, season, voice)
        });
        card.on("hover:focus", function(e) {
          last = e.target;
          scroll.update($(e.target), true);
        });
        card.on("hover:enter", function() {
          _this.playEpisode(voice, season, episodes, i);
        });
        scroll.append(card);
      });
      this.loading(false);
    };
    this.selectSeason = function(idx) {
      season_index = idx;
      this.buildFilter();
      this.drawEpisodes();
      setTimeout(this.closeFilter, 10);
    };
    this.selectVoice = function(idx) {
      voice_index = idx;
      season_index = 0;
      this.buildFilter();
      this.drawEpisodes();
      setTimeout(this.closeFilter, 10);
    };
    this.playEpisode = function(voice, season, episodes, startIdx) {
      var _this = this;
      var movie = object.movie || {};
      if (movie.id) Lampa.Favorite.add("history", movie, 100);
      Lampa.Noty.show(Lampa.Lang.translate("online_ua_loading"));
      _this.resolveEpisode(episodes[startIdx], function(data) {
        if (!data || !data.url) {
          Lampa.Noty.show(Lampa.Lang.translate("online_ua_no_video"));
          return;
        }
        var first = {
          title: episodeTitle(episodes[startIdx], season),
          url: playableUrl(data.url),
          poster: data.poster || episodes[startIdx].poster || series_detail && series_detail.poster || "",
          timeline: Lampa.Timeline.view(episodeHash(episodes[startIdx], season, voice))
        };
        if (data.quality) first.quality = data.quality;
        if (data.subtitles && data.subtitles.length) first.subtitles = proxySubtitles(data.subtitles);
        Lampa.Player.play(first);
        var playlist = [];
        for (var i = startIdx; i < episodes.length; i++) {
          (function(ep, isFirst) {
            if (isFirst) {
              playlist.push(first);
              return;
            }
            var cell = {
              title: episodeTitle(ep, season),
              poster: ep.poster || series_detail && series_detail.poster || "",
              timeline: Lampa.Timeline.view(episodeHash(ep, season, voice)),
              url: function(call) {
                _this.resolveEpisode(ep, function(dd) {
                  cell.url = dd && dd.url ? playableUrl(dd.url) : "";
                  if (dd && dd.quality) cell.quality = dd.quality;
                  if (dd && dd.subtitles) cell.subtitles = proxySubtitles(dd.subtitles);
                  call();
                }, function() {
                  cell.url = "";
                  call();
                });
              }
            };
            playlist.push(cell);
          })(episodes[i], i === startIdx);
        }
        Lampa.Player.playlist(playlist);
      }, function(reason) {
        Lampa.Noty.show(playError(reason));
      });
    };
    this.backToResults = function() {
      mode = "search";
      series_item = null;
      series_detail = null;
      series_voices = null;
      voice_index = 0;
      season_index = 0;
      this.reset();
      this.buildFilter();
      if (results_items) this.draw(results_items); else this.search();
    };
    this.resolveEpisode = function(ep, ok, err) {
      var src = this.source();
      if (!src || typeof src.extract !== "function") {
        err();
        return;
      }
      last_request = src.extract(ep.file || ep.page, function(data) {
        if (data && (!data.subtitles || !data.subtitles.length) && ep.subtitle) {
          var subs = parseSubtitles(ep.subtitle);
          if (subs.length) data.subtitles = subs;
        }
        ok(data);
      }, err);
    };
    this.start = function() {
      if (Lampa.Activity.active().activity !== this.activity) return;
      if (object.movie) {
        Lampa.Background.immediately(Lampa.Utils.cardImgBackground(object.movie));
      }
      Lampa.Controller.add("content", {
        toggle: function() {
          Lampa.Controller.collectionSet(scroll.render(), files.render());
          Lampa.Controller.collectionFocus(last || false, scroll.render());
        },
        up: function() {
          if (Navigator.canmove("up")) Navigator.move("up"); else Lampa.Controller.toggle("head");
        },
        down: function() {
          Navigator.move("down");
        },
        right: function() {
          if (Navigator.canmove("right")) Navigator.move("right"); else filter.show(Lampa.Lang.translate("title_filter"), "filter");
        },
        left: function() {
          if (Navigator.canmove("left")) Navigator.move("left"); else Lampa.Controller.toggle("menu");
        },
        back: this.back
      });
      Lampa.Controller.toggle("content");
    };
    this.render = function() {
      return files.render();
    };
    this.back = function() {
      if (mode === "series") comp.backToResults(); else Lampa.Activity.backward();
    };
    this.pause = function() {};
    this.stop = function() {};
    this.destroy = function() {
      network.clear();
      if (last_request && last_request.clear) last_request.clear();
      this.clearFindRequests();
      this.probeReset();
      files.destroy();
      scroll.destroy();
      network = null;
    };
  }
  function loadOnline(movie) {
    Lampa.Activity.push({
      url: "",
      title: Lampa.Lang.translate("online_ua_title"),
      component: CONFIG.PLUGIN_ID,
      search: movie.title,
      search_one: movie.title,
      search_two: movie.original_title,
      movie: movie,
      page: 1
    });
  }
  function initMain() {
    Lampa.Template.add("online_ua_item", '<div class="online-prestige online-prestige--full selector">' + '<div class="online-prestige__img">' + '<img alt="">' + '<div class="online-prestige__loader"></div>' + "</div>" + '<div class="online-prestige__body">' + '<div class="online-prestige__head">' + '<div class="online-prestige__title">{title}</div>' + '<div class="online-prestige__time">{time}</div>' + "</div>" + '<div class="online-prestige__timeline"></div>' + '<div class="online-prestige__footer">' + '<div class="online-prestige__info">{info}</div>' + '<div class="online-prestige__quality">{quality}</div>' + "</div>" + '<div class="online-prestige__badges"></div>' + "</div>" + "</div>");
    var css = '<style id="online_ua_style">' + ".online-prestige{position:relative;border-radius:.3em;background-color:rgba(0,0,0,0.3);display:-webkit-box;display:-webkit-flex;display:flex;will-change:transform}" + ".online-prestige__body{padding:1.2em;line-height:1.3;-webkit-box-flex:1;-webkit-flex-grow:1;flex-grow:1;position:relative}" + "@media screen and (max-width:480px){.online-prestige__body{padding:.8em 1.2em}}" + ".online-prestige__img{position:relative;width:13em;-webkit-flex-shrink:0;flex-shrink:0;min-height:8.2em}" + ".online-prestige__img>img{position:absolute;top:0;left:0;width:100%;height:100%;-o-object-fit:cover;object-fit:cover;border-radius:.3em;opacity:0;-webkit-transition:opacity .3s;transition:opacity .3s}" + ".online-prestige__img--loaded>img{opacity:1}" + "@media screen and (max-width:480px){.online-prestige__img{width:7em;min-height:6em}}" + ".online-prestige__viewed{position:absolute;top:1em;left:1em;background:rgba(0,0,0,0.45);border-radius:100%;padding:.25em;font-size:.76em}" + ".online-prestige__viewed>svg{width:1.5em !important;height:1.5em !important}" + ".online-prestige__loader{position:absolute;top:50%;left:50%;width:2em;height:2em;margin-left:-1em;margin-top:-1em;background:url(./img/loader.svg) no-repeat center center;-webkit-background-size:contain;background-size:contain}" + ".online-prestige__head,.online-prestige__footer{display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-pack:justify;-webkit-justify-content:space-between;justify-content:space-between;-webkit-box-align:center;-webkit-align-items:center;align-items:center}" + ".online-prestige__timeline{margin:.8em 0}" + ".online-prestige__timeline>.time-line{display:block !important}" + ".online-prestige__title{font-size:1.7em;overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}" + "@media screen and (max-width:480px){.online-prestige__title{font-size:1.4em}}" + ".online-prestige__time{padding-left:2em}" + ".online-prestige__info{display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-align:center;-webkit-align-items:center;align-items:center}" + ".online-prestige__info>*{overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}" + ".online-prestige__quality{padding-left:1em;white-space:nowrap}" + ".online-prestige .online-prestige-split{font-size:.8em;margin:0 1em;-webkit-flex-shrink:0;flex-shrink:0}" + ".online-prestige__badges{display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-align:center;-webkit-align-items:center;align-items:center;-webkit-flex-wrap:wrap;flex-wrap:wrap;margin-top:.7em}" + ".online-prestige__badges:empty{display:none}" + ".online-prestige__badge{display:-webkit-inline-box;display:-webkit-inline-flex;display:inline-flex;-webkit-box-align:center;-webkit-align-items:center;align-items:center;margin-right:.6em;font-size:1.1em;line-height:1}" + ".online-prestige__badge--res,.online-prestige__badge--type{padding:.25em .55em;border-radius:.3em;background:rgba(255,255,255,0.14);white-space:nowrap;font-weight:600}" + ".online-prestige__avail>svg{width:1.5em;height:1.5em;display:block}" + ".online-prestige.focus::after{content:'';position:absolute;top:-0.6em;left:-0.6em;right:-0.6em;bottom:-0.6em;border-radius:.7em;border:solid .3em #fff;z-index:-1;pointer-events:none}" + ".online-prestige+.online-prestige{margin-top:1.5em}" + "</style>";
    function injectCSS() {
      try {
        if (typeof $ === "undefined") return;
        if ($("#online_ua_style").length) return;
        $("body").append(css);
      } catch (e) {}
    }
    Lampa.Component.add(CONFIG.PLUGIN_ID, component);
    Lampa.Manifest.plugins = {
      type: "video",
      version: CONFIG.VERSION,
      name: CONFIG.NAME,
      description: Lampa.Lang.translate("online_ua_watch"),
      component: CONFIG.PLUGIN_ID,
      onContextMenu: function(movie) {
        return {
          name: Lampa.Lang.translate("online_ua_watch"),
          description: ""
        };
      },
      onContextLauch: function(movie) {
        loadOnline(movie);
      }
    };
    var button = '<div class="full-start__button selector view--online_ua" data-subtitle="' + CONFIG.NAME + " " + CONFIG.VERSION + '">' + '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' + '<path d="M8 5v14l11-7z" fill="currentColor"/></svg>' + "<span>#{online_ua_watch}</span>" + "</div>";
    Lampa.Listener.follow("full", function(e) {
      if (e.type == "complite") {
        injectCSS();
        var render = e.object.activity.render();
        if (render.find(".view--online_ua").length) return;
        var btn = $(Lampa.Lang.translate(button));
        btn.on("hover:enter", function() {
          loadOnline(e.data.movie);
        });
        var torrent = render.find(".view--torrent");
        if (torrent.length) torrent.after(btn); else render.find(".full-start__buttons").append(btn);
      }
    });
    injectCSS();
  }
  function initSettings() {
    try {
      Lampa.SettingsApi.addComponent({
        component: CONFIG.PLUGIN_ID,
        name: CONFIG.NAME,
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' + '<rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" stroke-width="2"/>' + '<path d="M10 9l5 3-5 3V9z" fill="currentColor"/></svg>'
      });
      Lampa.SettingsApi.addParam({
        component: CONFIG.PLUGIN_ID,
        param: {
          name: CONFIG.STORAGE.proxy,
          type: "input",
          values: "",
          default: ""
        },
        field: {
          name: Lampa.Lang.translate("online_ua_proxy"),
          description: Lampa.Lang.translate("online_ua_proxy_desc")
        },
        onChange: function() {}
      });
      Lampa.SettingsApi.addParam({
        component: CONFIG.PLUGIN_ID,
        param: {
          name: CONFIG.STORAGE.probe,
          type: "trigger",
          default: true
        },
        field: {
          name: Lampa.Lang.translate("online_ua_probe_title"),
          description: Lampa.Lang.translate("online_ua_probe_desc")
        },
        onChange: function() {}
      });
    } catch (e) {
      console.log("online_ua", "settings init failed", e);
    }
  }
  function initLang() {
    Lampa.Lang.add({
      online_ua_title: {
        uk: "UA Онлайн",
        en: "UA Online",
        ru: "UA Онлайн"
      },
      online_ua_watch: {
        uk: "Дивитися (UA)",
        en: "Watch (UA)",
        ru: "Смотреть (UA)"
      },
      online_ua_source: {
        uk: "Джерело",
        en: "Source",
        ru: "Источник"
      },
      online_ua_sources_enable: {
        uk: "Увімкнені джерела",
        en: "Enabled sources",
        ru: "Включённые источники"
      },
      online_ua_no_sources: {
        uk: "Джерела ще не додані",
        en: "No sources added yet",
        ru: "Источники ещё не добавлены"
      },
      online_ua_not_implemented: {
        uk: "Джерело ще не реалізовано",
        en: "Source not implemented yet",
        ru: "Источник ещё не реализован"
      },
      online_ua_no_results: {
        uk: "Нічого не знайдено",
        en: "Nothing found",
        ru: "Ничего не найдено"
      },
      online_ua_loading: {
        uk: "Завантаження…",
        en: "Loading…",
        ru: "Загрузка…"
      },
      online_ua_error: {
        uk: "Помилка з’єднання",
        en: "Connection error",
        ru: "Ошибка соединения"
      },
      online_ua_no_video: {
        uk: "Відео недоступне",
        en: "Video unavailable",
        ru: "Видео недоступно"
      },
      online_ua_geo: {
        uk: "Недоступно у вашому регіоні. Вкажіть UA-проксі в налаштуваннях.",
        en: "Unavailable in your region. Set a UA proxy in settings.",
        ru: "Недоступно в вашем регионе. Укажите UA-прокси в настройках."
      },
      online_ua_cf: {
        uk: "Пошук на цьому джерелі заблоковано захистом сайту. Вкажіть проксі в налаштуваннях.",
        en: "Search on this source is blocked by the site's protection. Set a proxy in settings.",
        ru: "Поиск на этом источнике заблокирован защитой сайта. Укажите прокси в настройках."
      },
      online_ua_movie: {
        uk: "Фільм",
        en: "Movie",
        ru: "Фильм"
      },
      online_ua_series: {
        uk: "Серіал",
        en: "Series",
        ru: "Сериал"
      },
      online_ua_voice: {
        uk: "Озвучення",
        en: "Voice",
        ru: "Озвучка"
      },
      online_ua_season: {
        uk: "Сезон",
        en: "Season",
        ru: "Сезон"
      },
      online_ua_min: {
        uk: "хв",
        en: "min",
        ru: "мин"
      },
      online_ua_proxy: {
        uk: "Проксі (необов’язково)",
        en: "Proxy (optional)",
        ru: "Прокси (необязательно)"
      },
      online_ua_proxy_desc: {
        uk: "Власний CORS-проксі (потрібен на LG/webOS). Спробується після прямого з’єднання, перед вбудованими публічними проксі. Префікс перед URL; якщо закінчується на «=», адреса кодується (стиль ?url=). Залиште порожнім, якщо не впевнені.",
        en: "Your own CORS proxy (needed on LG/webOS). Tried after the direct connection, before the built-in public proxies. Used as a prefix; if it ends with \"=\", the target URL is encoded (?url= style). Leave empty if unsure.",
        ru: "Свой CORS-прокси (нужен на LG/webOS). Пробуется после прямого соединения, перед встроенными публичными прокси. Префикс перед URL; если заканчивается на «=», адрес кодируется (стиль ?url=). Оставьте пустым, если не уверены."
      },
      online_ua_probe_title: {
        uk: "Показувати доступність і якість у пошуку",
        en: "Show availability & quality in search",
        ru: "Показывать доступность и качество в поиске"
      },
      online_ua_probe_desc: {
        uk: "Перевіряє кожен результат у фоні й показує на картці кружечок доступності (зелений — грає, червоний — недоступно/гео-блок) та якість (роздільність і тип). Вимкніть, щоб не робити зайвих запитів.",
        en: "Checks each result in the background and shows an availability circle (green plays, red unavailable/geo-blocked) and quality (resolution + type) on the card. Turn off to avoid the extra requests.",
        ru: "Проверяет каждый результат в фоне и показывает на карточке кружок доступности (зелёный — играет, красный — недоступно/гео-блок) и качество (разрешение и тип). Отключите, чтобы не делать лишних запросов."
      },
      online_ua_available: {
        uk: "Доступно",
        en: "Available",
        ru: "Доступно"
      },
      online_ua_unavailable: {
        uk: "Недоступно",
        en: "Unavailable",
        ru: "Недоступно"
      },
      online_ua_checking: {
        uk: "Перевірка…",
        en: "Checking…",
        ru: "Проверка…"
      },
      online_ua_unknown: {
        uk: "Не вдалося перевірити",
        en: "Couldn’t verify",
        ru: "Не удалось проверить"
      }
    });
  }
  function startPlugin() {
    try {
      initLang();
    } catch (e) {
      logErr("lang", e);
    }
    try {
      initMain();
    } catch (e) {
      logErr("main", e);
    }
    try {
      initSettings();
    } catch (e) {
      logErr("settings", e);
    }
  }
  function logErr(where, e) {
    try {
      console.log("online_ua init " + where + " failed:", e && e.message);
    } catch (x) {}
  }
  startPlugin();
})();