const DEFAULTS = {
  channels: [],
  perChannel: 5,
  maxTotal: 60,
  hideShorts: true,
  hideSidebar: true,
};

const $ = (id) => document.getElementById(id);
let settings = { ...DEFAULTS };

// ---------- Channel resolution ----------
// Returns { id, name }. The name comes from the channel page when possible so that
// adding a channel never depends on YouTube's (sometimes flaky) RSS endpoint.
async function resolveChannel(input) {
  input = input.trim();

  let m = input.match(/(?:^|youtube\.com\/channel\/)(UC[\w-]{22})(?:[/?#]|$)/);
  if (m) return { id: m[1], name: null };

  let url;
  if (/^https?:\/\//i.test(input)) url = input;
  else if (/^(www\.|m\.)?youtube\.com\//i.test(input)) url = "https://" + input;
  else url = "https://www.youtube.com/@" + input.replace(/^@/, "");

  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const name = doc.querySelector('meta[property="og:title"]')?.content || null;

  const canonical = doc.querySelector('link[rel="canonical"]')?.href || "";
  m = canonical.match(/\/channel\/(UC[\w-]{22})/);
  if (m) return { id: m[1], name };

  const meta = doc.querySelector('meta[itemprop="identifier"], meta[itemprop="channelId"]')?.content || "";
  m = meta.match(/UC[\w-]{22}/);
  if (m) return { id: m[0], name };

  m = html.match(/"(?:externalId|channelId)":"(UC[\w-]{22})"/);
  if (m) return { id: m[1], name: null };

  throw new Error("couldn't find a channel ID on that page");
}

// Best-effort only: returns null if the RSS feed is unavailable.
async function fetchChannelName(id) {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { credentials: "omit" });
    if (!res.ok) return null;
    const doc = new DOMParser().parseFromString(await res.text(), "application/xml");
    return doc.getElementsByTagName("title")[0]?.textContent || null;
  } catch (_) {
    return null;
  }
}

// ---------- UI ----------
function log(text, cls) {
  const li = document.createElement("li");
  li.className = cls || "";
  li.textContent = text;
  $("log").appendChild(li);
}

function renderChannels() {
  $("count").textContent = settings.channels.length;
  const ul = $("channels");
  ul.replaceChildren();
  for (const ch of settings.channels) {
    const li = document.createElement("li");

    const name = document.createElement("a");
    name.className = "name";
    name.href = `https://www.youtube.com/channel/${ch.id}`;
    name.target = "_blank";
    name.rel = "noopener";
    name.textContent = ch.name;
    name.style.color = "inherit";
    name.style.textDecoration = "none";

    const id = document.createElement("span");
    id.className = "id";
    id.textContent = ch.id;

    const rm = document.createElement("button");
    rm.textContent = "Remove";
    rm.addEventListener("click", async () => {
      settings.channels = settings.channels.filter((c) => c.id !== ch.id);
      await browser.storage.local.set({ channels: settings.channels });
      renderChannels();
    });

    li.append(name, id, rm);
    ul.appendChild(li);
  }
}

async function addChannels() {
  const lines = $("input").value.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return;

  $("add").disabled = true;
  $("log").replaceChildren();
  const failed = [];

  for (const line of lines) {
    try {
      const { id, name: pageName } = await resolveChannel(line);
      if (settings.channels.some((c) => c.id === id)) {
        log(`${line}: already added`, "err");
        continue;
      }
      const name = pageName || (await fetchChannelName(id)) || id;
      settings.channels.push({ id, name });
      log(`Added ${name}`, "ok");
    } catch (err) {
      log(`${line}: ${err.message}`, "err");
      failed.push(line);
    }
  }

  await browser.storage.local.set({ channels: settings.channels });
  $("input").value = failed.join("\n"); // keep only the ones that failed
  $("add").disabled = false;
  renderChannels();
}

async function init() {
  settings = await browser.storage.local.get(DEFAULTS);
  $("perChannel").value = settings.perChannel;
  $("maxTotal").value = settings.maxTotal;
  $("hideShorts").checked = settings.hideShorts;
  $("hideSidebar").checked = settings.hideSidebar;
  renderChannels();

  try {
    const managed = await browser.storage.managed.get();
    if (managed.channels && managed.channels.length) {
      $("managedBox").hidden = false;
      for (const entry of managed.channels) {
        const li = document.createElement("li");
        li.textContent = entry;
        $("managed").appendChild(li);
      }
    }
  } catch (_) {
    /* no managed storage provisioned */
  }

  $("add").addEventListener("click", addChannels);

  const clamp = (v, min, max, fallback) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const save = () => {
    settings.perChannel = clamp($("perChannel").value, 1, 30, DEFAULTS.perChannel);
    settings.maxTotal = clamp($("maxTotal").value, 1, 300, DEFAULTS.maxTotal);
    settings.hideShorts = $("hideShorts").checked;
    settings.hideSidebar = $("hideSidebar").checked;
    browser.storage.local.set({
      perChannel: settings.perChannel,
      maxTotal: settings.maxTotal,
      hideShorts: settings.hideShorts,
      hideSidebar: settings.hideSidebar,
    });
  };
  for (const id of ["perChannel", "maxTotal", "hideShorts", "hideSidebar"]) {
    $(id).addEventListener("change", save);
  }
}

init();
