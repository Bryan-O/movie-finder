(() => {
  "use strict";

  // ---------- Constants ----------
  const API = "https://api.themoviedb.org/3";
  const IMG = "https://image.tmdb.org/t/p/";
  // "Available right now" = included with a subscription, free, or free with ads.
  const STREAM_TYPES = ["flatrate", "free", "ads"];
  const TYPE_LABEL = { flatrate: "Subscription", free: "Free", ads: "Free with ads" };
  const TOP_SERVICES = 14;
  // Rent/buy stores and add-on channel duplicates (e.g. "HBO Max Amazon Channel")
  // clutter the service picker; the main service is listed on its own.
  const HIDDEN_SERVICE = /(Channel|Store|with Ads)$|^Amazon Video$|Google Play|Fandango|Microsoft Store/i;
  const CURRENT_YEAR = new Date().getFullYear();
  const TODAY = new Date().toISOString().slice(0, 10);

  const KINDS = { movie: { one: "movie", many: "movies", emoji: "🎬" }, tv: { one: "show", many: "TV shows", emoji: "📺" } };

  // Moods are written in TMDB movie genre ids; TV equivalents are derived below.
  const MOODS = [
    { id: "laugh", emoji: "😂", label: "Make me laugh", genres: [35], without: [27, 53] },
    { id: "cozy", emoji: "🛋️", label: "Cozy & comforting", genres: [10751, 16, 35], without: [27, 53, 80, 10752] },
    { id: "thrill", emoji: "💥", label: "Adrenaline rush", genres: [28, 53] },
    { id: "scary", emoji: "😱", label: "Scare me", genres: [27] },
    { id: "romance", emoji: "💘", label: "Swoon-worthy", genres: [10749] },
    { id: "mind", emoji: "🧠", label: "Mind-bending", genres: [878, 9648] },
    { id: "cry", emoji: "😭", label: "A good cry", genres: [18], without: [35, 27], extra: { "vote_average.gte": 7 } },
    { id: "escape", emoji: "🌍", label: "Epic escape", genres: [12, 14] },
    { id: "crime", emoji: "🕵️", label: "Whodunit", genres: [80, 9648] },
    { id: "learn", emoji: "📚", label: "Learn something", genres: [99, 36] },
    { id: "acclaimed", emoji: "🏆", label: "Critics' darlings", genres: [], extra: { "vote_average.gte": 7.8, "vote_count.gte": 1500 } },
  ];
  const MOOD = Object.fromEntries(MOODS.map((m) => [m.id, m]));

  // TMDB's TV genres differ from movie genres. Map each movie genre to its TV
  // counterpart(s); horror and romance have no TV genre, so use keywords instead.
  const MOVIE_TO_TV = {
    28: [10759], 12: [10759], 16: [16], 35: [35], 80: [80], 99: [99], 18: [18], 10751: [10751, 10762],
    14: [10765], 36: [99], 27: [], 10402: [], 9648: [9648], 10749: [], 878: [10765], 53: [9648, 80],
    10752: [10768], 37: [37],
  };
  // Looser mappings shouldn't be used to *exclude* shows (e.g. "no thrillers" mustn't drop every crime show).
  const LOOSE_FOR_EXCLUDE = new Set([53, 36]);
  const GENRE_KEYWORD = { 27: "horror", 10749: "romance" };
  // News and talk shows clutter TV browsing.
  const TV_ALWAYS_WITHOUT = [10763, 10767];

  // ---------- Small helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const year = (d) => (d ? d.slice(0, 4) : "");
  const uniq = (a) => [...new Set(a)];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const store = {
    get(k, d) { try { const v = localStorage.getItem("ss." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("ss." + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem("ss." + k); } catch { /* storage unavailable */ } },
  };

  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
    });
    await Promise.all(workers);
    return out;
  }

  // Movies and shows use different field names; give them one shape.
  const norm = (m, kind) => ({ ...m, kind, title: m.title || m.name || "", date: m.release_date || m.first_air_date || "" });

  // ---------- TMDB API ----------
  const PROXY = (window.STREAMSCOUT_CONFIG || {}).proxy || "";
  // Use the server-side proxy when the site is deployed with one; otherwise
  // fall back to a key the visitor pastes in (stored only in their browser).
  let useProxy = !!PROXY;
  const apiKey = () => (useProxy ? "proxy" : store.get("key", ""));

  class KeyError extends Error {}

  async function tmdb(path, params = {}) {
    if (useProxy) {
      const url = new URL(PROXY, location.href);
      url.searchParams.set("path", path);
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
      }
      let res = null;
      try { res = await fetch(url, { headers: { accept: "application/json" } }); } catch { /* no proxy here */ }
      const isJson = res && (res.headers.get("content-type") || "").includes("json");
      if (res && isJson) {
        if (res.status === 401 || res.status === 500) throw new KeyError("server");
        if (!res.ok) throw new Error("TMDB request failed (" + res.status + ")");
        return res.json();
      }
      // No proxy on this host (e.g. a plain static server): switch to key mode.
      useProxy = false;
    }
    const key = store.get("key", "");
    if (!key) throw new KeyError("missing");
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
    const headers = { accept: "application/json" };
    // v4 read-access tokens are JWTs; v3 keys are 32-char hex strings.
    if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;
    else url.searchParams.set("api_key", key);
    const res = await fetch(url, { headers });
    if (res.status === 401) throw new KeyError("rejected");
    if (!res.ok) throw new Error("TMDB request failed (" + res.status + ")");
    return res.json();
  }

  const cache = new Map();
  function cached(path, params = {}) {
    const k = path + "?" + JSON.stringify(params);
    if (!cache.has(k)) cache.set(k, tmdb(path, params).catch((e) => { cache.delete(k); throw e; }));
    return cache.get(k);
  }

  // Streaming options for a title in the current region, best-known services first.
  async function streamingFor(kind, id) {
    const data = await cached(`/${kind}/${id}/watch/providers`);
    return pickStreaming(data);
  }
  function pickStreaming(data) {
    const r = data && data.results && data.results[state.region];
    if (!r) return { list: [], link: null };
    const seen = new Map();
    for (const t of STREAM_TYPES) {
      for (const p of r[t] || []) if (!seen.has(p.provider_id)) seen.set(p.provider_id, { ...p, type: t });
    }
    const list = [...seen.values()].sort((a, b) => a.display_priority - b.display_priority);
    // Put the user's own services first.
    if (state.services.size) list.sort((a, b) => state.services.has(b.provider_id) - state.services.has(a.provider_id));
    return { list, link: r.link };
  }

  async function keywordId(name) {
    const data = await cached("/search/keyword", { query: name });
    const hit = (data.results || []).find((k) => k.name.toLowerCase() === name) || (data.results || [])[0];
    return hit ? hit.id : null;
  }

  // Translate movie genre ids into discover filters for the given kind.
  function genresFor(kind, ids, forExclude = false) {
    if (kind === "movie") return { genres: ids.slice(), keywords: [] };
    const genres = [], keywords = [];
    for (const g of ids) {
      if (GENRE_KEYWORD[g]) keywords.push(GENRE_KEYWORD[g]);
      else if (!(forExclude && LOOSE_FOR_EXCLUDE.has(g))) genres.push(...(MOVIE_TO_TV[g] || []));
    }
    return { genres: uniq(genres), keywords: uniq(keywords) };
  }
  const keywordIds = async (names) => (await Promise.all(names.map((n) => keywordId(n).catch(() => null)))).filter(Boolean);

  // ---------- State ----------
  const state = {
    region: store.get("region", (navigator.language.split("-")[1] || "US").toUpperCase()),
    services: new Set(store.get("services", [])),
    kind: store.get("kind", "movie") === "tv" ? "tv" : "movie",
    mood: null,
    genre: "",
    sort: "popularity.desc",
    query: "",
    page: 0,
    totalPages: 0,
    genres: { movie: [], tv: [] },
    providers: [],
    showAllServices: false,
    req: 0,
  };

  // ---------- Elements ----------
  const el = {
    region: $("#region"), kind: $("#kind"), moods: $("#moods"), services: $("#services"), genre: $("#genre"), sort: $("#sort"),
    q: $("#q"), searchForm: $("#search-form"), reset: $("#reset"), grid: $("#grid"), status: $("#status"),
    more: $("#more"), setup: $("#setup"), keyForm: $("#key-form"), keyInput: $("#key-input"), keyError: $("#key-error"),
    forgetKey: $("#forget-key"), details: $("#details"), detailsBody: $("#details-body"),
    buddy: $("#buddy"), buddyBody: $("#buddy-body"), buddyOpen: $("#buddy-open"),
  };

  // ---------- Rendering: filters ----------
  function renderKind() {
    el.kind.querySelectorAll("[data-kind]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.kind === state.kind));
    el.q.placeholder = state.kind === "tv" ? "Search a TV show…" : "Search a movie title…";
  }

  function renderMoods() {
    el.moods.innerHTML = MOODS.map((m) =>
      `<button type="button" class="chip" data-mood="${m.id}" aria-pressed="${state.mood === m.id}">${m.emoji} ${esc(m.label)}</button>`
    ).join("");
  }

  function renderGenres() {
    el.genre.innerHTML = `<option value="">Any genre</option>` +
      state.genres[state.kind].map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
    el.genre.value = state.genre;
  }

  function renderServices() {
    const all = state.providers;
    // Always show selected services, plus the most popular ones.
    const shown = state.showAllServices ? all : all.filter((p, i) => i < TOP_SERVICES || state.services.has(p.provider_id));
    el.services.innerHTML = shown.map((p) =>
      `<button type="button" class="chip" data-service="${p.provider_id}" aria-pressed="${state.services.has(p.provider_id)}" title="${esc(p.provider_name)}">` +
      (p.logo_path ? `<img src="${IMG}w45${p.logo_path}" alt="" loading="lazy">` : "") +
      `${esc(p.provider_name)}</button>`
    ).join("") +
      (all.length > TOP_SERVICES ? `<button type="button" class="link-btn" data-toggle-services>${state.showAllServices ? "Show fewer" : `+${all.length - shown.length} more`}</button>` : "") +
      (state.services.size ? `<button type="button" class="link-btn" data-clear-services>Clear</button>` : "");
  }

  async function loadRegionData() {
    const [regions, movieProv, tvProv, movieGenres, tvGenres] = await Promise.all([
      cached("/watch/providers/regions"),
      cached("/watch/providers/movie", { watch_region: state.region }),
      cached("/watch/providers/tv", { watch_region: state.region }),
      cached("/genre/movie/list"),
      cached("/genre/tv/list"),
    ]);
    const rs = (regions.results || []).sort((a, b) => a.english_name.localeCompare(b.english_name));
    if (!rs.some((r) => r.iso_3166_1 === state.region)) state.region = "US";
    el.region.innerHTML = rs.map((r) => `<option value="${r.iso_3166_1}" ${r.iso_3166_1 === state.region ? "selected" : ""}>${esc(r.english_name)}</option>`).join("");

    // One service list covering both movies and shows.
    const byId = new Map();
    for (const p of [...(movieProv.results || []), ...(tvProv.results || [])]) {
      if (HIDDEN_SERVICE.test(p.provider_name)) continue;
      const prio = (p.display_priorities && p.display_priorities[state.region]) ?? p.display_priority;
      const prev = byId.get(p.provider_id);
      if (!prev || prio < prev.prio) byId.set(p.provider_id, { ...p, prio });
    }
    state.providers = [...byId.values()].sort((a, b) => a.prio - b.prio);
    // Drop saved services that don't exist in this region.
    state.services = new Set([...state.services].filter((id) => byId.has(id)));
    renderServices();

    state.genres = { movie: movieGenres.genres || [], tv: tvGenres.genres || [] };
    renderGenres();
  }

  // ---------- Rendering: results ----------
  const keyOf = (m) => `${m.kind}-${m.id}`;

  function cardHTML(m) {
    const poster = m.poster_path
      ? `<img src="${IMG}w342${m.poster_path}" alt="" loading="lazy">`
      : `<div class="noimg">${KINDS[m.kind].emoji}</div>`;
    const rating = m.vote_count > 10 ? `<span class="rating">★ ${m.vote_average.toFixed(1)}</span>` : "";
    return `<button type="button" class="card" data-id="${m.id}" data-kind="${m.kind}">
      <div class="poster">${poster}${rating}</div>
      <div class="card-body">
        <div class="card-title">${esc(m.title)}</div>
        <div class="card-year">${year(m.date)}</div>
        <div class="logos" data-logos="${keyOf(m)}"><span class="skeleton" style="width:60px;height:24px;border-radius:6px"></span></div>
      </div>
    </button>`;
  }

  function logosHTML(list) {
    const max = 4;
    return list.slice(0, max).map((p) => `<img src="${IMG}w45${p.logo_path}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)} (${TYPE_LABEL[p.type]})" loading="lazy">`).join("") +
      (list.length > max ? `<span class="more">+${list.length - max}</span>` : "");
  }

  function appendCards(items) {
    el.grid.insertAdjacentHTML("beforeend", items.map(({ m }) => cardHTML(m)).join(""));
    for (const { m, s } of items) {
      const fill = (st) => { const slot = el.grid.querySelector(`[data-logos="${keyOf(m)}"]`); if (slot) slot.innerHTML = logosHTML(st.list); };
      if (s) fill(s);
      else streamingFor(m.kind, m.id).then(fill).catch(() => fill({ list: [] }));
    }
  }

  function skeletons(n) {
    el.grid.insertAdjacentHTML("beforeend", Array.from({ length: n }, () =>
      `<div class="card" data-skeleton><div class="poster skeleton"></div><div class="card-body"><div class="skeleton" style="height:14px;border-radius:4px"></div><div class="skeleton" style="height:12px;width:40%;border-radius:4px"></div></div></div>`
    ).join(""));
  }
  const clearSkeletons = () => el.grid.querySelectorAll("[data-skeleton]").forEach((n) => n.remove());

  // ---------- Querying ----------
  function moodFilter(m) {
    const mood = state.mood && MOOD[state.mood];
    if (!mood) return true;
    const want = genresFor(m.kind, mood.genres).genres;
    const avoid = genresFor(m.kind, mood.without || [], true).genres;
    // Keyword-only moods (e.g. horror shows) can't be checked from search results.
    if (want.length && !m.genre_ids.some((g) => want.includes(g))) return false;
    if (avoid.some((g) => m.genre_ids.includes(g))) return false;
    return true;
  }

  async function discoverParams(page) {
    const kind = state.kind;
    const mood = state.mood && MOOD[state.mood];
    const tv = kind === "tv";
    const p = {
      watch_region: state.region,
      with_watch_monetization_types: STREAM_TYPES.join("|"),
      with_watch_providers: [...state.services].join("|"),
      include_adult: false,
      page,
      sort_by: state.sort === "random" ? "popularity.desc" : state.sort,
      "vote_count.gte": state.sort === "vote_average.desc" ? (tv ? 150 : 300) : state.sort === "primary_release_date.desc" ? 10 : (tv ? 20 : 50),
    };
    if (state.sort === "primary_release_date.desc") {
      if (tv) { p.sort_by = "first_air_date.desc"; p["first_air_date.lte"] = TODAY; }
      else p["primary_release_date.lte"] = TODAY;
    }
    const want = mood ? genresFor(kind, mood.genres) : { genres: [], keywords: [] };
    const avoid = mood ? genresFor(kind, mood.without || [], true) : { genres: [], keywords: [] };
    // A specific genre wins over a mood's genre set (moods are a quick preset).
    if (state.genre) p.with_genres = state.genre;
    else if (want.genres.length) p.with_genres = want.genres.join("|");
    else if (want.keywords.length) p.with_keywords = (await keywordIds(want.keywords)).join("|");
    const without = uniq([...avoid.genres, ...(tv ? TV_ALWAYS_WITHOUT : [])]).filter((g) => String(g) !== state.genre);
    if (without.length) p.without_genres = without.join(",");
    if (avoid.keywords.length) p.without_keywords = (await keywordIds(avoid.keywords)).join(",");
    if (mood && mood.extra) {
      Object.assign(p, mood.extra);
      if (tv && p["vote_count.gte"] > 300) p["vote_count.gte"] = Math.round(p["vote_count.gte"] / 3);
    }
    return p;
  }

  async function run(reset = true) {
    if (!apiKey()) return showSetup();
    const req = ++state.req;
    if (reset) {
      state.page = 0; state.totalPages = 0; el.grid.innerHTML = "";
      if (state.sort === "random" && !state.query) state.page = Math.floor(Math.random() * 6);
    }
    const K = KINDS[state.kind];
    el.more.hidden = true;
    el.status.textContent = state.query ? `Checking where "${state.query}" is streaming…` : `Finding ${K.many} you can stream right now…`;
    skeletons(reset ? 12 : 6);
    try {
      let items;
      if (state.query) items = await searchPage(req, state.kind);
      else items = await discoverPage(req);
      if (req !== state.req) return;
      clearSkeletons();
      if (state.sort === "random" && !state.query) shuffle(items);
      appendCards(items);
      const count = el.grid.querySelectorAll(".card").length;
      const onMine = state.services.size ? " on your services" : "";
      if (!count) {
        el.status.textContent = state.query
          ? `No streaming ${K.many} found for "${state.query}"${onMine} in ${regionName()}. It might only be in theaters or for rent right now.`
          : "Nothing matches those filters. Try another mood or fewer filters.";
        if (state.query && reset) suggestOtherKind(req);
      } else {
        el.status.textContent = state.query
          ? `${count} ${count === 1 ? K.one : K.many} for "${state.query}" streaming now${onMine} in ${regionName()}`
          : `${K.many[0].toUpperCase() + K.many.slice(1)} streaming now${onMine} in ${regionName()}`;
      }
      el.more.hidden = state.page >= state.totalPages;
    } catch (e) {
      if (req !== state.req) return;
      clearSkeletons();
      handleError(e);
    }
  }

  // Searched "Breaking Bad" while on Movies? Offer to switch.
  async function suggestOtherKind(req) {
    const other = state.kind === "movie" ? "tv" : "movie";
    try {
      const data = await tmdb(`/search/${other}`, { query: state.query, page: 1, include_adult: false });
      const top = data.results.slice(0, 8).map((m) => norm(m, other));
      const checked = await mapLimit(top, 8, async (m) => (await streamingFor(other, m.id).catch(() => ({ list: [] }))).list.length);
      const n = checked.filter(Boolean).length;
      if (req !== state.req || !n) return;
      el.status.innerHTML = `${esc(el.status.textContent)} <button type="button" class="link-btn" data-switch-kind="${other}">But ${n} ${n === 1 ? KINDS[other].one : KINDS[other].many} match. Show ${KINDS[other].many} →</button>`;
    } catch { /* suggestion is best-effort */ }
  }

  async function discoverPage(req) {
    let page = state.page + 1;
    const path = `/discover/${state.kind}`;
    let data = await tmdb(path, await discoverParams(page));
    // "Surprise me" picks a random starting page; fall back if it overshoots.
    if (!data.results.length && page > 1 && data.total_pages > 0 && reqFresh(req) && state.sort === "random") {
      page = 1 + Math.floor(Math.random() * Math.min(data.total_pages, 5));
      data = await tmdb(path, await discoverParams(page));
    }
    state.page = page;
    state.totalPages = Math.min(data.total_pages || 0, 500);
    return data.results.map((m) => ({ m: norm(m, state.kind) }));
  }
  const reqFresh = (req) => req === state.req;

  // Search results aren't filtered by availability on TMDB's side, so check each
  // title's providers and keep only what's streaming now. Keep fetching pages
  // until there's a decent handful (or we've looked far enough).
  async function searchPage(req, kind) {
    const hits = [];
    let looked = 0;
    while (hits.length < 8 && looked < 3 && (state.page === 0 || state.page < state.totalPages)) {
      const page = state.page + 1;
      const data = await tmdb(`/search/${kind}`, { query: state.query, page, include_adult: false });
      if (!reqFresh(req)) return [];
      state.page = page;
      state.totalPages = data.total_pages || 0;
      looked++;
      const candidates = data.results.map((m) => norm(m, kind))
        .filter((m) => (!state.genre || m.genre_ids.includes(+state.genre)) && moodFilter(m));
      const checked = await mapLimit(candidates, 8, async (m) => ({ m, s: await streamingFor(kind, m.id).catch(() => ({ list: [] })) }));
      for (const x of checked) {
        const ok = x.s.list.length && (!state.services.size || x.s.list.some((p) => state.services.has(p.provider_id)));
        if (ok) hits.push(x);
      }
    }
    return hits;
  }

  const regionName = () => (el.region.selectedOptions[0] && el.region.selectedOptions[0].textContent) || state.region;

  function handleError(e) {
    if (e instanceof KeyError) {
      if (e.message === "server") { el.status.textContent = "The movie database isn't configured yet. (Site owner: set TMDB_API_KEY in Vercel and redeploy.)"; return; }
      store.del("key");
      showSetup(e.message === "rejected" ? "That key was rejected by TMDB. Double-check and try again." : "");
      return;
    }
    console.error(e);
    el.status.textContent = "Something went wrong talking to the movie database. Please try again in a moment.";
  }

  // ---------- Setup (only when no key is configured for the site) ----------
  function showSetup(msg = "") {
    el.setup.hidden = false;
    el.keyError.hidden = !msg;
    el.keyError.textContent = msg;
    el.status.textContent = "";
    el.grid.innerHTML = "";
    el.more.hidden = true;
  }

  el.keyForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const key = el.keyInput.value.trim();
    if (!key) return;
    store.set("key", key);
    el.setup.hidden = true;
    el.forgetKey.hidden = false;
    await start();
  });
  el.forgetKey.addEventListener("click", () => { store.del("key"); cache.clear(); el.forgetKey.hidden = true; showSetup(); });

  // ---------- Details modal ----------
  function hm(mins) { return mins ? (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`) : ""; }

  async function openDetails(kind, id) {
    el.detailsBody.innerHTML = `<div class="spinner"></div>`;
    if (!el.details.open) el.details.showModal();
    try {
      const raw = await cached(`/${kind}/${id}`, { append_to_response: "watch/providers,videos" });
      const m = norm(raw, kind);
      const s = pickStreaming(m["watch/providers"]);
      const trailer = ((m.videos && m.videos.results) || []).find((v) => v.site === "YouTube" && v.type === "Trailer");
      let facts;
      if (kind === "tv") {
        const ended = m.status === "Ended" || m.status === "Canceled";
        const span = year(m.first_air_date) + (ended && m.last_air_date && year(m.last_air_date) !== year(m.first_air_date) ? `–${year(m.last_air_date)}` : ended ? "" : "–");
        const seasons = m.number_of_seasons ? `${m.number_of_seasons} season${m.number_of_seasons === 1 ? "" : "s"}` : "";
        const ep = (m.episode_run_time || [])[0] ? `${hm(m.episode_run_time[0])} episodes` : "";
        facts = ["TV series", span, seasons, ep];
      } else {
        facts = [year(m.date), hm(m.runtime)];
      }
      facts.push(m.vote_count > 10 ? `★ ${m.vote_average.toFixed(1)}` : "", (m.genres || []).map((g) => g.name).join(", "));
      el.detailsBody.innerHTML = `
        <div class="backdrop" style="${m.backdrop_path ? `background-image:url('${IMG}w1280${m.backdrop_path}')` : ""}"></div>
        <div class="detail">
          ${m.poster_path ? `<img class="dposter" src="${IMG}w342${m.poster_path}" alt="">` : "<div></div>"}
          <div>
            <h2>${esc(m.title)}</h2>
            <div class="meta">${facts.filter(Boolean).map(esc).join(" · ")}</div>
            ${m.tagline ? `<p><em>${esc(m.tagline)}</em></p>` : ""}
            <p>${esc(m.overview || "No description available.")}</p>
            <div class="where">
              <h3>Stream it now in ${esc(regionName())}</h3>
              ${s.list.length ? `<div class="providers">${s.list.map((p) => `
                <div class="provider">${p.logo_path ? `<img src="${IMG}w92${p.logo_path}" alt="">` : ""}
                  <div>${esc(p.provider_name)}<small>${TYPE_LABEL[p.type]}${state.services.has(p.provider_id) ? " · ✓ you have this" : ""}</small></div>
                </div>`).join("")}</div>` : `<p class="why">Not streaming here right now.</p>`}
            </div>
            <div class="actions">
              ${s.link ? `<a class="primary" href="${esc(s.link)}" target="_blank" rel="noopener">Where to watch ↗</a>` : ""}
              ${trailer ? `<a class="secondary" href="https://www.youtube.com/watch?v=${esc(trailer.key)}" target="_blank" rel="noopener">▶ Trailer</a>` : ""}
            </div>
          </div>
        </div>`;
    } catch (e) {
      el.detailsBody.innerHTML = `<p class="buddy-step error">Couldn't load this title. Please try again.</p>`;
    }
  }

  // ---------- Buddy mode ----------
  const NOPE_GENRES = [[27, "😱 Horror"], [10749, "💘 Romance"], [16, "🧸 Animation"], [10402, "🎵 Musicals"], [99, "📚 Documentary"], [10752, "🪖 War"], [37, "🤠 Western"], [878, "👽 Sci-fi"], [14, "🧙 Fantasy"], [18, "🎭 Heavy drama"]];
  const BUDDY_QS = [
    { id: "moods", q: "What are you in the mood for?", hint: "Pick up to 2", multi: 2,
      options: MOODS.filter((m) => m.id !== "acclaimed").map((m) => ({ value: m.id, label: `${m.emoji} ${m.label}` })) },
    { id: "brain", q: "How much brainpower is left in the tank?",
      options: [{ value: "low", label: "🫠 Running on fumes" }, { value: "mid", label: "🙂 A normal amount" }, { value: "high", label: "🤓 Bring on the plot twists" }] },
    { id: "length", q: "How long can you commit?", movieOnly: true,
      options: [{ value: 100, label: "⏱️ Under 100 minutes" }, { value: 135, label: "🎬 A normal movie (up to ~2h15)" }, { value: 0, label: "🏔️ Epic? I'm in" }] },
    { id: "era", q: "Pick an era",
      options: [{ value: "classic", label: "📼 Classics (before 1990)" }, { value: "retro", label: "💿 90s & 2000s" }, { value: "modern", label: "📱 2010 and newer" }, { value: "any", label: "🤷 Don't care" }] },
    { id: "nope", q: "Any hard no's?", hint: "Pick as many as you like, or skip", multi: 99, optional: true,
      options: NOPE_GENRES.map(([value, label]) => ({ value, label })) },
    { id: "fame", q: "Crowd-pleaser or hidden gem?",
      options: [{ value: "crowd", label: "🍿 Crowd-pleaser" }, { value: "gem", label: "💎 Hidden gem" }, { value: "either", label: "⚖️ Either works" }] },
  ];
  const ERAS = { classic: [1900, 1989], retro: [1990, 2009], modern: [2010, CURRENT_YEAR], any: [1900, CURRENT_YEAR] };

  const buddy = { names: ["", ""], kind: "movie", qs: BUDDY_QS, answers: [{}, {}], player: 0, q: 0, pool: [], shown: new Set(), plan: null };

  function resetBuddy() {
    Object.assign(buddy, { kind: state.kind, answers: [{}, {}], player: 0, q: 0, pool: [], shown: new Set(), plan: null });
  }

  function openBuddy() {
    if (!apiKey()) { showSetup(); return; }
    resetBuddy();
    renderBuddyNames();
    el.buddy.showModal();
  }

  const pname = (i) => buddy.names[i] || `Player ${i + 1}`;

  function renderBuddyNames() {
    el.buddyBody.innerHTML = `<div class="buddy-step">
      <h2>👯 Buddy Mode</h2>
      <p class="hint">Each of you answers a few quick questions on this device. Then we'll find something you'll <em>both</em> like${state.services.size ? ", on your services" : ""}.</p>
      <form data-names>
        <div class="names">
          <input name="a" placeholder="Your name" value="${esc(buddy.names[0])}" maxlength="20" aria-label="Player 1 name">
          <input name="b" placeholder="Buddy's name" value="${esc(buddy.names[1])}" maxlength="20" aria-label="Player 2 name">
        </div>
        <p class="hint">What are we watching?</p>
        <div class="segmented" data-buddy-kind>
          ${Object.entries(KINDS).map(([k, K]) => `<button type="button" data-bkind="${k}" aria-pressed="${buddy.kind === k}">${K.emoji} A ${K.one}</button>`).join("")}
        </div>
        <div class="step-nav"><span></span><button class="primary" type="submit">Let's go →</button></div>
      </form>
    </div>`;
  }

  function renderPass() {
    el.buddyBody.innerHTML = `<div class="pass">
      <div class="big">🔄</div>
      <h2>Pass it to ${esc(pname(1))}!</h2>
      <p class="hint">No peeking at ${esc(pname(0))}'s answers 👀</p>
      <button class="primary" type="button" data-buddy="pass">I'm ${esc(pname(1))}, let's go</button>
    </div>`;
  }

  function renderQuestion() {
    const Q = buddy.qs[buddy.q];
    const ans = buddy.answers[buddy.player];
    const sel = Q.multi ? (ans[Q.id] || []) : [ans[Q.id]];
    const total = buddy.qs.length * 2;
    const done = buddy.player * buddy.qs.length + buddy.q;
    el.buddyBody.innerHTML = `<div class="buddy-step">
      <div class="progress"><div style="width:${(done / total) * 100}%"></div></div>
      <div class="who">${esc(pname(buddy.player))} · ${buddy.q + 1}/${buddy.qs.length}</div>
      <h2>${esc(Q.q)}</h2>
      <p class="hint">${esc(Q.hint || "")}</p>
      <div class="options">${Q.options.map((o) => `<button type="button" class="option" data-opt="${esc(o.value)}" aria-pressed="${sel.includes(o.value)}">${esc(o.label)}</button>`).join("")}</div>
      <div class="step-nav">
        <button type="button" class="secondary" data-buddy="back">← Back</button>
        ${Q.multi ? `<button type="button" class="primary" data-buddy="next" ${!Q.optional && !sel.length ? "disabled" : ""}>${Q.optional && !sel.length ? "Skip →" : "Next →"}</button>` : ""}
      </div>
    </div>`;
  }

  function chooseOption(raw) {
    const Q = buddy.qs[buddy.q];
    const opt = Q.options.find((o) => String(o.value) === raw);
    if (!opt) return;
    const ans = buddy.answers[buddy.player];
    if (Q.multi) {
      const cur = ans[Q.id] || [];
      if (cur.includes(opt.value)) ans[Q.id] = cur.filter((v) => v !== opt.value);
      else ans[Q.id] = (Q.multi === 1 ? [] : cur.length >= Q.multi ? cur.slice(1) : cur).concat(opt.value);
      renderQuestion();
    } else {
      ans[Q.id] = opt.value;
      nextQuestion();
    }
  }

  function nextQuestion() {
    if (buddy.q < buddy.qs.length - 1) { buddy.q++; renderQuestion(); return; }
    if (buddy.player === 0) { buddy.player = 1; buddy.q = 0; renderPass(); return; }
    findBuddyPick();
  }

  function prevQuestion() {
    if (buddy.q > 0) { buddy.q--; renderQuestion(); return; }
    if (buddy.player === 1) { buddy.player = 0; buddy.q = buddy.qs.length - 1; renderQuestion(); return; }
    renderBuddyNames();
  }

  // Genre preference weights for one player, in the genre ids of the chosen kind.
  function weights(a, kind) {
    const w = {};
    const add = (ids, n) => { for (const g of genresFor(kind, ids).genres) w[g] = (w[g] || 0) + n; };
    for (const id of a.moods || []) add(MOOD[id].genres, 3);
    if (a.brain === "low") { add([35, 16, 10751, 28, 12], 1); add([99, 36, 10752, 18], -2); }
    if (a.brain === "high") add([9648, 878, 18, 53, 99], 1);
    for (const g of genresFor(kind, a.nope || [], true).genres) w[g] = -10;
    return w;
  }

  function buddyPlan() {
    const kind = buddy.kind;
    const [A, B] = buddy.answers;
    const wA = weights(A, kind), wB = weights(B, kind);
    const nopeMovie = uniq([...(A.nope || []), ...(B.nope || [])]);
    const nope = genresFor(kind, nopeMovie, true);
    const ok = (g) => !nope.genres.includes(+g);
    const all = uniq([...Object.keys(wA), ...Object.keys(wB)]).filter(ok);
    const top = (w) => Object.keys(w).filter((g) => w[g] > 0 && ok(g)).sort((x, y) => w[y] - w[x]);
    // Genres both people lean toward, strongest first.
    const shared = all.filter((g) => (wA[g] || 0) > 0 && (wB[g] || 0) > 0).sort((x, y) => (wA[y] + wB[y]) - (wA[x] + wB[x]));
    const union = uniq([...top(wA).slice(0, 2), ...top(wB).slice(0, 2)]);
    // Moods with no TV genre (horror, romance) fall back to keywords when that's all we have.
    const moodKeywords = uniq([...(A.moods || []), ...(B.moods || [])].flatMap((id) => genresFor(kind, MOOD[id].genres).keywords));

    const lens = kind === "movie" ? [A.length, B.length].filter((n) => n > 0) : [];
    const runtime = lens.length ? Math.min(...lens) : 0;

    const [a0, a1] = ERAS[A.era || "any"], [b0, b1] = ERAS[B.era || "any"];
    let era = [Math.max(a0, b0), Math.min(a1, b1)];
    if (era[0] > era[1]) era = [Math.min(a0, b0), Math.max(a1, b1)]; // no overlap: widen instead

    const fames = [A.fame, B.fame];
    const fame = fames.includes("gem") && !fames.includes("crowd") ? "gem" : fames.includes("crowd") && !fames.includes("gem") ? "crowd" : "mixed";

    return { kind, wA, wB, nopeMovie, nope, shared, union, moodKeywords, runtime, era, fame };
  }

  async function buddyParams(plan, relax) {
    const tv = plan.kind === "tv";
    const p = {
      watch_region: state.region,
      with_watch_monetization_types: STREAM_TYPES.join("|"),
      with_watch_providers: [...state.services].join("|"),
      include_adult: false,
      without_genres: uniq([...plan.nope.genres, ...(tv ? TV_ALWAYS_WITHOUT : [])]).join(","),
    };
    if (plan.nope.keywords.length) p.without_keywords = (await keywordIds(plan.nope.keywords)).join(",");
    const genres = relax >= 3 ? [] : relax >= 2 || !plan.shared.length ? plan.union : plan.shared.slice(0, 3);
    if (genres.length) p.with_genres = genres.join("|");
    else if (relax < 3 && plan.moodKeywords.length) p.with_keywords = (await keywordIds(plan.moodKeywords)).join("|");
    if (!tv) {
      if (plan.runtime && relax < 1) p["with_runtime.lte"] = plan.runtime;
      p["with_runtime.gte"] = 60;
    }
    if (relax < 1) {
      const dateKey = tv ? "first_air_date" : "primary_release_date";
      p[`${dateKey}.gte`] = `${plan.era[0]}-01-01`;
      p[`${dateKey}.lte`] = plan.era[1] >= CURRENT_YEAR ? TODAY : `${plan.era[1]}-12-31`;
    }
    // TV shows get far fewer votes than movies, so scale the thresholds down.
    const v = (n) => (tv ? Math.round(n / 4) : n);
    if (plan.fame === "crowd") Object.assign(p, { sort_by: "popularity.desc", "vote_count.gte": v(500), "vote_average.gte": 6.3 });
    else if (plan.fame === "gem") Object.assign(p, { sort_by: "vote_average.desc", "vote_count.gte": v(80), "vote_count.lte": v(2500), "vote_average.gte": 6.8 });
    else Object.assign(p, { sort_by: "vote_average.desc", "vote_count.gte": v(400), "vote_average.gte": 6.8 });
    return p;
  }

  function matchScore(w, m) {
    const s = m.genre_ids.reduce((t, g) => t + (w[g] || 0), 0);
    return Math.max(42, Math.min(99, Math.round(62 + s * 7 + (m.vote_average - 6.5) * 4)));
  }

  async function findBuddyPick() {
    const K = KINDS[buddy.kind];
    el.buddyBody.innerHTML = `<div class="pass"><div class="spinner"></div><h2>Finding your perfect ${K.one}…</h2><p class="hint">Checking every streaming service${state.services.size ? " you have" : ""}</p></div>`;
    try {
      const plan = buddyPlan();
      const path = `/discover/${plan.kind}`;
      let pool = [];
      for (let relax = 0; relax <= 3 && pool.length < 6; relax++) {
        const params = await buddyParams(plan, relax);
        const first = await tmdb(path, { ...params, page: 1 });
        let results = first.results;
        // Grab a second, random page for variety.
        if (first.total_pages > 1) {
          const page = 2 + Math.floor(Math.random() * Math.min(first.total_pages - 1, 4));
          results = results.concat((await tmdb(path, { ...params, page })).results);
        }
        const seen = new Set(pool.map((m) => m.id));
        for (const r of results) {
          const m = norm(r, plan.kind);
          if (seen.has(m.id) || m.genre_ids.some((g) => plan.nope.genres.includes(g))) continue;
          seen.add(m.id);
          pool.push(m);
        }
        plan.relaxed = relax;
      }
      for (const m of pool) {
        m._a = matchScore(plan.wA, m);
        m._b = matchScore(plan.wB, m);
        // Favor fairness: the less-happy person's score counts double, plus a pinch of chaos.
        m._score = 2 * Math.min(m._a, m._b) + Math.max(m._a, m._b) + Math.random() * 12;
      }
      buddy.pool = pool.sort((x, y) => y._score - x._score);
      buddy.plan = plan;
      buddy.shown = new Set();
      showBuddyPick();
    } catch (e) {
      if (e instanceof KeyError) { el.buddy.close(); handleError(e); return; }
      el.buddyBody.innerHTML = `<div class="pass"><h2>Hmm, that didn't work</h2><p class="hint">Couldn't reach the movie database. Try again?</p><button class="primary" type="button" data-buddy="retry">Try again</button></div>`;
    }
  }

  function whyText(plan) {
    const [A, B] = buddy.answers;
    const sharedMoods = (A.moods || []).filter((m) => (B.moods || []).includes(m));
    const lbl = (id) => `${MOOD[id].emoji} ${MOOD[id].label.toLowerCase()}`;
    const parts = [];
    if (sharedMoods.length) parts.push(`You both wanted ${sharedMoods.map(lbl).join(" and ")}.`);
    else if ((A.moods || []).length && (B.moods || []).length) parts.push(`A blend of ${esc(pname(0))}'s ${lbl(A.moods[0])} and ${esc(pname(1))}'s ${lbl(B.moods[0])}.`);
    if (plan.runtime && !plan.relaxed) parts.push(`Under ${plan.runtime} minutes.`);
    if (plan.nopeMovie.length) parts.push(`No ${plan.nopeMovie.map((g) => (NOPE_GENRES.find(([id]) => id === g) || [0, ""])[1].replace(/^\S+\s/, "").toLowerCase()).join(", ")}.`);
    if (plan.fame === "gem") parts.push("A hidden gem, as requested 💎");
    if (plan.relaxed >= 2) parts.push("(We had to stretch your answers a bit to find something streaming.)");
    return parts.join(" ");
  }

  async function showBuddyPick() {
    const remaining = buddy.pool.filter((m) => !buddy.shown.has(m.id));
    if (!remaining.length) {
      el.buddyBody.innerHTML = `<div class="pass"><div class="big">🤷</div><h2>We're out of ideas</h2>
        <p class="hint">Nothing streaming matched your combined answers${state.services.size ? " on your services. Try clearing “My services”" : ""}.</p>
        <button class="primary" type="button" data-buddy="restart">Start over</button></div>`;
      return;
    }
    const [pick, ...rest] = remaining;
    const alts = rest.slice(0, 3);
    buddy.shown.add(pick.id);
    el.buddyBody.innerHTML = `<div class="buddy-step"><div class="spinner"></div></div>`;
    const s = await streamingFor(pick.kind, pick.id).catch(() => ({ list: [] }));
    const emoji = KINDS[pick.kind].emoji;
    el.buddyBody.innerHTML = `<div class="buddy-step">
      <div class="who">🎉 Tonight's pick</div>
      <div class="pick">
        ${pick.poster_path ? `<img src="${IMG}w342${pick.poster_path}" alt="">` : `<div class="poster"><div class="noimg">${emoji}</div></div>`}
        <div>
          <h2>${esc(pick.title)} <span class="card-year">${year(pick.date)}</span></h2>
          <div class="match"><span>${esc(pname(0))}: ${pick._a}% match</span><span>${esc(pname(1))}: ${pick._b}% match</span></div>
          <p class="why">${whyText(buddy.plan)}</p>
          <p>${esc((pick.overview || "").slice(0, 260))}${(pick.overview || "").length > 260 ? "…" : ""}</p>
          ${s.list.length ? `<div class="logos">${logosHTML(s.list)}</div>` : ""}
          <div class="actions">
            <button class="primary" type="button" data-details="${pick.id}" data-kind="${pick.kind}">Where to watch</button>
            <button class="secondary" type="button" data-buddy="shuffle">🎲 Not feeling it</button>
            <button class="link-btn" type="button" data-buddy="restart">Start over</button>
          </div>
        </div>
      </div>
      ${alts.length ? `<h3 class="why" style="margin-top:24px">Also a good match</h3><div class="alts">${alts.map((m) => `
        <button type="button" class="card" data-details="${m.id}" data-kind="${m.kind}">
          <div class="poster">${m.poster_path ? `<img src="${IMG}w185${m.poster_path}" alt="" loading="lazy">` : `<div class="noimg">${emoji}</div>`}</div>
          <div class="card-body"><div class="card-title">${esc(m.title)}</div><div class="card-year">${Math.round((m._a + m._b) / 2)}% match</div></div>
        </button>`).join("")}</div>` : ""}
    </div>`;
  }

  // ---------- Events ----------
  function setKind(kind) {
    if (kind === state.kind) return;
    state.kind = kind;
    store.set("kind", kind);
    state.genre = ""; // genre ids differ between movies and TV
    renderKind();
    renderGenres();
    run();
  }

  el.kind.addEventListener("click", (ev) => { const b = ev.target.closest("[data-kind]"); if (b) setKind(b.dataset.kind); });
  el.status.addEventListener("click", (ev) => { const b = ev.target.closest("[data-switch-kind]"); if (b) setKind(b.dataset.switchKind); });

  el.searchForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    state.query = el.q.value.trim();
    run();
  });
  // Clearing the search box goes back to browsing.
  el.q.addEventListener("input", () => { if (!el.q.value.trim() && state.query) { state.query = ""; run(); } });

  el.moods.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-mood]");
    if (!b) return;
    state.mood = state.mood === b.dataset.mood ? null : b.dataset.mood;
    if (state.mood) { state.genre = ""; el.genre.value = ""; }
    renderMoods();
    run();
  });

  el.services.addEventListener("click", (ev) => {
    const t = ev.target.closest("button");
    if (!t) return;
    if (t.hasAttribute("data-toggle-services")) { state.showAllServices = !state.showAllServices; renderServices(); return; }
    if (t.hasAttribute("data-clear-services")) state.services.clear();
    else {
      const id = +t.dataset.service;
      state.services.has(id) ? state.services.delete(id) : state.services.add(id);
    }
    store.set("services", [...state.services]);
    renderServices();
    run();
  });

  el.genre.addEventListener("change", () => {
    state.genre = el.genre.value;
    if (state.genre && state.mood) { state.mood = null; renderMoods(); }
    run();
  });
  el.sort.addEventListener("change", () => { state.sort = el.sort.value; run(); });
  el.region.addEventListener("change", async () => {
    state.region = el.region.value;
    store.set("region", state.region);
    await loadRegionData().catch(handleError);
    run();
  });
  el.reset.addEventListener("click", () => {
    Object.assign(state, { mood: null, genre: "", sort: "popularity.desc", query: "" });
    el.q.value = ""; el.genre.value = ""; el.sort.value = state.sort;
    renderMoods();
    run();
  });
  el.more.addEventListener("click", () => run(false));
  el.grid.addEventListener("click", (ev) => { const c = ev.target.closest(".card[data-id]"); if (c) openDetails(c.dataset.kind, c.dataset.id); });

  for (const d of [el.details, el.buddy]) {
    d.addEventListener("click", (ev) => {
      if (ev.target === d || ev.target.closest("[data-close]")) d.close(); // backdrop or ✕
    });
  }

  el.buddyOpen.addEventListener("click", openBuddy);
  el.buddyBody.addEventListener("submit", (ev) => {
    if (!ev.target.matches("[data-names]")) return;
    ev.preventDefault();
    const f = ev.target;
    buddy.names = [f.a.value.trim(), f.b.value.trim()];
    buddy.qs = BUDDY_QS.filter((q) => !(q.movieOnly && buddy.kind !== "movie"));
    buddy.player = 0; buddy.q = 0;
    renderQuestion();
  });
  el.buddyBody.addEventListener("click", (ev) => {
    const bk = ev.target.closest("[data-bkind]");
    if (bk) {
      buddy.kind = bk.dataset.bkind;
      bk.parentElement.querySelectorAll("[data-bkind]").forEach((b) => b.setAttribute("aria-pressed", b === bk));
      return;
    }
    const opt = ev.target.closest("[data-opt]");
    if (opt) return chooseOption(opt.dataset.opt);
    const det = ev.target.closest("[data-details]");
    if (det) return openDetails(det.dataset.kind, det.dataset.details);
    const act = ev.target.closest("[data-buddy]");
    if (!act) return;
    const a = act.dataset.buddy;
    if (a === "next") nextQuestion();
    else if (a === "back") prevQuestion();
    else if (a === "pass") renderQuestion();
    else if (a === "shuffle") showBuddyPick();
    else if (a === "retry") findBuddyPick();
    else if (a === "restart") { resetBuddy(); renderBuddyNames(); }
  });

  // ---------- Boot ----------
  async function start() {
    renderKind();
    renderMoods();
    if (!apiKey()) { showSetup(); return; }
    el.setup.hidden = true;
    try {
      await loadRegionData();
    } catch (e) {
      handleError(e);
      return;
    }
    el.forgetKey.hidden = useProxy;
    run();
  }

  start();
})();
