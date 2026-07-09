/**
 * UA Онлайн — Lampa online-source plugin (Ukrainian streaming sources).
 *
 * Phase 0: skeleton only. CONFIG + net() fallback chain + an EMPTY SOURCES
 * registry + a standard Lampa online component + card-button/manifest/settings
 * integration. No content source is implemented yet — adding one in Phase 1 is
 * a single object literal in SOURCES plus wiring src.search() into find().
 *
 * Hard rules (see docs/WORKFLOW.md):
 *  - ES5 only (old Android-TV WebViews): var / function(){} / string concat.
 *  - No credentials, tokens or secret-decoding anywhere.
 *  - Every network request goes through net() (the fallback chain).
 *  - Ukrainian user-facing strings via Lampa.Lang.add (uk/en/ru).
 */
(function () {
    'use strict';

    // Startup guard — never initialise twice.
    if (window.online_ua_plugin) return;
    window.online_ua_plugin = true;

    // ─────────────────────────────────────────────────────────────
    // CONFIG
    // ─────────────────────────────────────────────────────────────
    var CONFIG = {
        PLUGIN_ID: 'online_ua',
        VERSION: '0.1.0',
        NAME: 'UA Онлайн',
        // Public CORS-proxy fallbacks (tried after a DIRECT request fails).
        // Left EMPTY on purpose: an audit of the reference plugins' proxies
        // (2026-07-08) found the known public relays (cors557.deno.dev,
        // cors.nb557.workers.dev, apn-latest.onrender.com) are DOMAIN-WHITELISTED
        // — they reject our sources' hosts with a "Malformed URL" body, which is
        // worse than useless (a 200 error-string would be handed to the parser).
        // None provide a Ukrainian egress or solve Cloudflare either. So we rely
        // on DIRECT (native, CORS-free) + the optional user-set proxy field only.
        // No server we run, no third-party infra baked in.
        PROXY_CHAIN: [],
        STORAGE: {
            proxy: 'online_ua_proxy_url',      // optional user fallback proxy
            source: 'online_ua_source',        // last picked source id
            enabled_prefix: 'online_ua_enabled_', // per-source on/off toggles
            probe: 'online_ua_probe'           // show availability+quality badges (default on)
        }
    };

    // ─────────────────────────────────────────────────────────────
    // net(url, opts, ok, err) — request wrapper over Lampa.Reguest.
    //
    // Fallback chain (the zero-proxy heart, see docs/ARCHITECTURE.md):
    //   1. DIRECT (native network — CORS-free on the app)
    //   2. each hardcoded public CORS proxy in CONFIG.PROXY_CHAIN
    //   3. the optional user-set proxy (online_ua_proxy_url), if non-empty
    //   4. err() with the last error
    //
    // opts: { dataType:'text'|'json', headers:{}, timeout:ms, post:false|data }
    // Returns the Lampa.Reguest instance so callers can .clear() it.
    // ─────────────────────────────────────────────────────────────
    function net(url, opts, ok, err) {
        opts = opts || {};
        ok = ok || function () {};
        err = err || function () {};

        var request = new Lampa.Reguest();
        var timeout = opts.timeout || 15000;
        var post = opts.post || false;

        var params = { dataType: opts.dataType || 'text' };
        if (opts.headers) params.headers = opts.headers;

        // Build the ordered list of full request URLs to try.
        var chain = [];
        chain.push(url); // 1. DIRECT
        for (var i = 0; i < CONFIG.PROXY_CHAIN.length; i++) { // 2. public proxies
            chain.push(CONFIG.PROXY_CHAIN[i] + url);
        }
        var user_proxy = (Lampa.Storage.field(CONFIG.STORAGE.proxy) || '') + '';
        if (user_proxy) chain.push(user_proxy + url); // 3. user proxy

        var index = 0;

        function attempt(last_a, last_c) {
            if (index >= chain.length) {
                err(last_a, last_c); // 4. every tier failed
                return;
            }
            var target = chain[index];
            index++;
            request.clear();
            request.timeout(timeout);
            request['native'](target, function (body) {
                // Treat an empty body as a failure so the next tier is tried.
                if (body === '' || body === null || body === undefined) {
                    attempt(body, 'empty');
                    return;
                }
                ok(body, target);
            }, function (a, c) {
                attempt(a, c);
            }, post, params);
        }

        attempt();
        return request;
    }

    // ─────────────────────────────────────────────────────────────
    // SOURCES — the source registry. EMPTY this phase (Phase 0).
    //
    // Each value implements the Source interface (from docs/ARCHITECTURE.md):
    //
    //   id, title, baseUrl, priority,
    //   search(query, ok, err)      -> [ {title, year, url, poster, is_series} ]
    //   detail(url, ok, err)        -> { title, poster, description,
    //                                    playerUrl|iframe, is_series }
    //   extract(playerUrl, ok, err) -> movie:  {url:m3u8, quality, subtitles}
    //                                  series: {voices:[{title, seasons:[
    //                                           {title, episodes:[{title, file}]}]}]}
    //
    // All requests inside a source MUST go through net(). No secrets in code.
    // Phase 1 adds the first source (uafix.net) as one object literal here.
    // ─────────────────────────────────────────────────────────────
    var SOURCES = {};

    // Registry helpers (safe with an empty SOURCES).
    function allSourceKeys() {
        var keys = [];
        for (var k in SOURCES) {
            if (SOURCES.hasOwnProperty(k)) keys.push(k);
        }
        keys.sort(function (a, b) {
            return (SOURCES[a].priority || 0) - (SOURCES[b].priority || 0);
        });
        return keys;
    }

    function sourceEnabled(id) {
        return Lampa.Storage.get(CONFIG.STORAGE.enabled_prefix + id, true) !== false;
    }

    function enabledSourceKeys() {
        return allSourceKeys().filter(function (id) {
            return sourceEnabled(id);
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Shared source helpers (HTML + Playerjs parsing, URL handling).
    // ─────────────────────────────────────────────────────────────
    function absUrl(url, base) {
        if (!url) return '';
        url = ('' + url).trim();
        if (url.indexOf('//') === 0) return 'https:' + url;
        if (url.indexOf('http') === 0) return url;
        if (url.charAt(0) === '/') return base + url;
        return base + '/' + url;
    }

    function htmlDoc(html) {
        return new DOMParser().parseFromString(html, 'text/html');
    }

    function metaContent(doc, prop) {
        var el = doc.querySelector('meta[property="' + prop + '"]');
        return el ? (el.getAttribute('content') || '') : '';
    }

    // Known UA-geo-gated stream CDNs. When a player resolves to one of these but
    // yields no stream (site served the player only to Ukrainian IPs), we report
    // a distinct "unavailable in your region" message instead of a generic error.
    function isGeoHost(url) {
        return /(ashdi|tortuga|moon)/i.test('' + (url || ''));
    }

    // Parse a Playerjs payload (shared by zetvideo movies + ashdi episodes).
    // Returns { file, poster, subtitles:[{label,url}], playlist } where
    // playlist is a nested ashdi array (voices→seasons→episodes) or null.
    function parsePlayerjs(text) {
        var res = { file: '', poster: '', subtitles: [], playlist: null };

        // Nested playlist form first:  file:"[ ... ]"  /  file:'[ ... ]'
        var m = text.match(/file\s*:\s*'(\[[\s\S]*?\])'\s*[,}]/);
        if (!m) m = text.match(/file\s*:\s*"(\[[\s\S]*?\])"\s*[,}]/);
        if (m) {
            try { res.playlist = JSON.parse(m[1]); } catch (e) { res.playlist = null; }
        }
        if (!res.playlist) {
            var fm = text.match(/file\s*:\s*"([^"]*)"/);
            if (!fm) fm = text.match(/file\s*:\s*'([^']*)'/);
            if (fm) res.file = fm[1];
        }

        var pm = text.match(/poster\s*:\s*"([^"]*)"/);
        if (pm) res.poster = pm[1];

        var sm = text.match(/subtitle\s*:\s*"([^"]*)"/);
        if (sm && sm[1]) {
            sm[1].split(',').forEach(function (s) {
                var mm = s.match(/\[([^\]]+)\](.*)/);
                if (mm && mm[2]) res.subtitles.push({ label: mm[1], url: mm[2].trim() });
                else if (s.indexOf('http') === 0) res.subtitles.push({ label: 'sub', url: s.trim() });
            });
        }
        return res;
    }

    // Normalise a nested ashdi playlist JSON (voice→season→episode) into the
    // interface's voices/seasons/episodes shape. Shared by every ashdi-backed
    // source (uafix nested-fallback + uafilm series). Does NOT use `this`.
    function playlistToVoices(playlist) {
        function eps(arr) {
            return arr.map(function (ep, i) {
                return {
                    title: (ep.title || ('Серія ' + (i + 1))).replace(/\s+/g, ' ').trim(),
                    file: ep.file || '',
                    id: ep.id || ep.vid || '',
                    poster: ep.poster || '',
                    subtitle: ep.subtitle || ''
                };
            });
        }
        function seas(arr) {
            return arr.map(function (s) {
                return {
                    title: (s.title || '').replace(/\s+/g, ' ').trim(),
                    episodes: s.folder ? eps(s.folder) : (s.file ? eps([s]) : [])
                };
            });
        }
        return playlist.map(function (v) {
            return {
                title: (v.title || '').replace(/\s+/g, ' ').trim(),
                seasons: v.folder ? seas(v.folder) : (v.file ? [{ title: '', episodes: eps([v]) }] : [])
            };
        });
    }

    // parseStreamQuality(fileUrl, listingHint) -> { resolution, type }
    // Quality is NOT labelled inside the master m3u8, but the resolved stream URL
    // path embeds quality tokens (e.g. `…_webdl_1080p_…/hls/index.m3u8`). Parse
    // them from the URL; fall back to a coarse listing label (e.g. uafilm 'HD')
    // only when the URL carries no token. Empty strings when nothing is found —
    // callers omit a badge entirely rather than show a blank. Does NOT use `this`.
    var QUALITY_TYPE_RULES = [
        [/web-?dl/, 'WEB-DL'],
        [/web-?rip/, 'WEBRip'],
        [/hd-?rip/, 'HDRip'],
        [/bd-?rip/, 'BDRip'],
        [/blu-?ray/, 'BluRay'],
        [/dvd-?rip/, 'DVDRip'],
        [/hd-?tv/, 'HDTV'],
        [/cam-?rip/, 'CAM'],
        [/(?:^|[^a-z])cam(?:[^a-z]|$)/, 'CAM'],
        [/(?:^|[^a-z])ts(?:[^a-z]|$)/, 'TS'],
        [/(?:^|[^a-z])hd(?:[^a-z]|$)/, 'HD']
    ];
    function qualityType(s) {
        for (var i = 0; i < QUALITY_TYPE_RULES.length; i++) {
            if (QUALITY_TYPE_RULES[i][0].test(s)) return QUALITY_TYPE_RULES[i][1];
        }
        return '';
    }
    function parseStreamQuality(fileUrl, listingHint) {
        var out = { resolution: '', type: '' };
        var u = ('' + (fileUrl || '')).toLowerCase();

        // Resolution — accept p-suffixed, x-prefixed and _delimited forms.
        if (/(?:^|[^0-9])2160p?(?:[^0-9]|$)|(?:^|[^a-z0-9])4k(?:[^a-z0-9]|$)/.test(u)) out.resolution = '4K';
        else if (/(?:^|[^0-9])1080p?(?:[^0-9]|$)|x1080/.test(u)) out.resolution = '1080p';
        else if (/(?:^|[^0-9])720p?(?:[^0-9]|$)|x720/.test(u)) out.resolution = '720p';
        else if (/(?:^|[^0-9])480p?(?:[^0-9]|$)|x480/.test(u)) out.resolution = '480p';

        // Type/source — ordered so specific tokens beat the generic 'hd'.
        out.type = qualityType(u);

        // Weak fallback: the coarse listing label (normalised through the same rules).
        if (!out.type && listingHint) {
            var h = ('' + listingHint).trim();
            out.type = qualityType(h.toLowerCase()) || h.toUpperCase();
        }
        return out;
    }

    // ── search-result relevance (source-agnostic; used by the component's find) ──
    // The DLE search on a Ukrainian site returns loosely-related titles and never
    // ranks them, so the intended movie can be buried. These pure helpers (no
    // `this`, no DOM → unit-testable offline) normalise + score result titles
    // against the opened card so draw() gets a relevant, sensibly-ordered list.

    // movieYear(movie) — the card's year from movie.year or a release date. ''.
    function movieYear(movie) {
        if (!movie) return '';
        if (movie.year) return ('' + movie.year).replace(/\D/g, '').slice(0, 4);
        var d = movie.release_date || movie.first_air_date || movie.last_air_date || '';
        var m = ('' + d).match(/(\d{4})/);
        return m ? m[1] : '';
    }

    // normTitle(s) — lowercase, drop Latin diacritics (guarded: normalize is not
    // on every old WebView), strip punctuation, collapse whitespace. Keeps Latin
    // + Cyrillic letters + digits so Ukrainian/Russian/English all compare cleanly.
    function normTitle(s) {
        s = ('' + (s || '')).toLowerCase();
        if (s.normalize) { try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {} }
        s = s.replace(/[^0-9a-zЀ-ӿ]+/g, ' ');
        return s.replace(/\s+/g, ' ').trim();
    }

    // titleSimilarity(a, b) — 0..1.15. Exact normalised match = 1; otherwise token
    // Jaccard (penalises extra words so a sequel scores below the plain title) plus
    // a small containment bump when the shorter title's tokens all appear in the
    // longer one (keeps "Матриця: Революція" above zero-overlap junk).
    function titleSimilarity(a, b) {
        var na = normTitle(a), nb = normTitle(b);
        if (!na || !nb) return 0;
        if (na === nb) return 1;
        var ta = na.split(' '), tb = nb.split(' ');
        var aset = {}, bset = {}, i, k;
        for (i = 0; i < ta.length; i++) aset[ta[i]] = true;
        for (i = 0; i < tb.length; i++) bset[tb[i]] = true;
        var inter = 0, uni = 0;
        for (k in aset) if (aset.hasOwnProperty(k)) { uni++; if (bset[k]) inter++; }
        for (k in bset) if (bset.hasOwnProperty(k) && !aset[k]) uni++;
        var jaccard = uni ? inter / uni : 0;
        var contained = false;
        if (inter) {
            var shorter = (ta.length <= tb.length) ? aset : bset;
            var longer = (shorter === aset) ? bset : aset;
            contained = true;
            for (k in shorter) if (shorter.hasOwnProperty(k) && !longer[k]) { contained = false; break; }
        }
        return jaccard + (contained ? 0.15 : 0);
    }

    // rankResults(items, target) — score each item by the BEST of its similarity
    // to target.title and target.original_title, + 0.5 when the year matches (±1).
    // Returns a NEW array sorted descending; stamps item.rank_score for the filter.
    function rankResults(items, target) {
        target = target || {};
        var list = (items || []).slice();
        var ty = parseInt(('' + (target.year || '')).replace(/\D/g, ''), 10);
        for (var i = 0; i < list.length; i++) {
            var it = list[i];
            var s1 = target.title ? titleSimilarity(it.title, target.title) : 0;
            var s2 = target.original_title ? titleSimilarity(it.title, target.original_title) : 0;
            var score = Math.max(s1, s2);
            if (ty && it.year) {
                var iy = parseInt(('' + it.year).replace(/\D/g, ''), 10);
                if (iy && Math.abs(iy - ty) <= 1) score += 0.5;
            }
            it.rank_score = score;
        }
        list.sort(function (a, b) { return (b.rank_score || 0) - (a.rank_score || 0); });
        return list;
    }

    // filterResults(ranked, target) — CONSERVATIVE. Drop only clear non-matches
    // (essentially zero token overlap). NEVER return empty when the source gave
    // results: if nothing clears the bar (unusual/mis-langed target title) keep
    // the top few so the user still sees something. `ranked` must be pre-sorted.
    function filterResults(ranked, target) {
        var MIN = 0.05, KEEP_TOP = 3;
        var kept = [];
        for (var i = 0; i < ranked.length; i++) {
            if ((ranked[i].rank_score || 0) > MIN) kept.push(ranked[i]);
        }
        if (!kept.length) kept = ranked.slice(0, Math.min(ranked.length, KEEP_TOP));
        return kept;
    }

    // fillMissingYears(list, target) — FIX B optional: when a listing gives no year
    // (e.g. uafix) but a result's title is an EXACT normalised match to the opened
    // card, borrow the card's year. Exact-only → high confidence, never fabricated.
    function fillMissingYears(list, target) {
        if (!target || !target.year) return;
        var tt = normTitle(target.title), ot = normTitle(target.original_title);
        for (var i = 0; i < list.length; i++) {
            var it = list[i];
            if (it.year) continue;
            var nt = normTitle(it.title);
            if (nt && (nt === tt || (ot && nt === ot))) it.year = ('' + target.year).replace(/\D/g, '').slice(0, 4);
        }
    }

    // First episode object across a detail()'s voices/seasons, or null. Shared by
    // the availability probe to pick a representative stream to test. No `this`.
    function firstEpisode(voices) {
        if (!voices) return null;
        for (var v = 0; v < voices.length; v++) {
            var seasons = (voices[v] && voices[v].seasons) || [];
            for (var s = 0; s < seasons.length; s++) {
                var eps = seasons[s].episodes || [];
                if (eps.length) return eps[0];
            }
        }
        return null;
    }

    // probeResolve(src, item, done) — determine availability + (movie) stream url +
    // quality for a search-result `item` using ONLY the Source interface, WITHOUT
    // the user clicking. done({ state:'ok'|'no'|'unknown', url, quality:{…} }).
    //   'ok'      : a stream resolved (movie stream, or a series episode/playlist).
    //   'no'      : CONFIRMED unavailable — a resolve error that explicitly carries a
    //               geo/region flag (sources call err({geo:true})). Nothing else.
    //   'unknown' : ambiguous — detail ok but no resolvable stream, a non-geo error,
    //               or no player to probe. NOT the same as 'no' (see BUG A): a series
    //               may come back is_series with empty voices + a playerUrl that the
    //               real play path (openSeries) resolves fine, so we re-resolve it
    //               here and only call it 'no' on an explicit geo flag.
    //   MOVIE  : detail() → extract(playerUrl) → url ⇒ ok; err.geo ⇒ no; else unknown.
    //   SERIES : firstEpisode(voices) ⇒ ok (quality from ep.file); else if playerUrl,
    //            extract() it (mirrors openSeries) → url/voices ⇒ ok; err.geo ⇒ no;
    //            else unknown; else (no ep, no player) ⇒ unknown.
    // Returns a cancelable handle { clear() } proxying the in-flight net() request
    // (mirrors how the component clears `last_request`). Does NOT use `this` — so it
    // is unit-testable offline against the fixtures. Never touches the DOM.
    function probeResolve(src, item, done) {
        done = done || function () {};
        var handle = { req: null, done: false, cancelled: false };
        handle.clear = function () {
            handle.cancelled = true;
            if (handle.req && handle.req.clear) handle.req.clear();
        };
        function finish(result) {
            if (handle.cancelled || handle.done) return;
            handle.done = true;
            done(result);
        }
        function no() { return { state: 'no', url: '', quality: { resolution: '', type: '' } }; }
        function unknown() { return { state: 'unknown', url: '', quality: { resolution: '', type: '' } }; }
        function ok(url, file) { return { state: 'ok', url: url || '', quality: parseStreamQuality(file || url, item && item.quality) }; }
        // A resolve failure is CONFIRMED 'no' only when it carries an explicit geo/
        // region flag (sources signal it via err({geo:true})). Every other failure —
        // a network error (net() calls err(status,code)), an unseen payload, etc. —
        // is ambiguous → 'unknown', never a red ✗.
        function fromErr(reason) { return (reason && reason.geo) ? no() : unknown(); }

        if (!src || typeof src.detail !== 'function') { finish(unknown()); return handle; }

        handle.req = src.detail(item.url, function (d) {
            if (handle.cancelled) return;
            if (!d) { finish(unknown()); return; }

            if (d.is_series) {
                var ep = firstEpisode(d.voices);
                if (ep) {
                    if (ep.file) { finish(ok('', ep.file)); return; }
                    // No ready file (per-episode page) — resolve it to detect geo-gate.
                    handle.req = src.extract(ep.file || ep.page, function (data) {
                        if (handle.cancelled) return;
                        if (data && data.url) { finish(ok('', data.url)); return; }
                        finish(unknown());
                    }, function (reason) {
                        if (handle.cancelled) return;
                        finish(fromErr(reason));
                    });
                    return;
                }
                // No episode yet. uakino/uafilm can return is_series with empty voices
                // + a playerUrl when the eager extract came back empty; re-resolve it
                // the way openSeries does so a geo-block reads 'no' and an ambiguous
                // failure reads 'unknown' (NOT a false ✗).
                if (d.playerUrl) {
                    handle.req = src.extract(d.playerUrl, function (data) {
                        if (handle.cancelled) return;
                        if (data && (data.url || (data.voices && data.voices.length))) { finish(ok('', data.url || '')); return; }
                        finish(unknown());
                    }, function (reason) {
                        if (handle.cancelled) return;
                        finish(fromErr(reason));
                    });
                    return;
                }
                // No episode and no player to probe → can't confirm either way.
                finish(unknown());
                return;
            }

            // Movie: resolve the player to a single playable stream.
            if (!d.playerUrl) { finish(unknown()); return; }
            handle.req = src.extract(d.playerUrl, function (data) {
                if (handle.cancelled) return;
                if (data && data.url) { finish(ok(data.url, data.url)); return; }
                finish(unknown());
            }, function (reason) {
                if (handle.cancelled) return;
                finish(fromErr(reason));
            });
        }, function (reason) {
            if (handle.cancelled) return;
            finish(fromErr(reason));
        });
        return handle;
    }

    // ── card badge rendering (inline SVG availability circle + res/type pills) ──
    // availabilitySvg(state) — 'ok' (green ✓, plays), 'no' (red ✗, CONFIRMED geo/
    // unavailable), 'unknown' (grey hollow, FINAL "couldn't verify"), anything else
    // = 'check' (grey hollow, in-progress). 'unknown' and 'check' share the neutral
    // hollow circle but differ by tooltip: 'unknown' is a settled result, not a red ✗.
    function availabilitySvg(state) {
        var title, cls, inner;
        if (state === 'ok') {
            title = Lampa.Lang.translate('online_ua_available');
            cls = 'online-prestige__avail--ok';
            inner = '<circle cx="12" cy="12" r="11" fill="#39b54a"/>' +
                '<path d="M6.8 12.4l3.3 3.3 7.1-7.4" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
        } else if (state === 'no') {
            title = Lampa.Lang.translate('online_ua_unavailable');
            cls = 'online-prestige__avail--no';
            inner = '<circle cx="12" cy="12" r="11" fill="#e0483e"/>' +
                '<path d="M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>';
        } else if (state === 'unknown') {
            title = Lampa.Lang.translate('online_ua_unknown');
            cls = 'online-prestige__avail--unknown';
            inner = '<circle cx="12" cy="12" r="9" fill="none" stroke="#9aa0a6" stroke-width="2.2"/>';
        } else {
            title = Lampa.Lang.translate('online_ua_checking');
            cls = 'online-prestige__avail--check';
            inner = '<circle cx="12" cy="12" r="9" fill="none" stroke="#9aa0a6" stroke-width="2.2"/>';
        }
        return '<span class="online-prestige__badge online-prestige__avail ' + cls + '" title="' + title + '">' +
            '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' + inner + '</svg></span>';
    }
    function badgeText(v) { return ('' + v).replace(/[<>]/g, ''); }
    function badgesHtml(b) {
        var html = '';
        if (b.availability) html += availabilitySvg(b.availability);
        if (b.resolution) html += '<span class="online-prestige__badge online-prestige__badge--res">' + badgeText(b.resolution) + '</span>';
        if (b.type) html += '<span class="online-prestige__badge online-prestige__badge--type">' + badgeText(b.type) + '</span>';
        return html;
    }
    // Update an already-rendered card with a completed probe result (the probe
    // resolves asynchronously; makeCard renders the neutral state, this fills it).
    function setCardBadges(cardEl, result) {
        if (!cardEl || !cardEl.find) return;
        var el = cardEl.find('.online-prestige__badges');
        if (!el.length) return;
        var q = (result && result.quality) || {};
        el.html(badgesHtml({
            // Pass the REAL settled state through — 'ok' (green), 'no' (red), or
            // 'unknown' (neutral). Do NOT collapse a non-'ok' to a red ✗.
            availability: (result && result.state) || 'no',
            resolution: q.resolution || '',
            type: q.type || ''
        }));
    }

    // Session-wide probe cache, keyed by `active_source + '|' + item.url`. Shared
    // across component instances (per app session): a cached item is not re-probed.
    var PROBE_CACHE = {};

    // Only a positively-resolved probe ('ok') is cached. 'no' and 'unknown' are NOT
    // cached (see BUG A): the module-wide cache is session-long, so caching a 'no'
    // taken BEFORE the user enabled a device VPN would pin a red ✗ for the whole
    // session even after the VPN makes the title play. Leaving them uncached means
    // toggling the VPN and re-searching re-probes and can flip ✗/neutral → ✓.
    function probeCacheable(result) { return !!(result && result.state === 'ok'); }

    // ─────────────────────────────────────────────────────────────
    // SOURCE: uafix.net (Netflix content dubbed in Ukrainian).
    //
    // Verified live 2026-07-08 (see sources/uafix.md):
    //  - search  : /index.php?do=search&subaction=search&story=… → a.sres-wrap
    //  - movie   : detail og:video:iframe → zetvideo.net → Playerjs m3u8 (direct)
    //  - series  : detail lists /…/season-XX-episode-XX/ pages; each episode page
    //              exposes an ashdi.vip player (UA-geo-gated) → Playerjs m3u8
    // Expected net() tier: DIRECT (native app; zetvideo CORS *).
    // ─────────────────────────────────────────────────────────────
    SOURCES.uafix = {
        id: 'uafix',
        title: 'UAFix',
        baseUrl: 'https://uafix.net',
        priority: 1,

        headers: function () {
            return { 'Referer': this.baseUrl + '/' };
        },

        // search(query, ok, err) -> [ {title, year, url, poster, is_series} ]
        search: function (query, ok, err) {
            var self = this;
            var url = self.baseUrl + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);
            return net(url, { dataType: 'text', headers: self.headers() }, function (html) {
                ok(self.parseSearch(html));
            }, err);
        },

        parseSearch: function (html) {
            var self = this;
            var doc = htmlDoc(html);
            var out = [];
            var seen = {};

            function push(href, title, poster) {
                href = absUrl(href, self.baseUrl);
                title = (title || '').replace(/\s+/g, ' ').trim();
                if (!href || !title || seen[href]) return;
                seen[href] = true;
                var is_series = href.indexOf('/serials/') >= 0 || href.indexOf('/serial/') >= 0;
                var ym = title.match(/\((\d{4})\)/);
                out.push({
                    title: title,
                    year: ym ? ym[1] : '',
                    url: href,
                    poster: poster ? absUrl(poster, self.baseUrl) : '',
                    is_series: is_series
                });
            }

            var cards = doc.querySelectorAll('.video-item');
            for (var i = 0; i < cards.length; i++) {
                var a = cards[i].querySelector('a[href]');
                var img = cards[i].querySelector('img');
                var t = cards[i].querySelector('.vi-title');
                push(a ? a.getAttribute('href') : '',
                     t ? t.textContent : (img ? img.getAttribute('alt') : ''),
                     img ? (img.getAttribute('data-src') || img.getAttribute('src')) : '');
            }
            if (!out.length) {
                var links = doc.querySelectorAll('a.sres-wrap');
                for (var j = 0; j < links.length; j++) {
                    var im = links[j].querySelector('.sres-img img');
                    var h2 = links[j].querySelector('h2');
                    push(links[j].getAttribute('href'),
                         h2 ? h2.textContent : '',
                         im ? (im.getAttribute('data-src') || im.getAttribute('src')) : '');
                }
            }
            return out;
        },

        // detail(url, ok, err) -> movie:  {title, poster, description, playerUrl, is_series:false}
        //                         series: {title, poster, description, is_series:true, voices:[…]}
        detail: function (url, ok, err) {
            var self = this;
            return net(url, { dataType: 'text', headers: self.headers() }, function (html) {
                ok(self.parseDetail(url, html));
            }, err);
        },

        parseDetail: function (url, html) {
            var self = this;
            var doc = htmlDoc(html);
            var ogType = metaContent(doc, 'og:type');
            var ogTitle = metaContent(doc, 'og:title');
            var poster = absUrl(metaContent(doc, 'og:image'), self.baseUrl);

            var h1 = doc.querySelector('.fright h1') || doc.querySelector('h1');
            var title = h1 ? h1.textContent.replace(/\s*дивит[\s\S]*$/i, '').trim() : '';
            if (!title) title = ogTitle.replace(/\s*\([^)]*\).*/, '').trim() || ogTitle;

            var descEl = doc.querySelector('#serial-kratko, .sbox-text, .fdesc, .fdescr, .ftext');
            var description = descEl ? descEl.textContent.trim() : '';

            var epLinks = doc.querySelectorAll('a[href*="season-"][href*="episode-"]');
            var is_series = url.indexOf('/serials/') >= 0 || ogType.indexOf('episode') >= 0 || epLinks.length > 0;

            if (is_series && epLinks.length) {
                return {
                    title: title,
                    poster: poster,
                    description: description,
                    is_series: true,
                    voices: [{ title: '', seasons: self.parseSeasons(doc) }]
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

        // Real player iframe URL (skips the YouTube trailer).
        findPlayer: function (doc) {
            var og = metaContent(doc, 'og:video:iframe');
            if (og) {
                var m = og.match(/src=['"]([^'"]+)['"]/);
                if (m && m[1] && m[1].indexOf('youtu') < 0) return m[1];
            }
            var ifs = doc.querySelectorAll('.video-box iframe, .fplayer iframe, iframe');
            for (var i = 0; i < ifs.length; i++) {
                var src = ifs[i].getAttribute('src') || ifs[i].getAttribute('data-src') || '';
                if (src && src.indexOf('youtu') < 0) return src;
            }
            return '';
        },

        // Build [{title, season, episodes:[{season, episode, title, name, page, poster}]}]
        // from the season-XX-episode-XX links / .video-item cards on a series page.
        parseSeasons: function (doc) {
            var self = this;
            var byseason = {};
            var order = [];
            var have = {};

            function add(href, name, poster) {
                href = absUrl(href, self.baseUrl);
                var m = href.match(/season-(\d+)-episode-(\d+)/);
                if (!m) return;
                var s = parseInt(m[1], 10), e = parseInt(m[2], 10);
                var key = s + '|' + e;
                if (have[key]) return;
                have[key] = true;
                if (!byseason[s]) { byseason[s] = { title: 'Сезон ' + s, season: s, episodes: [] }; order.push(s); }
                byseason[s].episodes.push({
                    season: s, episode: e,
                    title: 'Серія ' + e,
                    name: (name || '').replace(/\s+/g, ' ').trim(),
                    page: href,
                    poster: poster ? absUrl(poster, self.baseUrl) : ''
                });
            }

            var cards = doc.querySelectorAll('.video-item');
            for (var i = 0; i < cards.length; i++) {
                var a = cards[i].querySelector('a[href*="season-"][href*="episode-"]');
                if (!a) continue;
                var rate = cards[i].querySelector('.vi-rate');
                var img = cards[i].querySelector('img');
                add(a.getAttribute('href'),
                    rate ? rate.textContent : '',
                    img ? (img.getAttribute('data-src') || img.getAttribute('src')) : '');
            }
            // Any episode links not represented by a card.
            var links = doc.querySelectorAll('a[href*="season-"][href*="episode-"]');
            for (var j = 0; j < links.length; j++) add(links[j].getAttribute('href'), '', '');

            order.sort(function (x, y) { return x - y; });
            var seasons = [];
            for (var k = 0; k < order.length; k++) {
                var sn = byseason[order[k]];
                sn.episodes.sort(function (p, q) { return p.episode - q.episode; });
                seasons.push(sn);
            }
            return seasons;
        },

        // extract(target, ok, err) -> movie:  {url, quality, subtitles, poster}
        //                             series: {voices:[…]}  (nested ashdi, rare)
        // `target` may be: a direct m3u8, a player iframe URL (zetvideo/ashdi),
        // or a uafix episode PAGE URL (fetched, then its player is resolved).
        extract: function (target, ok, err) {
            var self = this;
            ok = ok || function () {};
            err = err || function () {};
            if (!target) { err(); return; }

            if (/\.m3u8(\?|$)/.test(target) || /\.mp4(\?|$)/.test(target)) {
                ok({ url: target, quality: null, subtitles: [], poster: '' });
                return;
            }

            // A uafix content page (episode) — resolve its player first. From a
            // non-UA IP the episode page carries only a YouTube trailer (uafix
            // injects the ashdi player for Ukrainian IPs only) → findPlayer()
            // returns nothing → signal a geo-gate so the UI can say so.
            if (target.indexOf('uafix.net') >= 0) {
                return net(target, { dataType: 'text', headers: self.headers() }, function (html) {
                    var playerUrl = self.findPlayer(htmlDoc(html));
                    if (!playerUrl) { err({ geo: true }); return; }
                    self.extractPlayer(playerUrl, ok, err);
                }, err);
            }

            return self.extractPlayer(target, ok, err);
        },

        extractPlayer: function (playerUrl, ok, err) {
            var self = this;
            return net(playerUrl, { dataType: 'text', headers: self.headers() }, function (text) {
                var p = parsePlayerjs(text);
                if (p.playlist) { ok({ voices: self.playlistToVoices(p.playlist), poster: p.poster }); return; }
                // Player iframe resolved but no stream: a geo-gated CDN (ashdi/…)
                // served an empty player to our non-UA IP → report the geo-gate.
                if (!p.file) { err(isGeoHost(playerUrl) ? { geo: true } : undefined); return; }
                ok({ url: p.file, quality: null, subtitles: p.subtitles, poster: p.poster });
            }, err);
        },

        // Normalise a nested ashdi playlist JSON into the voices/seasons/episodes
        // shape. Delegates to the shared top-level helper (same function object) so
        // uafix and uafilm stay in lockstep; kept as a method for API compatibility.
        playlistToVoices: playlistToVoices
    };

    // ─────────────────────────────────────────────────────────────
    // SOURCE: uafilm (Ukrainian-dubbed films & series) — live on klon.fun.
    //
    // Verified live 2026-07-08 (see sources/uafilm.md):
    //  - DLE site; uafilm.tv/.pro 301 → klon.fun (baseUrl is a one-line change).
    //  - search  : /index.php?do=search&subaction=search&story=… → .short-news__small-card
    //  - detail  : og:type is video.movie for BOTH — type from URL (/serialy/,
    //              /multserialy/) + ashdi iframe path (/serial/ vs /vod/). The
    //              iframe is LAZY (data-src, no src).
    //  - movie   : ashdi.vip/vod/{id} → Playerjs flat file: (single HLS master, direct)
    //  - series  : ashdi.vip/serial/{id} → Playerjs nested playlist JSON
    //              (voice→season→episode) → shared playlistToVoices; each episode
    //              carries a ready `file` (m3u8) so extract short-circuits to play.
    // net() tier: DIRECT (native app; not geo-gated — films AND series play non-UA).
    // ─────────────────────────────────────────────────────────────
    SOURCES.uafilm = {
        id: 'uafilm',
        title: 'UAFilm',
        baseUrl: 'https://klon.fun',
        priority: 2,

        headers: function () {
            return { 'Referer': this.baseUrl + '/' };
        },

        // search(query, ok, err) -> [ {title, year, url, poster, is_series} ]
        search: function (query, ok, err) {
            var self = this;
            var url = self.baseUrl + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);
            return net(url, { dataType: 'text', headers: self.headers() }, function (html) {
                ok(self.parseSearch(html));
            }, err);
        },

        parseSearch: function (html) {
            var self = this;
            var doc = htmlDoc(html);
            var out = [];
            var seen = {};

            var cards = doc.querySelectorAll('.short-news__small-card');
            for (var i = 0; i < cards.length; i++) {
                var card = cards[i];
                var a = card.querySelector('a.short-news__small-card__link') || card.querySelector('a[href]');
                var href = a ? absUrl(a.getAttribute('href'), self.baseUrl) : '';
                if (!href || seen[href]) continue;
                seen[href] = true;

                var img = card.querySelector('.card-poster img.card-poster__img') || card.querySelector('img');
                var tEl = card.querySelector('.card-title__block .card-link__text') || card.querySelector('.card-link__text');
                var title = tEl ? tEl.textContent : '';
                if (!title && img) {
                    title = (img.getAttribute('title') || img.getAttribute('alt') || '')
                        .replace(/^\s*постер\s+/i, '')
                        .replace(/\s*дивит[\s\S]*$/i, '');
                }
                title = (title || '').replace(/\s+/g, ' ').trim();
                if (!title) continue;

                var poster = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';
                var sub = card.querySelector('.card-module__subscribe');
                var subText = sub ? sub.textContent.replace(/\s+/g, ' ').trim() : '';
                var ym = subText.match(/(\d{4})/);

                out.push({
                    title: title,
                    year: ym ? ym[1] : '',
                    url: href,
                    poster: poster ? absUrl(poster, self.baseUrl) : '',
                    is_series: self.isSeriesUrl(href) || /^\s*Серіал/i.test(subText)
                });
            }
            return out;
        },

        // Series content URLs live under /serialy/ or /multserialy/ (films are
        // /filmy/ or /multfilmy/, anime /anime/). og:type is useless here.
        isSeriesUrl: function (url) {
            url = '' + (url || '');
            return url.indexOf('/serialy/') >= 0 || url.indexOf('/multserialy/') >= 0;
        },

        // detail(url, ok, err) -> movie:  {title, poster, description, playerUrl, is_series:false}
        //                         series: {title, poster, description, is_series:true, voices:[…]}
        detail: function (url, ok, err) {
            var self = this;
            ok = ok || function () {};
            err = err || function () {};
            return net(url, { dataType: 'text', headers: self.headers() }, function (html) {
                var doc = htmlDoc(html);
                var poster = absUrl(metaContent(doc, 'og:image'), self.baseUrl);

                var h1 = doc.querySelector('h1.info-title__title-h1') || doc.querySelector('h1');
                var title = h1 ? h1.textContent.replace(/\s*\(\d{4}\)[\s\S]*$/, '').replace(/\s+/g, ' ').trim() : '';
                if (!title) title = metaContent(doc, 'og:title').replace(/\s*[—-]\s*дивит[\s\S]*$/i, '').replace(/\s+/g, ' ').trim();

                var descEl = doc.querySelector('.full-text.clearfix');
                var description = descEl ? descEl.textContent.replace(/\s+/g, ' ').trim() : metaContent(doc, 'og:description');

                var playerUrl = self.findPlayer(doc);
                var is_series = self.isSeriesUrl(url) || /\/serial\//.test(playerUrl);

                if (is_series) {
                    // Fetch the ashdi /serial/ player and expand its nested playlist.
                    if (!playerUrl) {
                        ok({ is_series: true, voices: [], title: title, poster: poster, description: description });
                        return;
                    }
                    self.extract(playerUrl, function (data) {
                        ok({
                            is_series: true,
                            voices: (data && data.voices) || [],
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

        // The detail-page player iframe is LAZY: it carries data-src, not src.
        findPlayer: function (doc) {
            var box = doc.querySelector('.film-player iframe') ||
                doc.querySelector('iframe[data-src*="ashdi"], iframe[src*="ashdi"]');
            if (!box) return '';
            return box.getAttribute('data-src') || box.getAttribute('src') || '';
        },

        // extract(target, ok, err) -> movie:  {url, quality, subtitles, poster}
        //                             series: {voices:[…]}  (nested ashdi playlist)
        // `target` may be a direct m3u8 (episode file → short-circuit) or an ashdi
        // player URL (/vod/ flat, /serial/ nested).
        extract: function (target, ok, err) {
            var self = this;
            ok = ok || function () {};
            err = err || function () {};
            if (!target) { err(); return; }

            if (/\.m3u8(\?|$)/.test(target) || /\.mp4(\?|$)/.test(target)) {
                ok({ url: target, quality: null, subtitles: [], poster: '' });
                return;
            }

            return net(target, { dataType: 'text', headers: self.headers() }, function (text) {
                var p = parsePlayerjs(text);
                if (p.playlist) {
                    var voices = playlistToVoices(p.playlist);
                    // Stamp season/episode indices so the component's per-episode
                    // watched-progress hash is unique (nested playlists carry no
                    // explicit numbering, unlike uafix's per-episode pages).
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
                    ok({ voices: voices, poster: p.poster });
                    return;
                }
                // No stream in a resolved player — ashdi is a known geo host, so
                // flag it (harmless here: uafilm is not geo-gated, but keeps the
                // UI message consistent if a title/region ever withholds a stream).
                if (!p.file) { err(isGeoHost(target) ? { geo: true } : undefined); return; }
                ok({ url: p.file, quality: null, subtitles: p.subtitles, poster: p.poster });
            }, err);
        }
    };

    // ─────────────────────────────────────────────────────────────
    // SOURCE: uakino (Ukrainian-dubbed films / serials / anime) — live on
    // uakino.com.ua. Recon spec: sources/uakino.md (RECON DONE 2026-07-08, US IP).
    //
    // Verified from a NON-UA (US) IP:
    //  - DLE site, custom `ua-*` theme, no Cloudflare/anti-bot. net() tier DIRECT
    //    for ALL html (home / search / detail return 200 to a plain fetch off-UA).
    //  - search : /index.php?do=search&subaction=search&story=… → a.ua-card
    //  - detail : h1.ua-full-title + og:* + .ua-description; the REAL player iframe
    //             is server-rendered in #tab-player (trailer lives in #tab-trailer,
    //             always api.ortified.ws/embed/trailer-imdb/… → skipped).
    //  - two player backends occur per-title:
    //       hdvbua.pro/embed/<id>/<hash>        (majority; Playerjs, ashdi family)
    //       api.ortified.ws/embed/imdb/<imdbId> (IMDB-keyed UA-dub aggregator)
    //  - series : NO per-episode pages on uakino — the voices/seasons/episodes tree
    //             lives INSIDE the (geo-gated) Playerjs payload, so detail() resolves
    //             it through extract() exactly like uafilm's ashdi /serial/.
    //
    // *** extract() UNVERIFIED from non-UA — both player backends are GEO-GATED to
    //     Ukraine and return region-block pages off-UA (hdvbua "Контент недоступний",
    //     ortified "недоступно для вашего региона: US"). ***
    //   · hdvbua path follows the KNOWN uaserials/uafilm Playerjs pattern (best-effort
    //     but principled — same CDN family, reuses parsePlayerjs + playlistToVoices).
    //   · ortified path is best-effort only: its unblocked payload has NEVER been seen,
    //     so we merely attempt parsePlayerjs and, if nothing parses, report a geo-gate
    //     rather than invent a parser. Needs on-UA reverse-engineering to confirm.
    //   · Any geo indicator or a resolved player with no `file`/playlist → err({geo}).
    // net() tier: DIRECT (html). Stream playback MUST be re-tested on a UA device.
    // ─────────────────────────────────────────────────────────────
    SOURCES.uakino = {
        id: 'uakino',
        title: 'UAKino',
        baseUrl: 'https://uakino.com.ua',
        priority: 4,

        headers: function () {
            return { 'Referer': this.baseUrl + '/' };
        },

        // search(query, ok, err) -> [ {title, year, url, poster, is_series} ]
        search: function (query, ok, err) {
            var self = this;
            var url = self.baseUrl + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);
            return net(url, { dataType: 'text', headers: self.headers() }, function (html) {
                ok(self.parseSearch(html));
            }, err);
        },

        // The search page carries a single `.ua-cards` block whose result cards are
        // `a.ua-card` (same markup the home/category pages reuse, but the search
        // response has no sidebar/"similar" cards to exclude — spec §Search).
        parseSearch: function (html) {
            var self = this;
            var doc = htmlDoc(html);
            var out = [];
            var seen = {};

            var cards = doc.querySelectorAll('a.ua-card');
            for (var i = 0; i < cards.length; i++) {
                var card = cards[i];
                var href = absUrl(card.getAttribute('href'), self.baseUrl);
                if (!href || seen[href]) continue;

                var nameEl = card.querySelector('.ua-card-name');
                var raw = nameEl ? nameEl.textContent : '';
                raw = (raw || '').replace(/\s+/g, ' ').trim();
                if (!raw) continue;
                seen[href] = true;

                var ym = raw.match(/\((\d{4})\)/);
                var title = raw.replace(/\s*\(\d{4}\)[\s\S]*$/, '').trim() || raw;

                var img = card.querySelector('.ua-poster img') || card.querySelector('img');
                var poster = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';

                // A "N сезон" badge on the poster ⇒ series; movies carry no badge.
                var badge = card.querySelector('.ua-badges .ua-badge') || card.querySelector('.ua-badge');
                var is_series = !!(badge && /сезон/i.test(badge.textContent || ''));

                out.push({
                    title: title,
                    year: ym ? ym[1] : '',
                    url: href,
                    poster: poster ? absUrl(poster, self.baseUrl) : '',
                    is_series: is_series
                });
            }
            return out;
        },

        // Classify the player iframe host. hdvbua = known Playerjs CDN (ashdi
        // family); ortified = IMDB-keyed aggregator (payload unseen off-UA).
        classifyHost: function (url) {
            var u = '' + (url || '');
            if (/hdvbua/i.test(u)) return 'hdvbua';
            if (/ortified/i.test(u)) return 'ortified';
            return 'other';
        },

        // Real player iframe from #tab-player. Skips the trailer (#tab-trailer,
        // always …/embed/trailer-imdb/…). Falls back to any non-trailer player
        // iframe if the tab markup ever changes.
        findPlayer: function (doc) {
            var tab = doc.querySelector('#tab-player');
            if (tab) {
                var f = tab.querySelector('iframe');
                if (f) {
                    var src = f.getAttribute('src') || f.getAttribute('data-src') || '';
                    if (src && !/trailer-imdb/i.test(src)) return src;
                }
            }
            var ifs = doc.querySelectorAll('.ua-player iframe, iframe');
            for (var i = 0; i < ifs.length; i++) {
                var s = ifs[i].getAttribute('src') || ifs[i].getAttribute('data-src') || '';
                if (s && !/trailer-imdb/i.test(s) && (/hdvbua/i.test(s) || /ortified/i.test(s))) return s;
            }
            return '';
        },

        // Series detection with no URL/og:type signal (spec §detection):
        //  1. og:title starts with "Серіал " (strongest single-page signal)
        //  2. breadcrumb JSON-LD position-2 category = /seriali/ or /multseriali/
        //  (anime may be movie- or series-anime → deferred to the payload shape.)
        isSeries: function (doc, ogTitle) {
            if (/^\s*Серіал\s/i.test(ogTitle || '')) return true;
            return this.isSeriesByBreadcrumb(doc);
        },

        isSeriesByBreadcrumb: function (doc) {
            var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
            for (var i = 0; i < scripts.length; i++) {
                var data;
                try { data = JSON.parse(scripts[i].textContent); } catch (e) { continue; }
                var list = this.breadcrumbList(data);
                if (!list) continue;
                for (var j = 0; j < list.length; j++) {
                    var el = list[j];
                    if (!el) continue;
                    if (el.position === 2 || el.position === '2') {
                        var id = (el.item && (el.item['@id'] || el.item.id)) || '';
                        if (/\/(seriali|multseriali)\//.test('' + id)) return true;
                    }
                }
            }
            return false;
        },

        // Pull the BreadcrumbList itemListElement out of a parsed JSON-LD blob,
        // whether top-level or nested under @graph. Returns an array or null.
        breadcrumbList: function (data) {
            if (!data) return null;
            if (data['@type'] === 'BreadcrumbList' && data.itemListElement) return data.itemListElement;
            var graph = data['@graph'];
            if (graph && graph.length) {
                for (var g = 0; g < graph.length; g++) {
                    if (graph[g] && graph[g]['@type'] === 'BreadcrumbList' && graph[g].itemListElement) {
                        return graph[g].itemListElement;
                    }
                }
            }
            return null;
        },

        // detail(url, ok, err) -> movie:  {is_series:false, playerUrl, playerHost, title, poster, description}
        //                         series: {is_series:true,  voices:[…], playerUrl, playerHost, title, poster, description}
        // Series mirrors uafilm: the nested playlist lives inside the (geo-gated)
        // player, so detail() eagerly resolves it via extract(). Off-UA the payload
        // is geo-blocked → voices come back empty but playerUrl is still returned, so
        // the component's movie fallback surfaces a clean geo message instead of a
        // silent "no video". On UA a nested playlist populates voices → series UI.
        detail: function (url, ok, err) {
            var self = this;
            ok = ok || function () {};
            err = err || function () {};
            return net(url, { dataType: 'text', headers: self.headers() }, function (html) {
                var doc = htmlDoc(html);
                var ogTitle = metaContent(doc, 'og:title');

                var poster = absUrl(metaContent(doc, 'og:image'), self.baseUrl);
                if (!poster) {
                    var pimg = doc.querySelector('.ua-full-poster img');
                    if (pimg) poster = absUrl(pimg.getAttribute('src') || pimg.getAttribute('data-src') || '', self.baseUrl);
                }

                var h1 = doc.querySelector('h1.ua-full-title') || doc.querySelector('h1');
                var title = h1 ? h1.textContent.replace(/\s*\(\d{4}\)[\s\S]*$/, '').replace(/\s+/g, ' ').trim() : '';
                if (!title) title = ogTitle.replace(/^\s*Серіал\s+/i, '').replace(/\s*\(\d{4}\)[\s\S]*$/, '').replace(/\s+/g, ' ').trim();

                var descEl = doc.querySelector('.ua-description');
                var description = descEl ? descEl.textContent.replace(/\s+/g, ' ').trim() : metaContent(doc, 'og:description');

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
                    if (!playerUrl) { ok(base); return; }
                    self.extract(playerUrl, function (data) {
                        // A nested playlist → voices. A flat file (mislabeled anime)
                        // leaves voices empty and lets the movie fallback play it.
                        base.voices = (data && data.voices) || [];
                        ok(base);
                    }, function () {
                        // Geo-gated / unparsable payload off-UA → empty voices; the
                        // playerUrl carries through for the graceful geo message.
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

        // extract(target, ok, err) -> movie:  {url, quality, subtitles, poster}
        //                             series: {voices:[…]}  (nested playlist)
        //
        // UNVERIFIED off-UA (players geo-gated). `target` is the #tab-player iframe
        // (hdvbua or ortified) or a ready m3u8 (episode file → short-circuit).
        //  · hdvbua : known Playerjs pattern → parsePlayerjs → flat file (movie) or
        //             nested playlist (series). Same CDN family as uaserials/uafilm.
        //  · ortified: payload shape UNKNOWN → attempt parsePlayerjs only; if nothing
        //             parses, report geo (do NOT fabricate a parser for an unseen
        //             format — reverse-engineer on a UA device).
        //  · Any geo indicator ("недоступ…"/region text) or a resolved player with no
        //    file/playlist ⇒ err({geo:true}). Never fakes a stream.
        extract: function (target, ok, err) {
            var self = this;
            ok = ok || function () {};
            err = err || function () {};
            if (!target) { err(); return; }

            if (/\.m3u8(\?|$)/.test(target) || /\.mp4(\?|$)/.test(target)) {
                ok({ url: target, quality: null, subtitles: [], poster: '' });
                return;
            }

            return net(target, { dataType: 'text', headers: self.headers() }, function (text) {
                // Explicit geo-block indicators seen from non-UA on BOTH backends.
                if (/недоступ|вашего региона|вашого регіону|регіон недоступ/i.test(text)) {
                    err({ geo: true });
                    return;
                }

                var p = parsePlayerjs(text);

                if (p.playlist) {
                    var voices = playlistToVoices(p.playlist);
                    // Stamp season/episode indices so the component's per-episode
                    // watched-progress hash is unique (nested playlists carry no
                    // explicit numbering) — same as uafilm's series path.
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
                    ok({ voices: voices, poster: p.poster });
                    return;
                }

                if (!p.file) {
                    // No flat file and no playlist. Off-UA this is a geo-block page
                    // (hdvbua) or ortified's unseen/unparsed payload → geo-gate.
                    err({ geo: true });
                    return;
                }

                ok({ url: p.file, quality: null, subtitles: p.subtitles, poster: p.poster });
            }, err);
        },

        // Kept as a method for API parity with the other sources; delegates to the
        // shared top-level helper so uakino stays in lockstep with uafix/uafilm.
        playlistToVoices: playlistToVoices
    };

    // ─────────────────────────────────────────────────────────────
    // SOURCE: kinoukr (kinoukr.tv) — Ukrainian-dubbed films & series.
    //
    // Verified live 2026-07-08 (see sources/kinoukr.md):
    //  - DLE site behind Cloudflare. Content URLs are FLAT: /{id}-slug.html
    //    (no /films/ vs /serials/ prefix) → type is detected on the detail page.
    //  - detail  : og:image poster, h1[itemprop=name] title, .fdesc description,
    //              year from the .finfo "Рік" line. Type from the player iframe
    //              path — ashdi.vip/vod/ = movie, ashdi.vip/serial/ = series
    //              (the tortuga.tw mirror iframes are dead 404 → ignored).
    //  - movie   : ashdi.vip/vod/{id} → Playerjs flat file: (single HLS master, direct)
    //  - series  : ashdi.vip/serial/{id} → Playerjs nested playlist JSON
    //              (voice→season→episode) → shared playlistToVoices; each episode
    //              carries a ready `file` (m3u8) so extract short-circuits to play.
    //  - net() tier: DIRECT for homepage/detail/category (Cloudflare passes content
    //    pages to a plain browser-UA). Streams (ashdi.vip) are NOT geo-gated — movie
    //    AND episode m3u8 return 200 from a non-UA IP.
    //
    //  ⚠️ SEARCH is Cloudflare-blocked. The DLE search endpoint returns a
    //  "Just a moment…" managed challenge (HTTP 403) on every method/param order,
    //  and the tested public proxies are dead for it. search() therefore tries the
    //  normal DLE GET through net() (DIRECT → public proxies → user proxy), detects
    //  the challenge, and fails cleanly with err({cf:true}) instead of returning the
    //  challenge HTML as junk. To use kinoukr search, the user must set their own
    //  working proxy in the plugin's proxy field (online_ua_proxy_url) — net()'s
    //  last fallback tier — or rely on a native-app CF bypass (unverified).
    // ─────────────────────────────────────────────────────────────
    SOURCES.kinoukr = {
        id: 'kinoukr',
        title: 'KinoUkr',
        baseUrl: 'https://kinoukr.tv',
        priority: 3,

        headers: function () {
            return { 'Referer': this.baseUrl + '/' };
        },

        // search(query, ok, err) -> [ {title, year, url, poster, is_series} ]
        // ⚠️ Cloudflare-blocked (see header). Tries the DLE GET via net() (which
        // already walks DIRECT → public proxies → the user proxy); a challenge in
        // the body OR a total net() failure surfaces as err({cf:true}) — never junk.
        search: function (query, ok, err) {
            var self = this;
            ok = ok || function () {};
            err = err || function () {};
            var url = self.baseUrl + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);
            return net(url, { dataType: 'text', headers: self.headers() }, function (html) {
                // A challenge page is NOT results — treat it as a search failure.
                if (self.isCloudflareChallenge(html)) { err({ cf: true }); return; }
                ok(self.parseSearch(html));
            }, function () {
                // Every net() tier failed — the search endpoint is CF-challenged
                // (or the user has no working proxy). Report it as a CF block.
                err({ cf: true });
            });
        },

        // Detect a Cloudflare "Just a moment…" managed-challenge page so it is
        // never parsed as (empty/garbage) search results. Genuine DLE pages carry
        // .short cards and none of these markers.
        isCloudflareChallenge: function (html) {
            var s = '' + (html || '');
            return /just a moment/i.test(s) ||
                /cf-challenge|cf_chl|challenge-platform/i.test(s) ||
                /enable javascript and cookies/i.test(s);
        },

        // Parse DLE .short cards (same markup on search / homepage / category
        // listings — verified in kinoukr-home.html). is_series is only a best-effort
        // hint from the card badge; detail() is authoritative for the real type.
        parseSearch: function (html) {
            var self = this;
            var doc = htmlDoc(html);
            var out = [];
            var seen = {};

            var cards = doc.querySelectorAll('.short.clearfix');
            if (!cards.length) cards = doc.querySelectorAll('.short');
            for (var i = 0; i < cards.length; i++) {
                var card = cards[i];

                var a = card.querySelector('a.short-title') ||
                    card.querySelector('.short-img a.ps-link[href]') ||
                    card.querySelector('a[href]');
                var href = a ? absUrl(a.getAttribute('href'), self.baseUrl) : '';
                if (!href) {
                    var th = card.querySelector('.th-inf[data-href]');
                    if (th) href = absUrl(th.getAttribute('data-href'), self.baseUrl);
                }
                if (!href || seen[href]) continue;
                seen[href] = true;

                var tEl = card.querySelector('a.short-title');
                var img = card.querySelector('.short-img img') || card.querySelector('img');
                var title = tEl ? tEl.textContent : (img ? (img.getAttribute('alt') || '') : '');
                title = (title || '').replace(/\s+/g, ' ').trim();
                if (!title) continue;

                var poster = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';
                var ym = (card.textContent || '').match(/\b(?:19|20)\d{2}\b/);

                out.push({
                    title: title,
                    year: ym ? ym[0] : '',
                    url: href,
                    poster: poster ? absUrl(poster, self.baseUrl) : '',
                    is_series: !!card.querySelector('.m-meta.m-series, .fa-circle-play')
                });
            }
            return out;
        },

        // detail(url, ok, err) -> movie:  {is_series:false, playerUrl, title, year, poster, description}
        //                         series: {is_series:true, voices:[…], title, year, poster, description}
        detail: function (url, ok, err) {
            var self = this;
            ok = ok || function () {};
            err = err || function () {};
            return net(url, { dataType: 'text', headers: self.headers() }, function (html) {
                var doc = htmlDoc(html);
                var ogTitle = metaContent(doc, 'og:title');
                var poster = absUrl(metaContent(doc, 'og:image'), self.baseUrl);

                var h1 = doc.querySelector('h1[itemprop="name"]') || doc.querySelector('h1');
                var title = h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : '';
                if (!title) {
                    title = ogTitle.replace(/^\s*(?:Фільм|Серіал)\s+/i, '')
                        .replace(/\s+\d{4}[\s\S]*$/, '').replace(/\s+/g, ' ').trim();
                }

                var year = self.parseYear(doc, ogTitle);

                var descEl = doc.querySelector('.fdesc');
                var description = descEl ? descEl.textContent.replace(/\s+/g, ' ').trim()
                    : metaContent(doc, 'og:description');

                var playerUrl = self.findPlayer(doc);
                // Iframe path is the definitive discriminator; og:title prefix backs it up.
                var is_series = /ashdi\.vip\/serial\//.test(playerUrl) || /^\s*Серіал/i.test(ogTitle);

                if (is_series) {
                    // Fetch the ashdi /serial/ player and expand its nested playlist.
                    if (!playerUrl) {
                        ok({ is_series: true, voices: [], title: title, year: year, poster: poster, description: description });
                        return;
                    }
                    self.extract(playerUrl, function (data) {
                        ok({
                            is_series: true,
                            voices: (data && data.voices) || [],
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

        // Year from the .finfo "Рік" line (…​<span>Рік:</span> <a>2026</a>…),
        // falling back to a 4-digit year in og:title ("Фільм … 2026 …").
        parseYear: function (doc, ogTitle) {
            var lines = doc.querySelectorAll('.finfo .sd-line, .sd-line');
            for (var i = 0; i < lines.length; i++) {
                var span = lines[i].querySelector('span');
                if (span && /Рік/i.test(span.textContent)) {
                    var m = (lines[i].textContent || '').match(/\b(?:19|20)\d{2}\b/);
                    if (m) return m[0];
                }
            }
            var m2 = ('' + (ogTitle || '')).match(/\b(?:19|20)\d{2}\b/);
            return m2 ? m2[0] : '';
        },

        // The real player iframe: prefer ashdi.vip (vod=movie / serial=series),
        // checking data-src and src; skip the dead tortuga.tw mirrors + any youtube.
        findPlayer: function (doc) {
            var box = doc.querySelector('iframe[data-src*="ashdi.vip"], iframe[src*="ashdi.vip"]');
            if (box) return box.getAttribute('data-src') || box.getAttribute('src') || '';
            var ifs = doc.querySelectorAll('.fplayer iframe, .video-box iframe, iframe');
            for (var i = 0; i < ifs.length; i++) {
                var src = ifs[i].getAttribute('data-src') || ifs[i].getAttribute('src') || '';
                if (src && src.indexOf('ashdi') >= 0) return src;
            }
            return '';
        },

        // extract(target, ok, err) -> movie:  {url, quality, subtitles, poster}
        //                             series: {voices:[…]}  (nested ashdi playlist)
        // `target` may be a direct m3u8 (episode file → short-circuit) or an ashdi
        // player URL (/vod/ flat, /serial/ nested). ashdi is the only host here and
        // can withhold a stream regionally → no file resolved ⇒ err({geo:true}).
        extract: function (target, ok, err) {
            var self = this;
            ok = ok || function () {};
            err = err || function () {};
            if (!target) { err(); return; }

            if (/\.m3u8(\?|$)/.test(target) || /\.mp4(\?|$)/.test(target)) {
                ok({ url: target, quality: null, subtitles: [], poster: '' });
                return;
            }

            return net(target, { dataType: 'text', headers: self.headers() }, function (text) {
                var p = parsePlayerjs(text);
                if (p.playlist) {
                    var voices = playlistToVoices(p.playlist);
                    // Stamp season/episode indices so the component's per-episode
                    // watched-progress hash is unique (nested playlists carry no
                    // explicit numbering).
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
                    ok({ voices: voices, poster: p.poster });
                    return;
                }
                // Resolved the ashdi player but got no stream → treat as a geo-gate
                // (ashdi is the only, geo-capable, host) so the UI shows a clear msg.
                if (!p.file) { err({ geo: true }); return; }
                ok({ url: p.file, quality: null, subtitles: p.subtitles, poster: p.poster });
            }, err);
        }
    };

    // ─────────────────────────────────────────────────────────────
    // SOURCE: uaserials (Ukrainian-dubbed films / serials / anime) — live on
    // uaserials.fm. Recon spec: sources/uaserials.md (RECON DONE 2026-07-08, US IP).
    //
    // Verified END-TO-END from a NON-UA (US) IP against uaserials.fm:
    //  - DLE site, template `TPL`, behind Cloudflare but NO JS challenge / no
    //    anti-bot (the old 403 is gone). net() tier DIRECT for ALL html AND the
    //    ashdi player + raw m3u8 (all 200 to a plain fetch off-UA, no UA/cookie).
    //  - search : /index.php?do=search&subaction=search&story=… → .short-item cards.
    //  - detail : h1.short-title .oname_ua + og:* + .ftext.full-text; the REAL
    //             player is an EAGER-src iframe (iframe[src*="ashdi.vip"]); a
    //             YouTube trailer iframe may sit alongside on series → skipped.
    //  - player = ashdi.vip ONLY: movie /vod/{id} (flat single-quoted file:'…m3u8'),
    //             series /serial/{id} (nested voice→season→episode JSON). Identical
    //             CDN/shape to uafilm → reuse parsePlayerjs + playlistToVoices.
    //  - series : NO per-episode pages — the whole episode tree lives INSIDE the
    //             ashdi /serial/{id} payload, so detail() resolves it via extract()
    //             exactly like uafilm's ashdi /serial/.
    //  - streams: ashdi HLS master → 200 from US IP (NOT geo-gated). CORS on the
    //    stream is host-scoped to ashdi.vip → native player OK.
    //
    // NOTE: .fm is a CURRENT MIRROR (different install than the old plugin's
    // uaserials.my/.com, which serve a GEO-GATED hdvbua player off-UA). The
    // operator shuffles domains often (DLE habit) → baseUrl is a one-line swap.
    // ─────────────────────────────────────────────────────────────
    SOURCES.uaserials = {
        id: 'uaserials',
        title: 'UASerials',
        baseUrl: 'https://uaserials.fm',
        priority: 5,

        headers: function () {
            return { 'Referer': this.baseUrl + '/' };
        },

        // search(query, ok, err) -> [ {title, year, url, poster, is_series} ]
        search: function (query, ok, err) {
            var self = this;
            var url = self.baseUrl + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);
            return net(url, { dataType: 'text', headers: self.headers() }, function (html) {
                ok(self.parseSearch(html));
            }, err);
        },

        // DLE search results are `.short-item` cards: the link is `a.short-img`,
        // the UA title `.th-title`, the poster a lazyload `img[data-src]` (the eager
        // `src` is the TPL default.png placeholder). Search cards carry no year —
        // year is filled at detail() from the .short-list. is_series from the URL
        // prefix (/series/, /cartoons/, /anime/ = multi-episode).
        parseSearch: function (html) {
            var self = this;
            var doc = htmlDoc(html);
            var out = [];
            var seen = {};

            var cards = doc.querySelectorAll('.short-item');
            for (var i = 0; i < cards.length; i++) {
                var card = cards[i];
                var a = card.querySelector('a.short-img') || card.querySelector('a[href]');
                var href = a ? absUrl(a.getAttribute('href'), self.baseUrl) : '';
                if (!href || seen[href]) continue;

                var tEl = card.querySelector('.th-title');
                var title = tEl ? tEl.textContent.replace(/\s+/g, ' ').trim() : '';
                if (!title) {
                    var img0 = card.querySelector('img');
                    title = img0 ? (img0.getAttribute('alt') || '').replace(/\s+/g, ' ').trim() : '';
                }
                if (!title) continue;
                seen[href] = true;

                var img = card.querySelector('.short-img img') || card.querySelector('img');
                var poster = img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';

                out.push({
                    title: title,
                    year: '',
                    url: href,
                    poster: poster ? absUrl(poster, self.baseUrl) : '',
                    is_series: self.isSeriesUrl(href)
                });
            }
            return out;
        },

        // Series content URLs live under /series/, /cartoons/ or /anime/ (movies are
        // /films/ or /fcartoon/). og:type is `article` for both → useless for typing;
        // the ashdi iframe path (/serial/ vs /vod/) is the authoritative fallback.
        isSeriesUrl: function (url) {
            url = '' + (url || '');
            return url.indexOf('/series/') >= 0 ||
                url.indexOf('/cartoons/') >= 0 ||
                url.indexOf('/anime/') >= 0;
        },

        // The player iframe uses an EAGER src on .fm (read data-src too, defensively).
        // Uniquely `ashdi.vip`; a YouTube trailer iframe may sit alongside → skipped.
        findPlayer: function (doc) {
            var box = doc.querySelector('iframe[src*="ashdi.vip"], iframe[data-src*="ashdi.vip"]');
            if (box) return box.getAttribute('src') || box.getAttribute('data-src') || '';
            // Fallback: any non-YouTube iframe.
            var ifs = doc.querySelectorAll('iframe');
            for (var i = 0; i < ifs.length; i++) {
                var s = ifs[i].getAttribute('src') || ifs[i].getAttribute('data-src') || '';
                if (s && !/youtu/i.test(s)) return s;
            }
            return '';
        },

        // Year from the `.short-list` meta row (label `Рік:`), else a `(YYYY)` in
        // the provided title text. '' when nothing is exposed.
        parseYear: function (doc, titleText) {
            var lis = doc.querySelectorAll('.short-list li');
            for (var i = 0; i < lis.length; i++) {
                var sp = lis[i].querySelector('span');
                if (sp && /Рік/i.test(sp.textContent || '')) {
                    var m = (lis[i].textContent || '').match(/(\d{4})/);
                    if (m) return m[1];
                }
            }
            var tm = ('' + (titleText || '')).match(/\((\d{4})\)/);
            return tm ? tm[1] : '';
        },

        // detail(url, ok, err) -> movie:  {is_series:false, playerUrl, title, year, poster, description}
        //                         series: {is_series:true,  voices:[…], title, year, poster, description}
        // Series mirrors uafilm: the nested playlist lives inside the ashdi /serial/
        // player, so detail() eagerly resolves it via extract() and returns voices.
        detail: function (url, ok, err) {
            var self = this;
            ok = ok || function () {};
            err = err || function () {};
            return net(url, { dataType: 'text', headers: self.headers() }, function (html) {
                var doc = htmlDoc(html);
                var ogTitle = metaContent(doc, 'og:title');

                var poster = absUrl(metaContent(doc, 'og:image'), self.baseUrl);

                var nameEl = doc.querySelector('h1.short-title .oname_ua') || doc.querySelector('h1.short-title') || doc.querySelector('h1');
                var title = nameEl ? nameEl.textContent.replace(/\s+/g, ' ').trim() : '';
                if (!title) {
                    // og:title wrappers: «…» inside "Фільм «…» YYYY українською онлайн".
                    var ogm = ogTitle.match(/[«"]([^»"]+)[»"]/);
                    title = ogm ? ogm[1].replace(/\s+/g, ' ').trim() : ogTitle.replace(/\s+/g, ' ').trim();
                }

                var descEl = doc.querySelector('.ftext.full-text');
                var description = descEl ? descEl.textContent.replace(/\s+/g, ' ').trim() : metaContent(doc, 'og:description');

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
                    if (!playerUrl) { ok(base); return; }
                    self.extract(playerUrl, function (data) {
                        base.voices = (data && data.voices) || [];
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

        // extract(target, ok, err) -> movie:  {url, quality, subtitles, poster}
        //                             series: {voices:[…]}  (nested ashdi playlist)
        // `target` may be a ready m3u8/mp4 (episode file → short-circuit) or an ashdi
        // player URL (/vod/ flat, /serial/ nested). Fetched with Referer uaserials.fm.
        extract: function (target, ok, err) {
            var self = this;
            ok = ok || function () {};
            err = err || function () {};
            if (!target) { err(); return; }

            if (/\.m3u8(\?|$)/.test(target) || /\.mp4(\?|$)/.test(target)) {
                ok({ url: target, quality: null, subtitles: [], poster: '' });
                return;
            }

            return net(target, { dataType: 'text', headers: self.headers() }, function (text) {
                var p = parsePlayerjs(text);

                if (p.playlist) {
                    var voices = playlistToVoices(p.playlist);
                    // Stamp season/episode indices so the component's per-episode
                    // watched-progress hash is unique (nested playlists carry no
                    // explicit numbering) — same as uafilm's series path.
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
                    ok({ voices: voices, poster: p.poster });
                    return;
                }

                // No stream in a resolved player. ashdi is a known geo-CDN host —
                // flag it so the component shows a clean region message instead of a
                // generic error (uaserials.fm is not geo-gated today, but a title or
                // region could withhold a stream and this keeps the UI consistent).
                if (!p.file) { err(isGeoHost(target) ? { geo: true } : undefined); return; }

                ok({ url: p.file, quality: null, subtitles: p.subtitles, poster: p.poster });
            }, err);
        }
    };

    // ─────────────────────────────────────────────────────────────
    // component(object) — the Lampa online screen:
    //   filter (source selector + per-source enabled toggles) -> search ->
    //   results list. With an empty SOURCES it shows a clean empty state and
    //   never crashes. Phase 1 wires src.search() results into this.draw().
    // ─────────────────────────────────────────────────────────────
    function component(object) {
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);
        var filter = new Lampa.Filter(object);
        var last;
        var last_request; // the in-flight source request (net()), cleared on reset/destroy
        var find_requests = []; // in-flight dual-title search requests (net()), cleared on reset/destroy

        // Background availability/quality probe (throttled, cached, cancelable).
        // At most PROBE_MAX net() chains run at once; results feed the card badges.
        var PROBE_MAX = 2;
        var probe_queue = [];        // [{key, item}] pending probes (focus-first reorders)
        var probe_inflight = {};     // key -> probeResolve handle (net() proxy), for cancel
        var probe_inflight_n = 0;    // in-flight count (decremented on ANY completion)
        var probe_cards = {};        // key -> latest card element to update on completion

        var source_keys = enabledSourceKeys();
        var active_source = Lampa.Storage.get(CONFIG.STORAGE.source, '') + '';
        if (source_keys.indexOf(active_source) === -1) {
            active_source = source_keys.length ? source_keys[0] : '';
        }

        // The component works in two modes and swaps the scroll contents in place:
        //   'search' — search-result cards (default)
        //   'series' — the chosen series' episode cards, with SEASON/VOICE moved
        //              into the Lampa.Filter (top bar / right menu). back returns
        //              to the results list rather than leaving the component.
        var comp = this;
        var mode = 'search';
        var results_items = null;   // last search results, for returning from series
        var series_item = null;     // the result item that opened series mode
        var series_detail = null;   // its detail() payload
        var series_voices = null;   // detail.voices
        var voice_index = 0;
        var season_index = 0;

        // Watched-progress hashes. Scoped by (source + content page url + title)
        // so they NEVER collide with Lampa core's per-card global timeline (which
        // is keyed on original_title alone) or with another source's stream — a
        // fresh, never-watched item therefore has Timeline.view(hash).time === 0.
        function movieHash(item) {
            var movie = object.movie || {};
            var base = movie.original_title || movie.title || (item && item.title) || '';
            return Lampa.Utils.hash([active_source, item ? item.url : '', base].join('#'));
        }
        function episodeHash(ep, season, voice) {
            var movie = object.movie || {};
            var base = movie.original_title || movie.title ||
                (series_detail && series_detail.title) || (series_item && series_item.title) || '';
            return Lampa.Utils.hash([
                active_source,
                series_item ? series_item.url : '',
                season ? season.title : '',
                ep.season, ep.episode,
                voice ? voice.title : '',
                base
            ].join('#'));
        }
        function episodeTitle(ep, season) {
            return (season && season.title ? season.title + ' ' : '') + ep.title + (ep.name ? ' — ' + ep.name : '');
        }
        function playError(reason) {
            return Lampa.Lang.translate(reason && reason.geo ? 'online_ua_geo' : 'online_ua_no_video');
        }

        // Build one result/episode card: poster (lazy, with broken-image
        // fallback) + title + info + quality + a watched progress bar. `hash`
        // (when given) drives the Timeline bar and a ✓ mark; pass null for
        // folder-like items (series results) that have no single stream.
        function makeCard(opts) {
            var card = Lampa.Template.get('online_ua_item', {
                title: opts.title || '',
                time: opts.time || '',
                info: opts.info || '',
                quality: opts.quality || ''
            });
            var image = card.find('.online-prestige__img');
            var loader = card.find('.online-prestige__loader');
            var img = image.find('img')[0];
            if (opts.poster && img) {
                img.onerror = function () { img.src = './img/img_broken.svg'; if (loader.length) loader.remove(); };
                img.onload = function () { image.addClass('online-prestige__img--loaded'); if (loader.length) loader.remove(); };
                img.src = opts.poster;
            } else if (loader.length) {
                loader.remove();
            }
            if (opts.hash) {
                var view = Lampa.Timeline.view(opts.hash);
                card.find('.online-prestige__timeline').append(Lampa.Timeline.render(view));
                if (Lampa.Timeline.details) card.find('.online-prestige__quality').append(Lampa.Timeline.details(view, ' / '));
                if (view.percent >= 90) image.append(
                    '<div class="online-prestige__viewed"><svg width="21" height="21" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                    '<circle cx="10.5" cy="10.5" r="9" stroke="currentColor" stroke-width="2"/>' +
                    '<path d="M6 11l3 3 6-6" stroke="currentColor" stroke-width="2" fill="none"/></svg></div>');
            }
            // Per-result badges row (search results only; episode cards pass none →
            // stays empty → hidden by CSS :empty). Fills the neutral checking state;
            // setCardBadges() swaps it once the async probe resolves.
            var badges = card.find('.online-prestige__badges');
            if (badges.length) badges.html(badgesHtml({
                availability: opts.availability || '',
                resolution: opts.resolution || '',
                type: opts.type || ''
            }));
            return card;
        }

        // ── background availability/quality probe (throttled + cached) ──
        function probeEnabled() {
            return Lampa.Storage.get(CONFIG.STORAGE.probe, true) !== false;
        }
        function probeKey(item) {
            return active_source + '|' + (item ? item.url : '');
        }

        // Enqueue a card's probe (cache-aware). Cache hit → paint immediately, no
        // request. Otherwise queue it; the drainer runs it under the concurrency cap.
        this.enqueueProbe = function (item, card) {
            if (!probeEnabled()) return;
            if (!this.source()) return;
            var key = probeKey(item);
            probe_cards[key] = card;
            if (PROBE_CACHE[key]) { setCardBadges(card, PROBE_CACHE[key]); return; }
            if (probe_inflight[key]) return;
            for (var i = 0; i < probe_queue.length; i++) if (probe_queue[i].key === key) return;
            probe_queue.push({ key: key, item: item });
            this.probeDrain();
        };

        // Focus-first: a highlighted row jumps to the front of the pending queue so
        // it resolves before off-screen rows. No-op if already cached/in-flight.
        this.probeFocus = function (item) {
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

        // Launch queued probes up to the concurrency cap. The completion callback
        // ALWAYS decrements the counter (probeResolve merges ok+err into one done),
        // caches the result, paints the card, then drains again → cannot deadlock.
        this.probeDrain = function () {
            var _this = this;
            var src = this.source();
            if (!src) return;
            while (probe_inflight_n < PROBE_MAX && probe_queue.length) {
                var job = probe_queue.shift();
                var key = job.key;
                if (PROBE_CACHE[key] || probe_inflight[key]) continue;
                probe_inflight[key] = true; // reserve the slot before the (maybe sync) call
                probe_inflight_n++;
                (function (key, item) {
                    var handle = probeResolve(src, item, function (result) {
                        if (!probe_inflight[key]) return; // cancelled/reset meanwhile
                        delete probe_inflight[key];
                        probe_inflight_n--;
                        // Cache ONLY 'ok' — never a 'no'/'unknown' (see probeCacheable):
                        // keeps a pre-VPN failure from sticking for the whole session.
                        if (probeCacheable(result)) PROBE_CACHE[key] = result;
                        var card = probe_cards[key];
                        if (card) setCardBadges(card, result);
                        _this.probeDrain();
                    });
                    if (probe_inflight[key]) probe_inflight[key] = handle; // unless done synchronously
                })(key, job.item);
            }
        };

        // Cancel every in-flight probe + empty the queue (the cache survives — it is
        // keyed per source, so it stays valid across search/source changes). Mirrors
        // how last_request is cleared; called from reset() and destroy().
        this.probeReset = function () {
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

        scroll.body().addClass('torrent-list');
        scroll.minus(files.render().find('.explorer__files-head'));

        // ── lifecycle ──
        this.create = function () {
            var _this = this;
            this.activity.loader(true);

            filter.onSearch = function (value) {
                Lampa.Activity.replace({ search: value, clarification: true });
            };
            filter.onBack = function () {
                _this.start();
            };
            filter.onSelect = function (type, a, b) {
                if (type == 'sort') {
                    _this.changeSource(a.source);
                } else if (type == 'filter') {
                    if (a.reset) {
                        if (mode === 'series') _this.backToResults();
                        else _this.search();
                    } else if (a.stype == 'enabled') {
                        _this.toggleSource(b.index);
                    } else if (a.stype == 'season') {
                        _this.selectSeason(b.index);
                    } else if (a.stype == 'voice') {
                        _this.selectVoice(b.index);
                    }
                }
            };

            filter.render().find('.filter--sort span').text(Lampa.Lang.translate('online_ua_source'));
            files.appendHead(filter.render());
            files.appendFiles(scroll.render());

            this.search();
            return this.render();
        };

        this.changeSource = function (id) {
            if (!id) return;
            active_source = id;
            Lampa.Storage.set(CONFIG.STORAGE.source, id);
            mode = 'search';
            this.search();
            setTimeout(this.closeFilter, 10);
        };

        this.toggleSource = function (idx) {
            var all = allSourceKeys();
            var id = all[idx];
            if (!id) return;
            Lampa.Storage.set(CONFIG.STORAGE.enabled_prefix + id, !sourceEnabled(id));
            source_keys = enabledSourceKeys();
            if (source_keys.indexOf(active_source) === -1) {
                active_source = source_keys.length ? source_keys[0] : '';
                Lampa.Storage.set(CONFIG.STORAGE.source, active_source);
            }
            this.search();
            setTimeout(this.closeFilter, 10);
        };

        this.search = function () {
            mode = 'search';
            this.activity.loader(true);
            this.buildFilter();
            this.reset();
            this.find();
        };

        // find() — build a normalized target from the opened card and search the
        // active source. When opened from a card we run TWO queries — the primary
        // (usually Ukrainian) title AND the original (usually Latin) title when it
        // differs — because a Ukrainian DLE site indexes one language better than
        // the other; the results are merged (dedup by url), ranked by title/year
        // similarity to the target, and lightly filtered so junk sinks/drops but
        // the list is never emptied. A manual free-text search (object.clarification)
        // is ranked by the typed text only and NOT filtered (show everything).
        this.find = function () {
            if (!source_keys.length) {
                this.empty(Lampa.Lang.translate('online_ua_no_sources'));
                return;
            }
            var src = SOURCES[active_source];
            if (!src || typeof src.search !== 'function') {
                this.empty(Lampa.Lang.translate('online_ua_no_sources'));
                return;
            }

            var movie = object.movie || {};
            var manual = !!object.clarification;
            var target = manual ? {
                title: ('' + (object.search || '')).trim(),
                original_title: '',
                year: ''
            } : {
                title: ('' + (movie.title || movie.name || '')).trim(),
                original_title: ('' + (movie.original_title || movie.original_name || '')).trim(),
                year: movieYear(movie)
            };

            var queries = [];
            function addQuery(q) {
                q = ('' + (q || '')).trim();
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
                this.empty(Lampa.Lang.translate('online_ua_no_results'));
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
                    // cf_blocked: the source's SEARCH endpoint sits behind a
                    // Cloudflare challenge (e.g. kinoukr) — say a proxy is
                    // needed for search rather than a generic failure.
                    var key = cf_blocked ? 'online_ua_cf' :
                        (errors === queries.length ? 'online_ua_error' : 'online_ua_no_results');
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
                (function (query) {
                    var req = src.search(query, function (items) {
                        collect(items);
                        settle(false);
                    }, function (reason) {
                        if (reason && reason.cf) cf_blocked = true;
                        settle(true);
                    });
                    if (req) find_requests.push(req);
                })(queries[qi]);
            }
        };

        // ── filter ──
        // In 'series' mode the "filter" dropdown (opened from the head / right
        // menu) carries SEASON and, when the series has more than one, VOICE
        // selectors; in 'search' mode it carries the per-source enable toggles.
        // The "sort" selector is always the source picker.
        this.buildFilter = function () {
            var select = [];
            select.push({
                title: Lampa.Lang.translate('torrent_parser_reset'),
                reset: true
            });

            if (mode === 'series' && series_voices && series_voices.length) {
                var voice = series_voices[voice_index] || series_voices[0];
                if (series_voices.length > 1) {
                    var vitems = [];
                    for (var vi = 0; vi < series_voices.length; vi++) {
                        vitems.push({
                            title: series_voices[vi].title || (Lampa.Lang.translate('online_ua_voice') + ' ' + (vi + 1)),
                            selected: vi === voice_index,
                            index: vi
                        });
                    }
                    select.push({
                        title: Lampa.Lang.translate('online_ua_voice'),
                        subtitle: voice.title || '',
                        items: vitems,
                        stype: 'voice'
                    });
                }
                var seasons = voice.seasons || [];
                if (seasons.length) {
                    var sitems = [];
                    for (var si = 0; si < seasons.length; si++) {
                        sitems.push({
                            title: seasons[si].title || (Lampa.Lang.translate('online_ua_season') + ' ' + (si + 1)),
                            selected: si === season_index,
                            index: si
                        });
                    }
                    select.push({
                        title: Lampa.Lang.translate('online_ua_season'),
                        subtitle: (seasons[season_index] ? seasons[season_index].title : ''),
                        items: sitems,
                        stype: 'season'
                    });
                }
            } else {
                // Per-source enabled toggles (only shown once sources exist).
                var all = allSourceKeys();
                if (all.length) {
                    var toggles = [];
                    for (var i = 0; i < all.length; i++) {
                        var id = all[i];
                        toggles.push({
                            title: (sourceEnabled(id) ? '✔ ' : '– ') + SOURCES[id].title,
                            index: i
                        });
                    }
                    select.push({
                        title: Lampa.Lang.translate('online_ua_sources_enable'),
                        subtitle: '',
                        items: toggles,
                        stype: 'enabled'
                    });
                }
            }
            filter.set('filter', select);

            // Source selector (the "sort" section, like the reference plugins).
            var sorts = [];
            for (var j = 0; j < source_keys.length; j++) {
                var sid = source_keys[j];
                sorts.push({
                    title: SOURCES[sid] ? SOURCES[sid].title : sid,
                    source: sid,
                    selected: sid === active_source
                });
            }
            filter.set('sort', sorts);

            this.selected();
        };

        this.selected = function () {
            var title = (active_source && SOURCES[active_source]) ?
                SOURCES[active_source].title :
                Lampa.Lang.translate('online_ua_no_sources');
            var chosen = [];
            if (mode === 'series' && series_voices && series_voices.length) {
                var voice = series_voices[voice_index] || series_voices[0];
                if (series_voices.length > 1 && voice.title) {
                    chosen.push(Lampa.Lang.translate('online_ua_voice') + ': ' + voice.title);
                }
                var seasons = voice.seasons || [];
                if (seasons.length && seasons[season_index]) {
                    chosen.push(Lampa.Lang.translate('online_ua_season') + ': ' +
                        (seasons[season_index].title || (season_index + 1)));
                }
            }
            filter.chosen('filter', chosen);
            filter.chosen('sort', [title]);
        };

        this.closeFilter = function () {
            if ($('body').hasClass('selectbox--open')) Lampa.Select.close();
        };

        // Cancel every in-flight dual-title search request (mirrors last_request).
        this.clearFindRequests = function () {
            for (var i = 0; i < find_requests.length; i++) {
                if (find_requests[i] && find_requests[i].clear) find_requests[i].clear();
            }
            find_requests = [];
        };

        // ── list state ──
        this.reset = function () {
            last = false;
            network.clear();
            if (last_request && last_request.clear) last_request.clear();
            this.clearFindRequests();
            this.probeReset();
            scroll.render().find('.empty').remove();
            scroll.clear();
            scroll.reset();
        };

        this.empty = function (msg) {
            var empty = Lampa.Template.get('list_empty');
            if (msg) empty.find('.empty__descr').text(msg);
            scroll.clear();
            scroll.append(empty);
            this.loading(false);
            // BUG B: the list_empty template is NOT a .selector, so the 'content'
            // controller has nothing focusable — the cursor is lost ("невідомо куди")
            // and the source selector in the head becomes unreachable. loading(false)
            // has just re-run start() → toggle('content') (which found nothing); now
            // move focus UP to the filter head where the source selector lives
            // (files.appendHead(filter.render())) so the user can switch source. Guard
            // on the active activity (mirrors start()) so we never steal focus from
            // another screen. When a chosen source returns results, draw() →
            // loading(false) → start() → toggle('content') restores first-row focus.
            if (Lampa.Activity.active().activity === this.activity) {
                Lampa.Controller.toggle('head');
            }
        };

        this.loading = function (status) {
            if (status) this.activity.loader(true);
            else {
                this.activity.loader(false);
                this.activity.toggle();
            }
        };

        // draw(items) — render the search-result cards into the scroll.
        // Source-agnostic: each item is {title, year, url, poster, is_series}
        // from src.search(). Movies get a watched bar keyed on movieHash(item)
        // (the SAME hash playMovie plays with); series are folders (no bar).
        this.draw = function (items) {
            var _this = this;
            mode = 'search';
            results_items = items;
            if (!items || !items.length) {
                this.empty(Lampa.Lang.translate('online_ua_no_results'));
                return;
            }

            last = false;
            scroll.clear();
            var enabled = probeEnabled();
            items.forEach(function (item) {
                var info = [];
                if (item.year) info.push(item.year);
                info.push(Lampa.Lang.translate(item.is_series ? 'online_ua_series' : 'online_ua_movie'));

                // Badge seed: probing ON → neutral circle now (or cached state if we
                // already probed this item this session); probing OFF → no circle,
                // only the coarse listing quality hint (if the source gave one).
                // Only 'ok' is ever cached (probeCacheable), so a cache HIT seeds the
                // green state now; a MISS seeds the neutral 'check' circle and enqueues
                // a fresh probe below (which can settle to ok / no / unknown).
                var cached = enabled ? PROBE_CACHE[probeKey(item)] : null;
                var hintQ = enabled ? { resolution: '', type: '' } : parseStreamQuality('', item.quality);
                var seed = cached ? {
                    availability: cached.state,
                    resolution: cached.quality.resolution,
                    type: cached.quality.type
                } : {
                    availability: enabled ? 'check' : '',
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
                card.on('hover:focus', function (e) {
                    last = e.target;
                    scroll.update($(e.target), true);
                    _this.probeFocus(item);
                });
                card.on('hover:enter', function () {
                    _this.onResult(item);
                });
                scroll.append(card);
                _this.enqueueProbe(item, card);
            });

            this.loading(false);
        };

        // ── playback flow (calls the Source interface only; source-agnostic) ──
        this.source = function () {
            return SOURCES[active_source];
        };

        this.onResult = function (item) {
            var _this = this;
            var src = this.source();
            if (!src) return;
            // Prefetch bonus: the background probe already resolved this movie's
            // playable stream — reuse it to start playback immediately (no re-fetch).
            // Series keep the normal detail() flow (probe caches no voices).
            if (!item.is_series) {
                var cached = PROBE_CACHE[probeKey(item)];
                if (cached && cached.state === 'ok' && cached.url) {
                    this.playMovieDirect(item, cached.url);
                    return;
                }
            }
            Lampa.Noty.show(Lampa.Lang.translate('online_ua_loading'));
            last_request = src.detail(item.url, function (d) {
                if (!d) { Lampa.Noty.show(Lampa.Lang.translate('online_ua_no_video')); return; }
                _this.onDetail(item, d);
            }, function () {
                Lampa.Noty.show(Lampa.Lang.translate('online_ua_error'));
            });
        };

        this.onDetail = function (item, d) {
            if (d.is_series && d.voices && d.voices.length) {
                this.openSeries(item, d);
            } else if (d.playerUrl) {
                this.playMovie(item, d);
            } else {
                Lampa.Noty.show(Lampa.Lang.translate('online_ua_no_video'));
            }
        };

        // Movie: resolve the player payload, then hand a single stream to the
        // player. No mode switch — movies play directly.
        this.playMovie = function (item, d) {
            var src = this.source();
            last_request = src.extract(d.playerUrl, function (data) {
                if (!data || !data.url) { Lampa.Noty.show(Lampa.Lang.translate('online_ua_no_video')); return; }
                var movie = object.movie || {};
                var title = movie.title || d.title || item.title;
                if (movie.id) Lampa.Favorite.add('history', movie, 100);
                var play = {
                    title: title,
                    url: data.url,
                    poster: data.poster || d.poster || item.poster || (movie.img || ''),
                    timeline: Lampa.Timeline.view(movieHash(item))
                };
                if (data.quality) play.quality = data.quality;
                if (data.subtitles && data.subtitles.length) play.subtitles = data.subtitles;
                Lampa.Player.play(play);
                Lampa.Player.playlist([play]);
            }, function (reason) {
                Lampa.Noty.show(playError(reason));
            });
        };

        // Prefetch play: a cached probe already resolved the movie stream url, so
        // play it straight away without a second detail()/extract() round-trip.
        this.playMovieDirect = function (item, url) {
            var movie = object.movie || {};
            var title = movie.title || item.title;
            if (movie.id) Lampa.Favorite.add('history', movie, 100);
            var play = {
                title: title,
                url: url,
                poster: item.poster || (movie.img || ''),
                timeline: Lampa.Timeline.view(movieHash(item))
            };
            Lampa.Player.play(play);
            Lampa.Player.playlist([play]);
        };

        // Series: switch the component into 'series' mode. The episode list is
        // rendered INLINE into the same scroll as the search results; SEASON and
        // (if >1) VOICE move into the Lampa.Filter. No Lampa.Select popups.
        this.openSeries = function (item, d) {
            mode = 'series';
            series_item = item;
            series_detail = d;
            series_voices = d.voices || [];
            voice_index = 0;
            season_index = 0;
            this.buildFilter();
            this.reset();
            this.drawEpisodes();
        };

        // Render the current voice+season's episodes into the scroll. Reused on
        // every season/voice switch so the list re-renders in place.
        this.drawEpisodes = function () {
            var _this = this;
            var voice = series_voices[voice_index] || series_voices[0];
            var seasons = (voice && voice.seasons) || [];
            var season = seasons[season_index] || seasons[0];
            var episodes = (season && season.episodes) || [];

            last = false;
            scroll.clear();
            if (!episodes.length) {
                this.empty(Lampa.Lang.translate('online_ua_no_video'));
                return;
            }

            episodes.forEach(function (ep, i) {
                var card = makeCard({
                    title: episodeTitle(ep, season),
                    info: ep.name || '',
                    poster: ep.poster || (series_detail && series_detail.poster) || '',
                    hash: episodeHash(ep, season, voice)
                });
                card.on('hover:focus', function (e) {
                    last = e.target;
                    scroll.update($(e.target), true);
                });
                card.on('hover:enter', function () {
                    _this.playEpisode(voice, season, episodes, i);
                });
                scroll.append(card);
            });

            this.loading(false);
        };

        this.selectSeason = function (idx) {
            season_index = idx;
            this.buildFilter();
            this.drawEpisodes();
            setTimeout(this.closeFilter, 10);
        };

        this.selectVoice = function (idx) {
            voice_index = idx;
            season_index = 0;
            this.buildFilter();
            this.drawEpisodes();
            setTimeout(this.closeFilter, 10);
        };

        // Play one episode and build a lazy auto-next playlist for the rest of
        // the season (each later episode resolves its stream on demand). Watched
        // marks / progress are keyed on episodeHash (matches the card's bar).
        this.playEpisode = function (voice, season, episodes, startIdx) {
            var _this = this;
            var movie = object.movie || {};
            if (movie.id) Lampa.Favorite.add('history', movie, 100);
            Lampa.Noty.show(Lampa.Lang.translate('online_ua_loading'));

            _this.resolveEpisode(episodes[startIdx], function (data) {
                if (!data || !data.url) { Lampa.Noty.show(Lampa.Lang.translate('online_ua_no_video')); return; }
                var first = {
                    title: episodeTitle(episodes[startIdx], season),
                    url: data.url,
                    poster: data.poster || episodes[startIdx].poster || (series_detail && series_detail.poster) || '',
                    timeline: Lampa.Timeline.view(episodeHash(episodes[startIdx], season, voice))
                };
                if (data.quality) first.quality = data.quality;
                if (data.subtitles && data.subtitles.length) first.subtitles = data.subtitles;

                Lampa.Player.play(first);

                var playlist = [];
                for (var i = startIdx; i < episodes.length; i++) {
                    (function (ep, isFirst) {
                        if (isFirst) { playlist.push(first); return; }
                        var cell = {
                            title: episodeTitle(ep, season),
                            poster: ep.poster || (series_detail && series_detail.poster) || '',
                            timeline: Lampa.Timeline.view(episodeHash(ep, season, voice)),
                            url: function (call) {
                                _this.resolveEpisode(ep, function (dd) {
                                    cell.url = (dd && dd.url) || '';
                                    if (dd && dd.quality) cell.quality = dd.quality;
                                    if (dd && dd.subtitles) cell.subtitles = dd.subtitles;
                                    call();
                                }, function () { cell.url = ''; call(); });
                            }
                        };
                        playlist.push(cell);
                    })(episodes[i], i === startIdx);
                }
                Lampa.Player.playlist(playlist);
            }, function (reason) {
                Lampa.Noty.show(playError(reason));
            });
        };

        // Leave 'series' mode and re-render the cached search results in place.
        this.backToResults = function () {
            mode = 'search';
            series_item = null;
            series_detail = null;
            series_voices = null;
            voice_index = 0;
            season_index = 0;
            this.reset();
            this.buildFilter();
            if (results_items) this.draw(results_items);
            else this.search();
        };

        // Resolve one episode to a playable stream via the Source interface.
        // Episodes carry either a ready `file` (nested playlist) or a `page`
        // (per-episode site — extract fetches the page then its player).
        this.resolveEpisode = function (ep, ok, err) {
            var src = this.source();
            if (!src || typeof src.extract !== 'function') { err(); return; }
            last_request = src.extract(ep.file || ep.page, ok, err);
        };

        // ── navigation ──
        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) return;
            if (object.movie) {
                Lampa.Background.immediately(Lampa.Utils.cardImgBackground(object.movie));
            }
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    Navigator.move('down');
                },
                right: function () {
                    if (Navigator.canmove('right')) Navigator.move('right');
                    else filter.show(Lampa.Lang.translate('title_filter'), 'filter');
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                back: this.back
            });
            Lampa.Controller.toggle('content');
        };

        this.render = function () {
            return files.render();
        };

        // In 'series' mode, back returns to the search-results list (staying in
        // the component); only in 'search' mode does it leave the component.
        this.back = function () {
            if (mode === 'series') comp.backToResults();
            else Lampa.Activity.backward();
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            network.clear();
            if (last_request && last_request.clear) last_request.clear();
            this.clearFindRequests();
            this.probeReset();
            files.destroy();
            scroll.destroy();
            network = null;
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Integration — open the component, inject the card button, manifest.
    // ─────────────────────────────────────────────────────────────
    function loadOnline(movie) {
        Lampa.Activity.push({
            url: '',
            title: Lampa.Lang.translate('online_ua_title'),
            component: CONFIG.PLUGIN_ID,
            search: movie.title,
            search_one: movie.title,
            search_two: movie.original_title,
            movie: movie,
            page: 1
        });
    }

    function initMain() {
        // Result / episode card: poster + title + info + quality + a watched
        // progress bar. Mirrors the reference plugins' "online-prestige" card so
        // the Timeline bar (.online-prestige__timeline > .time-line) and poster
        // inherit Lampa styling. The CSS below is self-contained (same rules the
        // BanderaOnline UA plugin ships) so the look never depends on core CSS.
        Lampa.Template.add('online_ua_item',
            '<div class="online-prestige online-prestige--full selector">' +
                '<div class="online-prestige__img">' +
                    '<img alt="">' +
                    '<div class="online-prestige__loader"></div>' +
                '</div>' +
                '<div class="online-prestige__body">' +
                    '<div class="online-prestige__head">' +
                        '<div class="online-prestige__title">{title}</div>' +
                        '<div class="online-prestige__time">{time}</div>' +
                    '</div>' +
                    '<div class="online-prestige__timeline"></div>' +
                    '<div class="online-prestige__footer">' +
                        '<div class="online-prestige__info">{info}</div>' +
                        '<div class="online-prestige__quality">{quality}</div>' +
                    '</div>' +
                    '<div class="online-prestige__badges"></div>' +
                '</div>' +
            '</div>');

        // CSS as a plain string (NOT via Template.get — that mangles the CSS
        // braces on some Lampa builds). Injected defensively so it can never
        // abort registration.
        var css = '<style id="online_ua_style">' +
            '.online-prestige{position:relative;border-radius:.3em;background-color:rgba(0,0,0,0.3);display:-webkit-box;display:-webkit-flex;display:flex;will-change:transform}' +
            '.online-prestige__body{padding:1.2em;line-height:1.3;-webkit-box-flex:1;-webkit-flex-grow:1;flex-grow:1;position:relative}' +
            '@media screen and (max-width:480px){.online-prestige__body{padding:.8em 1.2em}}' +
            '.online-prestige__img{position:relative;width:13em;-webkit-flex-shrink:0;flex-shrink:0;min-height:8.2em}' +
            '.online-prestige__img>img{position:absolute;top:0;left:0;width:100%;height:100%;-o-object-fit:cover;object-fit:cover;border-radius:.3em;opacity:0;-webkit-transition:opacity .3s;transition:opacity .3s}' +
            '.online-prestige__img--loaded>img{opacity:1}' +
            '@media screen and (max-width:480px){.online-prestige__img{width:7em;min-height:6em}}' +
            '.online-prestige__viewed{position:absolute;top:1em;left:1em;background:rgba(0,0,0,0.45);border-radius:100%;padding:.25em;font-size:.76em}' +
            '.online-prestige__viewed>svg{width:1.5em !important;height:1.5em !important}' +
            '.online-prestige__loader{position:absolute;top:50%;left:50%;width:2em;height:2em;margin-left:-1em;margin-top:-1em;background:url(./img/loader.svg) no-repeat center center;-webkit-background-size:contain;background-size:contain}' +
            '.online-prestige__head,.online-prestige__footer{display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-pack:justify;-webkit-justify-content:space-between;justify-content:space-between;-webkit-box-align:center;-webkit-align-items:center;align-items:center}' +
            '.online-prestige__timeline{margin:.8em 0}' +
            '.online-prestige__timeline>.time-line{display:block !important}' +
            '.online-prestige__title{font-size:1.7em;overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}' +
            '@media screen and (max-width:480px){.online-prestige__title{font-size:1.4em}}' +
            '.online-prestige__time{padding-left:2em}' +
            '.online-prestige__info{display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-align:center;-webkit-align-items:center;align-items:center}' +
            '.online-prestige__info>*{overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}' +
            '.online-prestige__quality{padding-left:1em;white-space:nowrap}' +
            '.online-prestige .online-prestige-split{font-size:.8em;margin:0 1em;-webkit-flex-shrink:0;flex-shrink:0}' +
            '.online-prestige__badges{display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-align:center;-webkit-align-items:center;align-items:center;-webkit-flex-wrap:wrap;flex-wrap:wrap;margin-top:.7em}' +
            '.online-prestige__badges:empty{display:none}' +
            '.online-prestige__badge{display:-webkit-inline-box;display:-webkit-inline-flex;display:inline-flex;-webkit-box-align:center;-webkit-align-items:center;align-items:center;margin-right:.6em;font-size:1.1em;line-height:1}' +
            '.online-prestige__badge--res,.online-prestige__badge--type{padding:.25em .55em;border-radius:.3em;background:rgba(255,255,255,0.14);white-space:nowrap;font-weight:600}' +
            '.online-prestige__avail>svg{width:1.5em;height:1.5em;display:block}' +
            '.online-prestige.focus::after{content:\'\';position:absolute;top:-0.6em;left:-0.6em;right:-0.6em;bottom:-0.6em;border-radius:.7em;border:solid .3em #fff;z-index:-1;pointer-events:none}' +
            '.online-prestige+.online-prestige{margin-top:1.5em}' +
            '</style>';
        function injectCSS() {
            try {
                if (typeof $ === 'undefined') return;
                if ($('#online_ua_style').length) return;
                $('body').append(css);
            } catch (e) {}
        }

        // ── CORE registration FIRST — must never be blocked by CSS/settings.
        // These are the only calls that make the card button appear; none of
        // them touch jQuery, so they can't throw on an early/odd load.
        Lampa.Component.add(CONFIG.PLUGIN_ID, component);

        Lampa.Manifest.plugins = {
            type: 'video',
            version: CONFIG.VERSION,
            name: CONFIG.NAME,
            description: Lampa.Lang.translate('online_ua_watch'),
            component: CONFIG.PLUGIN_ID,
            onContextMenu: function (movie) {
                return { name: Lampa.Lang.translate('online_ua_watch'), description: '' };
            },
            onContextLauch: function (movie) {
                loadOnline(movie);
            }
        };

        var button = '<div class="full-start__button selector view--online_ua" data-subtitle="' + CONFIG.NAME + ' ' + CONFIG.VERSION + '">' +
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M8 5v14l11-7z" fill="currentColor"/></svg>' +
            '<span>#{online_ua_watch}</span>' +
            '</div>';

        Lampa.Listener.follow('full', function (e) {
            if (e.type == 'complite') {
                injectCSS(); // styles guaranteed present by the time a card shows
                var render = e.object.activity.render();
                // Guard against double-adding the button on the same card.
                if (render.find('.view--online_ua').length) return;
                var btn = $(Lampa.Lang.translate(button));
                btn.on('hover:enter', function () {
                    loadOnline(e.data.movie);
                });
                var torrent = render.find('.view--torrent');
                if (torrent.length) torrent.after(btn);
                else render.find('.full-start__buttons').append(btn);
            }
        });

        injectCSS(); // best-effort now; also retried lazily above
    }

    // ─────────────────────────────────────────────────────────────
    // Settings — a single optional fallback-proxy input. Nothing else.
    // Wrapped in try/catch so a settings issue can never break the plugin.
    // ─────────────────────────────────────────────────────────────
    function initSettings() {
        try {
            Lampa.SettingsApi.addComponent({
                component: CONFIG.PLUGIN_ID,
                name: CONFIG.NAME,
                icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                    '<rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" stroke-width="2"/>' +
                    '<path d="M10 9l5 3-5 3V9z" fill="currentColor"/></svg>'
            });
            Lampa.SettingsApi.addParam({
                component: CONFIG.PLUGIN_ID,
                param: {
                    name: CONFIG.STORAGE.proxy,
                    type: 'input',
                    values: '',
                    'default': ''
                },
                field: {
                    name: Lampa.Lang.translate('online_ua_proxy'),
                    description: Lampa.Lang.translate('online_ua_proxy_desc')
                },
                onChange: function () {
                    // Value is auto-persisted to Storage and read fresh in net();
                    // no re-render needed here.
                }
            });
            // Availability + quality probe toggle (default ON). When OFF the search
            // screen does zero probing (no network): cards show no availability
            // circle and only the coarse listing quality hint, if any.
            Lampa.SettingsApi.addParam({
                component: CONFIG.PLUGIN_ID,
                param: {
                    name: CONFIG.STORAGE.probe,
                    type: 'trigger',
                    'default': true
                },
                field: {
                    name: Lampa.Lang.translate('online_ua_probe_title'),
                    description: Lampa.Lang.translate('online_ua_probe_desc')
                },
                onChange: function () {
                    // Read fresh via Storage on the next search; nothing to re-render.
                }
            });
        } catch (e) {
            console.log('online_ua', 'settings init failed', e);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Localisation (uk / en / ru).
    // ─────────────────────────────────────────────────────────────
    function initLang() {
        Lampa.Lang.add({
            online_ua_title: {
                uk: 'UA Онлайн',
                en: 'UA Online',
                ru: 'UA Онлайн'
            },
            online_ua_watch: {
                uk: 'Дивитися (UA)',
                en: 'Watch (UA)',
                ru: 'Смотреть (UA)'
            },
            online_ua_source: {
                uk: 'Джерело',
                en: 'Source',
                ru: 'Источник'
            },
            online_ua_sources_enable: {
                uk: 'Увімкнені джерела',
                en: 'Enabled sources',
                ru: 'Включённые источники'
            },
            online_ua_no_sources: {
                uk: 'Джерела ще не додані',
                en: 'No sources added yet',
                ru: 'Источники ещё не добавлены'
            },
            online_ua_not_implemented: {
                uk: 'Джерело ще не реалізовано',
                en: 'Source not implemented yet',
                ru: 'Источник ещё не реализован'
            },
            online_ua_no_results: {
                uk: 'Нічого не знайдено',
                en: 'Nothing found',
                ru: 'Ничего не найдено'
            },
            online_ua_loading: {
                uk: 'Завантаження…',
                en: 'Loading…',
                ru: 'Загрузка…'
            },
            online_ua_error: {
                uk: 'Помилка з’єднання',
                en: 'Connection error',
                ru: 'Ошибка соединения'
            },
            online_ua_no_video: {
                uk: 'Відео недоступне',
                en: 'Video unavailable',
                ru: 'Видео недоступно'
            },
            online_ua_geo: {
                uk: 'Недоступно у вашому регіоні. Вкажіть UA-проксі в налаштуваннях.',
                en: 'Unavailable in your region. Set a UA proxy in settings.',
                ru: 'Недоступно в вашем регионе. Укажите UA-прокси в настройках.'
            },
            online_ua_cf: {
                uk: 'Пошук на цьому джерелі заблоковано захистом сайту. Вкажіть проксі в налаштуваннях.',
                en: 'Search on this source is blocked by the site\'s protection. Set a proxy in settings.',
                ru: 'Поиск на этом источнике заблокирован защитой сайта. Укажите прокси в настройках.'
            },
            online_ua_movie: {
                uk: 'Фільм',
                en: 'Movie',
                ru: 'Фильм'
            },
            online_ua_series: {
                uk: 'Серіал',
                en: 'Series',
                ru: 'Сериал'
            },
            online_ua_voice: {
                uk: 'Озвучення',
                en: 'Voice',
                ru: 'Озвучка'
            },
            online_ua_season: {
                uk: 'Сезон',
                en: 'Season',
                ru: 'Сезон'
            },
            online_ua_min: {
                uk: 'хв',
                en: 'min',
                ru: 'мин'
            },
            online_ua_proxy: {
                uk: 'Проксі (необов’язково)',
                en: 'Proxy (optional)',
                ru: 'Прокси (необязательно)'
            },
            online_ua_proxy_desc: {
                uk: 'Необов’язковий запасний CORS-проксі. Використовується лише якщо пряме з’єднання та вбудовані проксі не спрацювали. Залиште порожнім, якщо не впевнені.',
                en: 'Optional fallback CORS proxy. Used only if the direct connection and the built-in proxies fail. Leave empty if unsure.',
                ru: 'Необязательный запасной CORS-прокси. Используется, только если прямое соединение и встроенные прокси не сработали. Оставьте пустым, если не уверены.'
            },
            online_ua_probe_title: {
                uk: 'Показувати доступність і якість у пошуку',
                en: 'Show availability & quality in search',
                ru: 'Показывать доступность и качество в поиске'
            },
            online_ua_probe_desc: {
                uk: 'Перевіряє кожен результат у фоні й показує на картці кружечок доступності (зелений — грає, червоний — недоступно/гео-блок) та якість (роздільність і тип). Вимкніть, щоб не робити зайвих запитів.',
                en: 'Checks each result in the background and shows an availability circle (green plays, red unavailable/geo-blocked) and quality (resolution + type) on the card. Turn off to avoid the extra requests.',
                ru: 'Проверяет каждый результат в фоне и показывает на карточке кружок доступности (зелёный — играет, красный — недоступно/гео-блок) и качество (разрешение и тип). Отключите, чтобы не делать лишних запросов.'
            },
            online_ua_available: {
                uk: 'Доступно',
                en: 'Available',
                ru: 'Доступно'
            },
            online_ua_unavailable: {
                uk: 'Недоступно',
                en: 'Unavailable',
                ru: 'Недоступно'
            },
            online_ua_checking: {
                uk: 'Перевірка…',
                en: 'Checking…',
                ru: 'Проверка…'
            },
            online_ua_unknown: {
                uk: 'Не вдалося перевірити',
                en: 'Couldn’t verify',
                ru: 'Не удалось проверить'
            }
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Startup — after the app is ready (mirrors the reference plugins).
    // ─────────────────────────────────────────────────────────────
    function startPlugin() {
        // Each step isolated: a failure in one (e.g. settings on an older
        // Lampa) must never abort the others, and must never bubble up to
        // Lampa's plugin loader (which would show "failed to load plugin").
        // Order: Lang → Main (core: component/manifest/button) → Settings.
        try { initLang(); } catch (e) { logErr('lang', e); }
        try { initMain(); } catch (e) { logErr('main', e); }
        try { initSettings(); } catch (e) { logErr('settings', e); }
    }

    function logErr(where, e) {
        try { console.log('online_ua init ' + where + ' failed:', e && e.message); } catch (x) {}
    }

    // Register immediately, exactly like the reference plugins (online_mod
    // calls startPlugin() unconditionally at load). Do NOT gate on
    // window.appready: some Lampa builds never set it truthy, and for a
    // URL-added plugin the 'app'→'ready' event has ALREADY fired by load time —
    // the old guard left the plugin registered-but-inert (loads OK, red "!",
    // no card button). Registration only needs Lampa to exist, which it does
    // by the time this script runs. The window.online_ua_plugin guard at the
    // top already prevents this IIFE from ever running twice.
    startPlugin();

})();
