(() => {
  "use strict";

  const FEED_URL = "https://www.youtube.com/feeds/videos.xml?";
    const DEFAULTS = {
    channels: [], // [{ id: "UC...", name: "..." }]
    perChannel: 5,
    maxTotal: 60,
    hideShorts: true,
    hideSidebar: true,
  };

  const root = document.documentElement;
  let renderToken = 0;
  let wasHome = false;

  const isHome = () => location.pathname === "/";
  const chKey = (c) => c.id || c.base; // stable key for channels that may only have a handle so far

  // Turns "@handle", a channel URL, or a UC… id (as written in the Nix config) into a channel record.
  function toChannel(input) {
    input = String(input || "").trim();
    if (!input) return null;
    const m = input.match(/(?:^|youtube\.com\/channel\/)(UC[\w-]{22})(?:[/?#]|$)/);
    if (m) return { id: m[1], name: m[1] };
    const base = /^https?:\/\//i.test(input)
      ? input.replace(/[?#].*$/, "").replace(/\/(videos|featured|streams|shorts|playlists|about)?\/?$/, "")
      : "https://www.youtube.com/@" + input.replace(/^@/, "");
    return { id: null, name: input, base };
  }

  // Channels/settings declared by the system (Firefox enterprise policy "3rdparty") are merged
  // with whatever was added through the settings page.
  async function getSettings() {
    const s = await browser.storage.local.get(DEFAULTS);
    let managed = {};
    try {
      managed = await browser.storage.managed.get();
    } catch (_) {
      /* no managed storage provisioned */
    }
    for (const k of ["perChannel", "maxTotal", "hideShorts", "hideSidebar"]) {
      if (k in managed) s[k] = managed[k];
    }
    const local = new Set(s.channels.map((c) => c.id));
    const fromPolicy = (managed.channels || []).map(toChannel).filter((c) => c && !(c.id && local.has(c.id)));
    s.channels = [...fromPolicy, ...s.channels];
    return s;
  }

  // Applied at document_start so YouTube's own feed never flashes.
  root.classList.toggle("ytsub-home", isHome());
  getSettings().then((s) => root.classList.toggle("ytsub-nosidebar", s.hideSidebar));

  // ---------- DOM helper (YouTube enforces Trusted Types, so no innerHTML) ----------
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    el.append(...kids);
    return el;
  }

  // ---------- Feed fetching ----------
  function parseFeed(xml, ch) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return [...doc.getElementsByTagName("entry")]
      .map((e) => {
        const text = (tag) => e.getElementsByTagName(tag)[0]?.textContent ?? "";
        const attr = (tag, a) => e.getElementsByTagName(tag)[0]?.getAttribute(a);
        const id = text("yt:videoId");
        const views = attr("media:statistics", "views");
        return {
          id,
          title: text("title"),
          published: Date.parse(text("published")),
          channel: ch.name,
          channelId: ch.id,
          thumb: attr("media:thumbnail", "url") || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
          views: views != null ? Number(views) : null,
          short: (attr("link", "href") || "").includes("/shorts/"),
        };
      })
      .filter((v) => v.id);
  }

  // Reads the first page of a channel's Videos tab (what you see when you open the channel).
  // Publish times there are relative ("3 days ago"), so sort order is approximate.
  const diag = {}; // channel id -> why it produced nothing (shown when the feed is empty)
  const AGE_MS = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };
  // Accepts "7 days ago", "7d ago", "3h ago", "2w ago", "5mo ago", "1y ago", ...
  function unitMs(u) {
    u = u.toLowerCase();
    if (u.startsWith("mo")) return AGE_MS.month;
    if (u.startsWith("m")) return AGE_MS.minute;
    const key = { s: "second", h: "hour", d: "day", w: "week", y: "year" }[u[0]];
    return key ? AGE_MS[key] : null;
  }
  const approxTime = (s) => {
    const m = /(\d+)\s*([a-z]+)\s+ago/i.exec(s || "");
    const ms = m && unitMs(m[2]);
    return ms ? Date.now() - Number(m[1]) * ms : null;
  };

  // Pull the ytInitialData JSON object out of the page by matching braces.
  function extractInitialData(text) {
    const m = /ytInitialData(?:["']\])?\s*=\s*\{/.exec(text);
    if (!m) return null;
    const start = m.index + m[0].length - 1;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch (_) { return null; }
      }
    }
    return null;
  }

  const textOf = (t) =>
    t?.simpleText || (t?.runs ? t.runs.map((r) => r.text).join("") : "") || t?.content || "";

  // Classic layout: videoRenderer / gridVideoRenderer
  function fromRenderer(r) {
    return {
      id: r.videoId,
      title: textOf(r.title),
      agoText: textOf(r.publishedTimeText),
      viewsText: textOf(r.viewCountText),
    };
  }

  // Newer layout: lockupViewModel
  function fromLockup(l) {
    const md = l.metadata?.lockupMetadataViewModel;
    const parts = (md?.metadata?.contentMetadataViewModel?.metadataRows || [])
      .flatMap((row) => row.metadataParts || [])
      .map((p) => p.text?.content || "");
    return {
      id: l.contentId,
      title: md?.title?.content || "",
      agoText: parts.find((p) => /\bago$/i.test(p)) || "",
      viewsText:
        parts.find((p) => /\bviews?$/i.test(p)) ||
        (parts.find((p) => /^[\d.,]+\s*[KMB]?$/i.test(p.trim())) || "").replace(/$/, " views").replace(/^ views$/, ""),
    };
  }

  async function scrapeChannel(ch) {
    const key = chKey(ch);
    delete diag[key];
    const url = ch.base ? `${ch.base}/videos?hl=en` : `https://www.youtube.com/channel/${ch.id}/videos?hl=en`;
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) {
      diag[key] = `channel page HTTP ${res.status}`;
      return [];
    }
    const text = await res.text();
    const data = extractInitialData(text);
    if (!data) {
      diag[key] = `no ytInitialData in page (${text.length} bytes)`;
      return [];
    }

    // Channels given as a handle/URL learn their id and display name from the page.
    const meta = data.metadata?.channelMetadataRenderer;
    ch = { ...ch, id: meta?.externalId || ch.id, name: meta?.title || ch.name };

    const counts = {};
    const found = [];
    (function walk(node) {
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node)) {
        if (/(Renderer|ViewModel)$/.test(k)) counts[k] = (counts[k] || 0) + 1;
        if ((k === "videoRenderer" || k === "gridVideoRenderer") && v?.videoId) found.push(fromRenderer(v));
        else if (k === "lockupViewModel" && v?.contentId && /VIDEO$/.test(v.contentType || "")) found.push(fromLockup(v));
        else walk(v);
      }
    })(data);

    const seen = new Set();
    const videos = found
      .filter((v) => v.id && !seen.has(v.id) && seen.add(v.id))
      .map((v) => ({
        ...v,
        published: approxTime(v.agoText),
        channel: ch.name,
        channelId: ch.id,
        thumb: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
        views: null,
        short: false,
      }))
      .filter((v) => v.published != null); // skips live/upcoming entries without a publish age

    if (!videos.length) {
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}×${n}`);
      diag[key] = found.length
        ? `${found.length} items found but none had a recognisable age; sample: ${JSON.stringify(found[0])}`
        : `page parsed but no video items found; page contains: ${top.join(", ") || "nothing recognisable"}`;
    }
    return videos;
  }

  async function fetchViaRss(ch, settings) {
    if (!ch.id) return [];
    const urls = [];
    // "UULF" playlist = a channel's long-form uploads only (no Shorts).
    if (settings.hideShorts && ch.id.startsWith("UC")) {
      urls.push(`${FEED_URL}playlist_id=UULF${ch.id.slice(2)}`);
    }
    urls.push(`${FEED_URL}channel_id=${ch.id}`);

    let lastStatus = "no response";
    for (const url of urls) {
      try {
        const res = await fetch(url, { credentials: "omit" });
        lastStatus = `HTTP ${res.status}`;
        if (!res.ok) continue;
        let vids = parseFeed(await res.text(), ch);
        if (settings.hideShorts) vids = vids.filter((v) => !v.short);
        if (vids.length) return vids;
      } catch (_) {
        /* try next URL */
      }
    }
    diag[chKey(ch)] = (diag[chKey(ch)] ? diag[chKey(ch)] + "; " : "") + `RSS ${lastStatus}`;
    return [];
  }

  // Primary: the channel's Videos page. RSS is only a backup because YouTube's
  // feed endpoint regularly returns 404 for hours at a time.
  async function fetchChannel(ch, settings) {
    try {
      const vids = await scrapeChannel(ch);
      if (vids.length) return vids;
    } catch (_) {
      /* fall through to RSS */
    }
    return fetchViaRss(ch, settings);
  }

  async function loadVideos(settings) {
    const lists = await Promise.all(settings.channels.map((ch) => fetchChannel(ch, settings)));
    const seen = new Set();
    return lists
      .flatMap((l) => l.sort((a, b) => b.published - a.published).slice(0, settings.perChannel))
      .sort((a, b) => b.published - a.published)
      .filter((v) => !seen.has(v.id) && seen.add(v.id))
      .slice(0, settings.maxTotal);
  }

  // ---------- Rendering ----------
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const compact = new Intl.NumberFormat(undefined, { notation: "compact" });
  const UNITS = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];

  function timeAgo(ts) {
    const diff = (ts - Date.now()) / 1000;
    for (const [unit, sec] of UNITS) {
      if (Math.abs(diff) >= sec) return rtf.format(Math.round(diff / sec), unit);
    }
    return "just now";
  }

  function card(v) {
    const url = `https://www.youtube.com/watch?v=${v.id}`;
    const meta = [];
    if (v.viewsText) meta.push(v.viewsText);
    else if (v.views != null) meta.push(`${compact.format(v.views)} views`);
    meta.push(v.agoText || timeAgo(v.published));
    return h(
      "div",
      { class: "ytsub-card" },
      h("a", { class: "ytsub-thumb", href: url }, h("img", { src: v.thumb, loading: "lazy", alt: "" })),
      h("a", { class: "ytsub-title", href: url, title: v.title }, v.title),
      h("a", { class: "ytsub-channel", href: `https://www.youtube.com/channel/${v.channelId}` }, v.channel),
      h("div", { class: "ytsub-meta" }, meta.join(" · "))
    );
  }

  function header(el) {
    return h(
      "div",
      { class: "ytsub-header" },
      h("h2", {}, "Latest from your channels"),
      h("span", { class: "ytsub-spacer" }),
      h("button", { class: "ytsub-btn", onclick: () => render(el) }, "Refresh"),
      h(
        "button",
        { class: "ytsub-btn", onclick: () => browser.runtime.sendMessage({ type: "openOptions" }) },
        "Manage channels"
      )
    );
  }

  function noVideos(settings) {
    const lines = settings.channels.filter((c) => diag[chKey(c)]).map((c) => `${c.name}: ${diag[chKey(c)]}`);
    return h(
      "div",
      {},
      h("p", { class: "ytsub-note" }, "No videos found for your channels."),
      ...(lines.length ? [h("pre", { class: "ytsub-diag" }, lines.join("\n"))] : [])
    );
  }

  async function render(el) {
    const token = ++renderToken;
    const settings = await getSettings();
    root.classList.toggle("ytsub-nosidebar", settings.hideSidebar);

    if (!settings.channels.length) {
      el.replaceChildren(
        header(el),
        h("p", { class: "ytsub-note" }, "You haven't added any channels yet. Use “Manage channels” to add some.")
      );
      return;
    }

    if (!el.querySelector(".ytsub-grid")) {
      el.replaceChildren(header(el), h("p", { class: "ytsub-note" }, "Loading…"));
    }

    let videos;
    try {
      videos = await loadVideos(settings);
    } catch (err) {
      if (token !== renderToken) return;
      el.replaceChildren(header(el), h("p", { class: "ytsub-note" }, `Couldn't load feeds: ${err.message}`));
      return;
    }
    if (token !== renderToken) return; // a newer render superseded this one

    el.replaceChildren(
      header(el),
      videos.length
        ? h("div", { class: "ytsub-grid" }, ...videos.map(card))
        : noVideos(settings)
    );
  }

  // ---------- SPA handling ----------
  function tick() {
    const home = isHome();
    root.classList.toggle("ytsub-home", home);
    if (!home) {
      wasHome = false;
      return;
    }

    const browse = document.querySelector('ytd-browse[page-subtype="home"]');
    if (!browse) return;

    let el = document.getElementById("ytsub-root");
    let needsRender = false;
    if (!el || el.parentElement !== browse) {
      el?.remove();
      el = h("div", { id: "ytsub-root" });
      browse.appendChild(el);
      needsRender = true;
    }
    if (!wasHome) {
      wasHome = true;
      needsRender = true;
    }
    if (needsRender) render(el);
  }

  document.addEventListener("yt-navigate-finish", tick);
  setInterval(tick, 500); // cheap safety net for YouTube's SPA navigation
  tick();

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !("channels" in changes || "perChannel" in changes || "maxTotal" in changes ||
        "hideShorts" in changes || "hideSidebar" in changes)) return;
    const el = document.getElementById("ytsub-root");
    if (el) render(el);
    else getSettings().then((s) => root.classList.toggle("ytsub-nosidebar", s.hideSidebar));
  });
})();
