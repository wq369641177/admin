/**
 * 裤佬Ai短剧 —— 一体化 Cloudflare Worker / Pages Functions
 * 数据源：野果短剧 yeguodj.com
 * UI：悬浮玻璃抽屉 + 深浅主题 + 横版海报 + 首页TG跑马灯
 */

const SITE = "https://www.yeguodj.com";
const API_BASE = "https://www.yeguodj.com/api.php";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const API_KEY   = new TextEncoder().encode("2acf7e91e9864673");
const API_IV    = new TextEncoder().encode("1c29882d3ddfcfd6");
const MEDIA_KEY = new TextEncoder().encode("f5d965df75336270");
const MEDIA_IV  = new TextEncoder().encode("97b60394abc2fbe1");

const API_PATHS = new Set(["/home", "/category", "/detail", "/play", "/search", "/proxy", "/stats"]);

const CLASSES = [
  { type_id: "explore",    type_name: "发现" },
  { type_id: "rank",       type_name: "排行榜" },
  { type_id: "dushi",      type_name: "都市" },
  { type_id: "xiandai",    type_name: "现代" },
  { type_id: "xiaoyuan",   type_name: "校园" },
  { type_id: "gudai",      type_name: "古代" },
  { type_id: "xiangcun",   type_name: "乡村" },
  { type_id: "zhichang",   type_name: "职场" },
  { type_id: "chongsheng", type_name: "重生" },
  { type_id: "chuanyue",   type_name: "穿越" },
  { type_id: "xitong",     type_name: "系统" },
  { type_id: "nixi",       type_name: "逆袭" },
  { type_id: "mogai",      type_name: "魔改" },
];

const BG_MAP = {
  dushi: 40, xiandai: 39, xiaoyuan: 47,
  gudai: 41, xiangcun: 42, zhichang: 44,
};

const SETTING_MAP = {
  chongsheng: 26, chuanyue: 27, xitong: 28,
  nixi: 53, mogai: 56,
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    }
  });
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesCbcDecrypt(cipherBytes, keyBytes, ivBytes) {
  try {
    const key = await crypto.subtle.importKey(
      "raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]
    );
    const dec = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: ivBytes }, key, cipherBytes
    );
    return new Uint8Array(dec);
  } catch (e) { return null; }
}

function detectMime(b) {
  if (!b || b.length < 4) return null;
  if (b[0] === 0xFF && b[1] === 0xD8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

function proxyImage(picUrl, origin) {
  if (!picUrl) return "";
  return `${origin}/proxy?url=${encodeURIComponent(picUrl)}`;
}

async function apiPost(path, body, debug = false) {
  const url = API_BASE + path;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Referer": SITE + "/",
        "Origin": SITE,
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=UTF-8"
      },
      body: JSON.stringify(body || {})
    });
    if (!r.ok) return {};
    const text = await r.text();
    let d;
    try { d = JSON.parse(text); } catch (e) { return {}; }

    if (debug || path === "/api/playlet/play") {
      try {
        console.log("[apiPost]", path, "req:", JSON.stringify(body));
        console.log("[apiPost]", path, "res:", text.slice(0, 500));
      } catch (e) {}
    }

    const dataVal = d.data;
    if (typeof dataVal === "string" && dataVal.length > 20) {
      try {
        const cipher = base64ToBytes(dataVal);
        const dec = await aesCbcDecrypt(cipher, API_KEY, API_IV);
        if (dec) {
          const decText = new TextDecoder("utf-8", { fatal: false }).decode(dec);
          d.data = JSON.parse(decText);
        }
      } catch (e) {}
    }
    return d;
  } catch (e) {
    console.log("[apiPost]", e.message);
    return {};
  }
}

function unwrap(d) {
  if (!d) return {};
  let x = (d.data !== undefined && d.data !== null) ? d.data : d;
  if (x && typeof x === "object" && x.data !== undefined && x.data !== null && typeof x.data === "object") {
    return x.data;
  }
  return x;
}

function toVod(it, origin) {
  if (!it) return null;
  let vid = it.video_id !== undefined && it.video_id !== null ? it.video_id : (it.id || "");
  vid = String(vid).trim();
  if (!vid) return null;

  const title = String(it.title || it.video_title || it.name || vid).trim();
  const rawPic = String(it.cover || it.cover_img || it.pic || "").trim();
  const ep = it.episode_count || it.episodes || it.total_serial || "";
  let remark = String(it.update_status || it.serialize_status_text || "").trim();
  if (!remark && ep) remark = `更新至${ep}集`;

  return {
    vod_id: vid,
    vod_name: title,
    vod_pic: proxyImage(rawPic, origin),
    vod_remarks: remark
  };
}

function listFromPayload(d, origin) {
  const inner = unwrap(d);
  let arr = [];
  if (Array.isArray(inner)) arr = inner;
  else if (inner && typeof inner === "object") arr = inner.list || inner.top_list || [];
  const out = [];
  for (const it of arr) {
    const v = toVod(it, origin);
    if (v) out.push(v);
  }
  return out;
}

async function handleStats(url) {
  return jsonResp({
    total: 100000,
    displayText: "10万+",
    top: CLASSES,
    children: {}
  });
}

async function handleHome(url) {
  const origin = url.origin;
  const d = await apiPost("/api/home/homePage", {});
  const inner = unwrap(d);
  const combined = [];

  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    if (Array.isArray(inner.top_list)) combined.push(...inner.top_list);
    const mods = (inner.modules && inner.modules.list) || [];
    for (const m of mods) {
      if (m && typeof m === "object") {
        if (Array.isArray(m.list)) combined.push(...m.list);
        else if (m.video_id !== undefined) combined.push(m);
      }
    }
  }

  const seen = new Set();
  const list = [];
  for (const it of combined) {
    const v = toVod(it, origin);
    if (v && !seen.has(v.vod_id)) {
      seen.add(v.vod_id);
      list.push(v);
    }
  }

  const withPic = list.filter(v => v.vod_pic);
  const hero = withPic.sort(() => Math.random() - 0.5).slice(0, 4);

  return jsonResp({
    top: CLASSES,
    children: {},
    hero,
    list: list.slice(0, 30)
  });
}

async function handleCategory(url) {
  const origin = url.origin;
  const tid = url.searchParams.get("tid") || "explore";
  const pg = parseInt(url.searchParams.get("pg") || "1");

  let d;
  if (tid === "rank") {
    d = await apiPost("/api/theater/videoRank", { page: pg, limit: 24 });
  } else if (BG_MAP[tid] !== undefined) {
    d = await apiPost("/api/theater/exploreList", { page: pg, limit: 24, background: BG_MAP[tid] });
  } else if (SETTING_MAP[tid] !== undefined) {
    d = await apiPost("/api/theater/exploreList", { page: pg, limit: 24, setting: SETTING_MAP[tid] });
  } else {
    d = await apiPost("/api/theater/exploreList", { page: pg, limit: 24 });
  }

  const list = listFromPayload(d, origin);
  const hasMore = list.length >= 24;

  return jsonResp({
    list,
    page: pg,
    pagecount: hasMore ? pg + 1 : pg,
    total: 9999,
    top: CLASSES,
    children: {}
  });
}

async function handleDetail(url) {
  const origin = url.origin;
  const id = url.searchParams.get("id") || "";
  if (!id) return jsonResp({ list: [] });

  const vid = /^\d+$/.test(id) ? parseInt(id) : id;
  const d = await apiPost("/api/playlet/detail", { video_id: vid });
  let info = unwrap(d);

  if (info && typeof info === "object" && info.video_id === undefined && info.data && typeof info.data === "object") {
    info = info.data;
  }
  if (!info || typeof info !== "object") info = {};

  const title = String(info.title || id).trim();
  const rawPic = String(info.cover || info.cover_img || "").trim();
  const rawDesc = String(info.description || info.intro || "").trim();

  const eps = Array.isArray(info.episodes) ? info.episodes : [];
  const playUrls = [];

  if (eps.length > 0) {
    eps.forEach((ep, idx) => {
      const n = String(
        ep.sort !== undefined ? ep.sort :
        (ep.episode !== undefined ? ep.episode :
        (ep.index !== undefined ? ep.index : (idx + 1)))
      ).trim();

      let realId = "";
      if (ep.id !== undefined && ep.id !== null) realId = String(ep.id);
      else if (ep.episode_id !== undefined && ep.episode_id !== null) realId = String(ep.episode_id);
      else if (ep.video_episode_id !== undefined && ep.video_episode_id !== null) realId = String(ep.video_episode_id);
      else if (ep.nid !== undefined && ep.nid !== null) realId = String(ep.nid);

      const epUrl = String(ep.video_url || ep.url || ep.play_url || "").trim();

      let tName = String(ep.title || `第${n}集`).trim();
      tName = tName.replace(/\$/g, "").replace(/#/g, "");

      const parts = [id, n, realId, epUrl ? encodeURIComponent(epUrl) : ""];
      playUrls.push(`${tName}$${parts.join(":")}`);
    });
  } else {
    const total = parseInt(info.episode_count || info.total_serial || 1);
    const n = Math.max(1, total);
    for (let i = 1; i <= n; i++) {
      playUrls.push(`第${i}集$${id}:${i}::`);
    }
  }

  return jsonResp({
    list: [{
      vod_id: id,
      vod_name: title,
      vod_pic: proxyImage(rawPic, origin),
      vod_actor: "",
      vod_director: "",
      vod_remarks: `全${playUrls.length}集`,
      vod_content: rawDesc,
      vod_play_from: "野果专线",
      vod_play_url: playUrls.join("#")
    }]
  });
}

async function handlePlay(url) {
  const origin = url.origin;
  const id = url.searchParams.get("id") || "";
  if (!id) return jsonResp({ parse: 1, url: "" });

  const parts = id.split(":");
  const vid      = parts[0] || "";
  const epStr    = parts[1] || "1";
  const epRealId = parts[2] || "";
  const epUrlEnc = parts[3] || "";

  const vNum  = /^\d+$/.test(vid)   ? parseInt(vid)   : vid;
  const epNum = /^\d+$/.test(epStr) ? parseInt(epStr) : epStr;
  const rid   = epRealId
    ? (/^\d+$/.test(epRealId) ? parseInt(epRealId) : epRealId)
    : null;

  if (epUrlEnc) {
    try {
      const cachedUrl = decodeURIComponent(epUrlEnc);
      if (cachedUrl) {
        let finalUrl = cachedUrl;
        if (cachedUrl.includes(".m3u8")) {
          finalUrl = `${origin}/proxy?url=${encodeURIComponent(cachedUrl)}`;
        }
        return jsonResp({
          parse: 0,
          url: finalUrl,
          header: { "User-Agent": UA, "Referer": SITE + "/", "Origin": SITE }
        });
      }
    } catch (e) {}
  }

  const reqBody = {
    video_id: vNum, vid: vNum,
    ep: epNum, sort: epNum, episode: epNum, index: epNum, page: epNum
  };
  if (rid !== null) {
    reqBody.episode_id = rid;
    reqBody.epid = rid;
    reqBody.eid = rid;
    reqBody.nid = rid;
    reqBody.id = rid;
    reqBody.video_episode_id = rid;
  }

  const d = await apiPost("/api/playlet/play", reqBody, true);
  let info = unwrap(d);

  if (info && typeof info === "object" && info.video_url === undefined &&
      info.data && typeof info.data === "object") {
    info = info.data;
  }
  if (!info || typeof info !== "object") info = {};

  let videoUrl = "";

  if (Array.isArray(info.episodeAll)) {
    for (const e of info.episodeAll) {
      const s = String(
        e.sort !== undefined ? e.sort :
        (e.index !== undefined ? e.index :
        (e.episode !== undefined ? e.episode : ""))
      );
      if (s === String(epNum)) {
        videoUrl = String(e.video_url || e.url || e.play_url || "").trim();
        if (videoUrl) break;
      }
    }
    if (!videoUrl && rid !== null) {
      for (const e of info.episodeAll) {
        const eid = String(
          e.id !== undefined ? e.id :
          (e.episode_id !== undefined ? e.episode_id :
          (e.nid !== undefined ? e.nid : ""))
        );
        if (eid === String(rid)) {
          videoUrl = String(e.video_url || e.url || e.play_url || "").trim();
          if (videoUrl) break;
        }
      }
    }
    if (!videoUrl) {
      const idx = Number(epNum) - 1;
      if (idx >= 0 && idx < info.episodeAll.length) {
        const e = info.episodeAll[idx];
        videoUrl = String(e.video_url || e.url || e.play_url || "").trim();
      }
    }
  }

  if (!videoUrl) {
    videoUrl = String(info.video_url || info.url || info.play_url || "").trim();
  }

  if (!videoUrl) return jsonResp({ parse: 1, url: "" });

  let finalUrl = videoUrl;
  if (videoUrl.includes(".m3u8")) {
    finalUrl = `${origin}/proxy?url=${encodeURIComponent(videoUrl)}`;
  }

  return jsonResp({
    parse: 0,
    url: finalUrl,
    header: { "User-Agent": UA, "Referer": SITE + "/", "Origin": SITE }
  });
}

async function handleSearch(url) {
  const origin = url.origin;
  const wd = url.searchParams.get("wd") || url.searchParams.get("key") || "";
  const pg = parseInt(url.searchParams.get("pg") || "1");
  if (!wd) return jsonResp({ list: [], page: 1, pagecount: 1, total: 0 });

  const d = await apiPost("/api/search/result", { keyword: wd, page: pg });
  const list = listFromPayload(d, origin);

  return jsonResp({
    list,
    page: pg,
    pagecount: list.length >= 14 ? pg + 1 : pg,
    total: 9999
  });
}

async function handleProxy(url) {
  const target = url.searchParams.get("url");
  if (!target) return new Response("Missing url", { status: 400 });

  let res;
  try {
    res = await fetch(target, {
      headers: { "User-Agent": UA, "Referer": SITE + "/" }
    });
  } catch (e) {
    return new Response("Fetch error: " + e.message, { status: 502 });
  }
  if (!res.ok) return new Response("Upstream " + res.status, { status: res.status });

  const contentType = res.headers.get("content-type") || "";
  const buf = new Uint8Array(await res.arrayBuffer());

  const head = new TextDecoder().decode(buf.slice(0, 16));
  if (head.startsWith("#EXTM3U") || /mpegurl|m3u8/i.test(contentType)) {
    const text = new TextDecoder().decode(buf);
    const rewritten = rewriteM3u8(text, target, url.origin);
    return new Response(rewritten, {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache"
      }
    });
  }

  const mime = detectMime(buf);
  if (mime) {
    return new Response(buf, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

  const dec = await aesCbcDecrypt(buf, MEDIA_KEY, MEDIA_IV);
  if (dec) {
    const m2 = detectMime(dec);
    if (m2) {
      return new Response(dec, {
        headers: {
          "Content-Type": m2,
          "Cache-Control": "public, max-age=86400",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }

  return new Response(buf, {
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600"
    }
  });
}

function rewriteM3u8(content, baseUrl, origin) {
  const lines = content.split(/\r?\n/);
  const result = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { result.push(line); continue; }
    if (trimmed.startsWith("#")) {
      const replaced = line.replace(/URI="([^"]+)"/g, (m, u) => {
        try {
          const abs = new URL(u, baseUrl).toString();
          return `URI="${origin}/proxy?url=${encodeURIComponent(abs)}"`;
        } catch (e) { return m; }
      });
      result.push(replaced);
      continue;
    }
    try {
      const abs = new URL(trimmed, baseUrl).toString();
      result.push(`${origin}/proxy?url=${encodeURIComponent(abs)}`);
    } catch (e) { result.push(line); }
  }
  return result.join("\n");
}

// ============================================================
// 内嵌前端
// ============================================================

const INDEX_HTML = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>裤佬Ai短剧</title>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js"><\/script>
<style>
  :root[data-theme="dark"] {
    --bg: #08090f;
    --bg-grad-1: #2a1a4a;
    --bg-grad-2: #08090f;
    --panel: rgba(22,26,36,.72);
    --panel-solid: #14171f;
    --card: #12151d;
    --card-hi: #1a1f2a;
    --line: rgba(255,255,255,.07);
    --line-hi: rgba(255,255,255,.14);
    --text: #f0f2f7;
    --text-dim: #b8bece;
    --sub: #7d8598;
    --accent: #ff6f43;
    --accent-2: #ffb259;
    --accent-3: #ff3d7f;
    --accent-glow: rgba(255,111,67,.5);
    --accent-glow-2: rgba(255,61,127,.35);
    --shadow-sm: 0 4px 14px rgba(0,0,0,.4);
    --shadow-md: 0 12px 32px rgba(0,0,0,.5);
    --shadow-lg: 0 24px 56px rgba(0,0,0,.6);
    --header-bg: rgba(8,9,15,.7);
    --drawer-bg: rgba(16,19,27,.42);
    --hover: rgba(255,255,255,.06);
    --sk-1: #161a24;
    --sk-2: #202530;
    --hero-mask: linear-gradient(180deg, rgba(0,0,0,.05) 15%, rgba(0,0,0,.94) 100%);
  }
  :root[data-theme="light"] {
    --bg: #eef1f8;
    --bg-grad-1: #ffd9c2;
    --bg-grad-2: #eef1f8;
    --panel: rgba(255,255,255,.55);
    --panel-solid: rgba(255,255,255,.72);
    --card: rgba(255,255,255,.58);
    --card-hi: rgba(255,255,255,.78);
    --line: rgba(255,255,255,.7);
    --line-hi: rgba(255,255,255,.95);
    --text: #0f1424;
    --text-dim: #3a4258;
    --sub: #5f6880;
    --accent: #ff5e2e;
    --accent-2: #ff9b2c;
    --accent-3: #ff3d7f;
    --accent-glow: rgba(255,94,46,.35);
    --accent-glow-2: rgba(255,61,127,.22);
    --shadow-sm: 0 4px 16px rgba(80,90,140,.10);
    --shadow-md: 0 14px 38px rgba(80,90,140,.14);
    --shadow-lg: 0 24px 60px rgba(80,90,140,.20);
    --header-bg: rgba(255,255,255,.55);
    --drawer-bg: rgba(255,255,255,.45);
    --hover: rgba(255,255,255,.55);
    --sk-1: rgba(255,255,255,.55);
    --sk-2: rgba(255,255,255,.85);
    --hero-mask: linear-gradient(180deg, rgba(0,0,0,.02) 15%, rgba(0,0,0,.65) 100%);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body {
    background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    min-height: 100vh; overflow-x: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    transition: background .5s ease, color .5s ease;
    line-height: 1.5;
    scroll-behavior: smooth;
  }
  body::before {
    content: "";
    position: fixed; inset: -30% -30% auto -30%; height: 80vh;
    background:
      radial-gradient(50% 80% at 20% 0%, var(--bg-grad-1) 0%, transparent 65%),
      radial-gradient(45% 70% at 85% 5%, var(--accent-glow-2) 0%, transparent 60%);
    pointer-events: none; z-index: 0; opacity: .9;
    animation: bg-breathe 14s ease-in-out infinite;
  }
  @keyframes bg-breathe {
    0%, 100% { opacity: .85; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.06); }
  }

  a { color: inherit; text-decoration: none; }
  img { display: block; width: 100%; height: 100%; object-fit: cover; }
  button { font-family: inherit; }

  /* ============ 顶栏 ============ */
  header {
    position: sticky; top: 0; z-index: 100;
    background: var(--header-bg);
    backdrop-filter: saturate(180%) blur(24px);
    -webkit-backdrop-filter: saturate(180%) blur(24px);
    border-bottom: 1px solid var(--line);
    padding: 14px 16px 12px;
    transition: background .5s, border-color .5s;
  }
  .top {
    display: grid;
    grid-template-columns: 44px 1fr 44px;
    align-items: center;
    gap: 12px;
    max-width: 1400px;
    margin: 0 auto;
  }
  .icon-btn {
    width: 44px; height: 44px;
    border-radius: 13px;
    background: var(--card);
    border: 1px solid var(--line);
    color: var(--text);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    transition: all .28s cubic-bezier(.34,1.56,.64,1);
    padding: 0;
    position: relative;
    overflow: hidden;
  }
  .icon-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
    box-shadow: 0 8px 24px var(--accent-glow);
    transform: translateY(-2px) scale(1.04);
  }
  .icon-btn:active { transform: translateY(0) scale(.9); }
  .icon-btn svg { width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

  .brand {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 9px; min-width: 0; cursor: pointer; user-select: none;
    padding: 2px 0;
  }
  .brand .logo {
    font-size: 26px; font-weight: 900;
    background: linear-gradient(110deg, var(--accent) 0%, var(--accent-2) 35%, var(--accent-3) 65%, var(--accent) 100%);
    background-size: 300% auto;
    -webkit-background-clip: text; background-clip: text; color: transparent;
    letter-spacing: 1.5px;
    white-space: nowrap;
    animation: logo-shine 4s linear infinite;
    filter: drop-shadow(0 0 12px var(--accent-glow));
    line-height: 1.1;
  }
  @keyframes logo-shine {
    0% { background-position: 0% center; }
    100% { background-position: 300% center; }
  }
  .brand .avatar {
    width: 52px; height: 52px;
    border-radius: 50%;
    overflow: hidden; flex-shrink: 0;
    padding: 2px;
    background: conic-gradient(from 0deg, var(--accent), var(--accent-2), var(--accent-3), var(--accent));
    box-shadow: 0 0 16px var(--accent-glow), 0 0 32px var(--accent-glow-2);
    animation: av-breathe 3s ease-in-out infinite;
    transition: transform .3s;
  }
  .brand:hover .avatar {
    transform: scale(1.06);
    box-shadow: 0 0 24px var(--accent-glow), 0 0 48px var(--accent-glow-2);
  }
  .brand .avatar img { border-radius: 50%; }
  @keyframes av-breathe {
    0%, 100% { box-shadow: 0 0 16px var(--accent-glow), 0 0 32px var(--accent-glow-2); }
    50% { box-shadow: 0 0 22px var(--accent-glow), 0 0 44px var(--accent-glow-2); }
  }

  @media (max-width: 480px) {
    .brand .logo { font-size: 21px; letter-spacing: 1px; }
    .brand .avatar { width: 44px; height: 44px; }
    .icon-btn { width: 40px; height: 40px; border-radius: 11px; }
    .top { grid-template-columns: 40px 1fr 40px; }
  }

  .theme-btn { position: relative; }
  .theme-btn .sun, .theme-btn .moon { position: absolute; transition: opacity .4s cubic-bezier(.4,0,.2,1), transform .55s cubic-bezier(.34,1.56,.64,1); }
  :root[data-theme="dark"] .theme-btn .sun { opacity: 1; transform: rotate(0) scale(1); }
  :root[data-theme="dark"] .theme-btn .moon { opacity: 0; transform: rotate(90deg) scale(.3); }
  :root[data-theme="light"] .theme-btn .sun { opacity: 0; transform: rotate(-90deg) scale(.3); }
  :root[data-theme="light"] .theme-btn .moon { opacity: 1; transform: rotate(0) scale(1); }

  /* ============ 搜索 ============ */
  .search-wrap { max-width: 1400px; margin: 12px auto 0; }
  .search {
    display: flex;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
    transition: border-color .3s, box-shadow .4s;
  }
  .search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-glow), 0 8px 32px var(--accent-glow);
  }
  .search input {
    flex: 1; background: transparent; border: none; outline: none;
    color: var(--text); padding: 12px 15px; font-size: 14px;
    font-weight: 500;
  }
  .search input::placeholder { color: var(--sub); font-weight: 400; }
  .search button {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    border: none; color: #fff;
    padding: 0 22px; font-size: 14px; font-weight: 700;
    cursor: pointer; letter-spacing: .5px;
    transition: all .3s;
    position: relative; overflow: hidden;
  }
  .search button::before {
    content: "";
    position: absolute; top: 0; left: -100%; width: 100%; height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.3), transparent);
    transition: left .5s;
  }
  .search button:hover::before { left: 100%; }
  .search button:hover { filter: brightness(1.1); box-shadow: 0 0 20px var(--accent-glow); }
  .search button:active { filter: brightness(.94); transform: scale(.96); }

  /* ============ 统计条 ============ */
  .stats-bar {
    max-width: 1400px;
    margin: 12px auto 0;
    display: flex; align-items: center; gap: 10px;
    padding: 9px 15px;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 12px;
    font-size: 12.5px; color: var(--sub);
    font-weight: 500;
    position: relative;
    overflow: hidden;
    animation: stats-in .6s cubic-bezier(.34,1.56,.64,1);
  }
  @keyframes stats-in {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .stats-bar::before {
    content: "";
    position: absolute; left: 0; top: 0; bottom: 0;
    width: 3px;
    background: linear-gradient(180deg, var(--accent), var(--accent-2));
    box-shadow: 0 0 12px var(--accent-glow);
  }
  .stats-bar .dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 10px #22c55e, 0 0 20px rgba(34,197,94,.5);
    animation: pulse-dot 1.8s ease-in-out infinite;
    flex-shrink: 0;
  }
  @keyframes pulse-dot {
    0%,100% { transform: scale(1); }
    50% { transform: scale(1.3); }
  }
  .stats-bar b {
    font-size: 14.5px; font-weight: 800;
    background: linear-gradient(90deg, var(--accent), var(--accent-2), var(--accent-3), var(--accent));
    background-size: 200% auto;
    -webkit-background-clip: text; background-clip: text; color: transparent;
    margin: 0 2px;
    animation: logo-shine 3s linear infinite;
  }

  /* ============ 抽屉（高度自适应） ============ */
  .drawer-mask {
    position: fixed; inset: 0; z-index: 200;
    background: transparent;
    backdrop-filter: blur(6px) saturate(120%);
    -webkit-backdrop-filter: blur(6px) saturate(120%);
    opacity: 0; pointer-events: none;
    transition: opacity .45s cubic-bezier(.4,0,.2,1);
  }
  .drawer-mask.show { opacity: 1; pointer-events: auto; }

  .drawer {
    position: fixed;
    top: 12px; left: 12px; z-index: 201;
    max-height: calc(100dvh - 24px);
    width: 190px; max-width: 58vw;
    background: var(--drawer-bg);
    backdrop-filter: blur(48px) saturate(200%);
    -webkit-backdrop-filter: blur(48px) saturate(200%);
    border: 1px solid var(--line);
    border-radius: 22px;
    transform: translateX(calc(-100% - 16px)) scale(.96);
    opacity: 0;
    transition:
      transform .55s cubic-bezier(.34,1.3,.64,1),
      opacity .4s cubic-bezier(.34,1.3,.64,1);
    display: flex; flex-direction: column;
    box-shadow: 0 24px 64px rgba(0,0,0,.28);
    overflow: hidden;
  }
  .drawer.show {
    transform: translateX(0) scale(1);
    opacity: 1;
  }
  .drawer::before {
    content: "";
    position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, var(--accent-glow), transparent);
    opacity: .5;
    pointer-events: none;
  }

  .drawer-head {
    padding: 14px 14px 12px;
    border-bottom: 1px solid var(--line);
    display: flex; align-items: center; gap: 10px;
    position: relative; z-index: 1;
    flex-shrink: 0;
  }
  .drawer-head .avatar {
    width: 38px; height: 38px;
    border-radius: 50%;
    overflow: hidden; flex-shrink: 0;
    padding: 2px;
    background: conic-gradient(from 0deg, var(--accent), var(--accent-2), var(--accent-3), var(--accent));
    box-shadow: 0 0 12px var(--accent-glow);
    animation: av-breathe 3s ease-in-out infinite;
  }
  .drawer-head .avatar img { border-radius: 50%; }
  .drawer-head .info { flex: 1; min-width: 0; }
  .drawer-head .name {
    font-size: 13.5px; font-weight: 800;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text; background-clip: text; color: transparent;
    letter-spacing: .3px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .drawer-head .sub {
    font-size: 10px; color: var(--sub);
    margin-top: 2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .drawer-head .close {
    width: 26px; height: 26px; border-radius: 8px;
    background: transparent; border: none; color: var(--sub);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: all .3s cubic-bezier(.34,1.56,.64,1); flex-shrink: 0;
  }
  .drawer-head .close:hover {
    background: var(--hover);
    color: var(--accent);
    transform: rotate(90deg) scale(1.1);
    box-shadow: 0 0 14px var(--accent-glow);
  }

  .drawer-body {
    flex: 0 1 auto;
    overflow-y: auto;
    padding: 8px 8px 16px;
    position: relative; z-index: 1;
  }
  .drawer-body::-webkit-scrollbar { width: 3px; }
  .drawer-body::-webkit-scrollbar-thumb { background: linear-gradient(180deg, var(--accent), var(--accent-2)); border-radius: 3px; }
  .drawer-body::-webkit-scrollbar-track { background: transparent; }

  .drawer-label {
    font-size: 9.5px; font-weight: 800;
    letter-spacing: 1.4px;
    color: var(--sub);
    text-transform: uppercase;
    padding: 12px 10px 6px;
  }

  .nav-item {
    display: flex; align-items: center;
    padding: 9px 12px;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-dim);
    cursor: pointer;
    transition: all .3s cubic-bezier(.34,1.4,.64,1);
    margin-bottom: 1px;
    position: relative;
    letter-spacing: .2px;
    overflow: hidden;
    animation: nav-in .5s cubic-bezier(.34,1.56,.64,1) backwards;
  }
  @keyframes nav-in {
    from { opacity: 0; transform: translateX(-14px); }
    to { opacity: 1; transform: translateX(0); }
  }
  .nav-item::before {
    content: "";
    position: absolute;
    left: 0; top: 50%;
    transform: translateY(-50%) scaleY(0);
    width: 3px; height: 55%;
    border-radius: 0 3px 3px 0;
    background: linear-gradient(180deg, var(--accent), var(--accent-2));
    transition: transform .32s cubic-bezier(.34,1.56,.64,1);
    box-shadow: 0 0 10px var(--accent-glow);
  }
  .nav-item:hover {
    background: var(--hover);
    color: var(--text);
    padding-left: 16px;
    transform: translateX(2px);
  }
  .nav-item:hover::before { transform: translateY(-50%) scaleY(1); }
  .nav-item.active {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: #fff;
    font-weight: 700;
    box-shadow: 0 8px 22px var(--accent-glow);
    letter-spacing: .3px;
  }
  .nav-item.active::before { display: none; }
  .nav-item:active { transform: scale(.97); }

  /* ============ 主内容 ============ */
  main {
    max-width: 1400px; margin: 0 auto;
    padding: 18px 16px 90px;
    position: relative; z-index: 1;
  }

  /* ============ 首页 TG 跑马灯 ============ */
  .tg-marquee {
    display: block;
    position: relative;
    overflow: hidden;
    margin: 2px 0 16px;
    padding: 10px 0;
    border-radius: 12px;
    background: linear-gradient(90deg,
      rgba(255,111,67,.14) 0%,
      rgba(255,178,89,.18) 50%,
      rgba(255,61,127,.14) 100%);
    border: 1px solid rgba(255,111,67,.28);
    text-decoration: none;
    cursor: pointer;
    transition: all .3s cubic-bezier(.34,1.4,.64,1);
    animation: tg-in .6s cubic-bezier(.34,1.56,.64,1);
    box-shadow: 0 6px 24px rgba(255,111,67,.14);
  }
  @keyframes tg-in {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .tg-marquee:hover {
    border-color: rgba(255,111,67,.55);
    box-shadow: 0 10px 32px var(--accent-glow);
    transform: translateY(-2px);
  }
  .tg-marquee:active { transform: translateY(0) scale(.99); }
  .tg-marquee::before,
  .tg-marquee::after {
    content: "";
    position: absolute; top: 0; bottom: 0; width: 32px; z-index: 2;
    pointer-events: none;
  }
  .tg-marquee::before {
    left: 0;
    background: linear-gradient(90deg, var(--bg) 0%, transparent 100%);
  }
  .tg-marquee::after {
    right: 0;
    background: linear-gradient(270deg, var(--bg) 0%, transparent 100%);
  }
  .tg-track {
    display: inline-flex;
    white-space: nowrap;
    animation: tg-scroll 22s linear infinite;
    will-change: transform;
  }
  .tg-marquee:hover .tg-track { animation-play-state: paused; }
  @keyframes tg-scroll {
    0% { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }
  .tg-item {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 32px;
    font-size: 13.5px;
    font-weight: 700;
    letter-spacing: .5px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2), var(--accent-3));
    background-size: 200% auto;
    -webkit-background-clip: text; background-clip: text; color: transparent;
    animation: logo-shine 4s linear infinite;
  }
  .tg-item .tg-plane {
    font-size: 15px;
    -webkit-text-fill-color: initial;
    background: none;
    color: var(--accent);
    filter: drop-shadow(0 0 6px var(--accent-glow));
  }
  .tg-item .tg-link {
    color: var(--text-dim);
    background: none;
    -webkit-text-fill-color: initial;
    font-weight: 600;
    text-decoration: underline;
    text-decoration-color: var(--accent-glow);
    text-underline-offset: 3px;
  }
  @media (max-width: 480px) {
    .tg-item { font-size: 12.5px; padding: 0 24px; }
    .tg-marquee { padding: 9px 0; margin-bottom: 14px; }
  }

  .section-title {
    display: flex; align-items: center; gap: 10px;
    font-size: 17.5px; font-weight: 800;
    margin: 6px 2px 16px;
    color: var(--text);
    letter-spacing: .3px;
    animation: fade-slide-in .5s cubic-bezier(.34,1.56,.64,1);
  }
  @keyframes fade-slide-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .section-title::before {
    content: "";
    width: 4px; height: 20px; border-radius: 3px;
    background: linear-gradient(180deg, var(--accent), var(--accent-2));
    box-shadow: 0 0 14px var(--accent-glow);
    flex-shrink: 0;
  }

  /* ============ 横版海报轮播 ============ */
  .hero-scroll {
    display: flex; gap: 14px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    padding: 4px 2px 18px;
    margin: 0 -2px 10px;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .hero-scroll::-webkit-scrollbar { display: none; }
  .hero-card {
    flex: 0 0 76%; max-width: 500px;
    scroll-snap-align: start;
    aspect-ratio: 16/9;
    border-radius: 18px;
    overflow: hidden;
    position: relative;
    background: var(--sk-1);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-md);
    cursor: pointer;
    transition: transform .45s cubic-bezier(.34,1.4,.64,1), box-shadow .45s;
    will-change: transform;
    animation: hero-in .7s cubic-bezier(.34,1.4,.64,1) backwards;
  }
  @keyframes hero-in {
    from { opacity: 0; transform: translateY(24px) scale(.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .hero-card:hover {
    transform: translateY(-6px) scale(1.015);
    box-shadow: 0 32px 64px rgba(0,0,0,.6), 0 0 0 1px var(--accent-glow), 0 0 60px var(--accent-glow-2);
  }
  .hero-card:active { transform: translateY(-2px) scale(.99); }
  @media (max-width: 640px) {
    .hero-card { flex: 0 0 86%; aspect-ratio: 16/10; border-radius: 14px; }
  }
  .hero-card img {
    transition: transform .9s cubic-bezier(.4,0,.2,1);
    background: var(--sk-1);
  }
  .hero-card:hover img { transform: scale(1.1); }
  .hero-card::after {
    content: ""; position: absolute; inset: 0;
    background: var(--hero-mask);
    pointer-events: none;
  }
  .hero-info {
    position: absolute; left: 0; right: 0; bottom: 0;
    padding: 20px 22px;
    color: #fff; z-index: 3;
  }
  @media (max-width: 640px) { .hero-info { padding: 14px 16px; } }
  .hero-tag {
    display: inline-block;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: #fff;
    font-size: 10.5px; font-weight: 700;
    padding: 4px 11px;
    border-radius: 20px;
    letter-spacing: 1px;
    margin-bottom: 9px;
    box-shadow: 0 4px 14px var(--accent-glow);
  }
  .hero-title {
    font-size: 20px; font-weight: 800;
    line-height: 1.32;
    margin-bottom: 6px;
    text-shadow: 0 2px 14px rgba(0,0,0,.65);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  @media (max-width: 640px) { .hero-title { font-size: 17px; } }
  .hero-desc {
    font-size: 12.5px; opacity: .88;
    font-weight: 500;
    display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .hero-badge {
    position: absolute; top: 16px; right: 16px;
    background: rgba(0,0,0,.5);
    color: #fff;
    font-size: 11px; font-weight: 600;
    padding: 5px 12px;
    border-radius: 20px;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,.16);
    display: flex; align-items: center; gap: 5px;
    z-index: 3;
  }
  .hero-dots {
    display: flex; justify-content: center; gap: 6px;
    margin: -6px 0 22px;
  }
  .hero-dots .dot-item {
    width: 6px; height: 6px;
    border-radius: 3px;
    background: var(--line-hi);
    transition: all .4s cubic-bezier(.34,1.56,.64,1);
    cursor: pointer;
  }
  .hero-dots .dot-item.on {
    width: 24px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    box-shadow: 0 0 12px var(--accent-glow);
  }

  /* ============ 分页 ============ */
  .pager {
    display: flex; align-items: center; justify-content: center;
    gap: 8px; padding: 28px 0 10px; flex-wrap: wrap;
  }
  .pager button, .pager .pg-info {
    min-width: 42px; height: 42px;
    padding: 0 15px;
    border-radius: 11px;
    background: var(--card);
    border: 1px solid var(--line);
    color: var(--text);
    font-size: 13.5px; font-weight: 600;
    cursor: pointer;
    transition: all .32s cubic-bezier(.34,1.4,.64,1);
    display: flex; align-items: center; justify-content: center;
    letter-spacing: .3px;
  }
  .pager button:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
    box-shadow: 0 8px 20px var(--accent-glow);
    transform: translateY(-2px);
  }
  .pager button:active:not(:disabled) { transform: translateY(0) scale(.94); }
  .pager button:disabled { opacity: .3; cursor: not-allowed; }
  .pager .pg-info {
    background: transparent; border: none;
    cursor: default; color: var(--sub); font-weight: 500;
  }
  .pager .pg-info b {
    color: var(--accent); margin: 0 3px;
    font-size: 15px; font-weight: 800;
  }
  .pager .goto input {
    width: 64px; height: 42px;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 11px;
    color: var(--text); text-align: center;
    font-size: 13.5px; font-weight: 600;
    outline: none;
    transition: all .32s cubic-bezier(.34,1.4,.64,1);
    font-family: inherit;
  }
  .pager .goto input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-glow), 0 8px 20px var(--accent-glow);
    transform: translateY(-2px);
  }
  .pager .goto input::-webkit-outer-spin-button,
  .pager .goto input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .pager .goto input[type=number] { -moz-appearance: textfield; }

  /* ============ 卡片网格 ============ */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 16px;
  }
  @media (max-width: 640px) { .grid { grid-template-columns: repeat(3, 1fr); gap: 12px; } }
  @media (min-width: 900px) { .grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 20px; } }

  .card {
    background: var(--card);
    border-radius: 16px;
    overflow: hidden;
    cursor: pointer;
    transition: transform .4s cubic-bezier(.34,1.4,.64,1), box-shadow .4s, border-color .4s;
    border: 1px solid var(--line);
    position: relative;
    will-change: transform;
    animation: card-in .55s cubic-bezier(.34,1.56,.64,1) backwards;
    box-shadow: 0 2px 8px rgba(0,0,0,.2);
  }
  @keyframes card-in {
    from { opacity: 0; transform: translateY(20px) scale(.94); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .card:nth-child(1) { animation-delay: .02s; }
  .card:nth-child(2) { animation-delay: .04s; }
  .card:nth-child(3) { animation-delay: .06s; }
  .card:nth-child(4) { animation-delay: .08s; }
  .card:nth-child(5) { animation-delay: .1s; }
  .card:nth-child(6) { animation-delay: .12s; }
  .card:nth-child(7) { animation-delay: .14s; }
  .card:nth-child(8) { animation-delay: .16s; }
  .card:nth-child(9) { animation-delay: .18s; }
  .card:nth-child(10) { animation-delay: .2s; }
  .card:nth-child(11) { animation-delay: .22s; }
  .card:nth-child(12) { animation-delay: .24s; }
  .card:nth-child(n+13) { animation-delay: .26s; }
  .card:active { transform: scale(.97); }
  @media (hover: hover) {
    .card:hover {
      transform: translateY(-6px) scale(1.015);
      box-shadow: 0 24px 48px rgba(0,0,0,.55), 0 0 0 1px var(--accent-glow), 0 0 40px var(--accent-glow-2);
      border-color: var(--accent);
      z-index: 5;
    }
    .card:hover .thumb img { transform: scale(1.1); }
    .card:hover .card-title { color: var(--accent); }
  }

  .thumb {
    position: relative;
    aspect-ratio: 3/4;
    background: var(--sk-1);
    overflow: hidden;
  }
  .thumb::after {
    content: ""; position: absolute; inset: auto 0 0 0; height: 60%;
    background: linear-gradient(180deg, transparent 0%, rgba(0,0,0,.35) 55%, rgba(0,0,0,.75) 100%);
    pointer-events: none;
    z-index: 2;
  }
  .thumb img {
    transition: transform .65s cubic-bezier(.34,1.2,.64,1);
    background: var(--sk-1);
  }
  .card-title {
    padding: 11px 12px 13px;
    font-size: 13.5px; line-height: 1.45; font-weight: 600;
    color: var(--text);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden; min-height: 50px;
    transition: color .3s;
    letter-spacing: .2px;
  }

  .skel .thumb {
    background: linear-gradient(90deg, var(--sk-1), var(--sk-2), var(--sk-1));
    background-size: 200% 100%;
    animation: sk 1.6s ease-in-out infinite;
  }
  .skel .card-title {
    background: var(--sk-1); color: transparent;
    border-radius: 5px;
    margin: 11px 12px 13px;
    min-height: 32px;
  }
  @keyframes sk { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

  /* ============ 详情 & 播放器 ============ */
  .player-toolbar {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 14px; gap: 10px;
    animation: fade-slide-in .4s cubic-bezier(.34,1.56,.64,1);
  }
  .toolbar-right { display: flex; gap: 8px; align-items: center; }
  .back-btn {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 14px; font-weight: 600;
    color: var(--text-dim);
    padding: 9px 15px;
    cursor: pointer;
    border-radius: 11px;
    background: var(--card);
    border: 1px solid var(--line);
    transition: all .32s cubic-bezier(.34,1.4,.64,1);
  }
  .back-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
    transform: translateX(-3px);
    box-shadow: 0 8px 22px var(--accent-glow);
  }
  .back-btn:active { transform: translateX(-3px) scale(.94); }
  .close-btn {
    width: 40px; height: 40px;
    border-radius: 12px;
    background: var(--card);
    color: var(--sub);
    border: 1px solid var(--line);
    font-size: 16px; line-height: 1;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    transition: all .4s cubic-bezier(.34,1.56,.64,1);
    padding: 0; flex-shrink: 0;
  }
  .close-btn:hover {
    background: var(--hover);
    color: var(--accent);
    border-color: var(--accent);
    transform: rotate(90deg) scale(1.1);
    box-shadow: 0 8px 22px var(--accent-glow);
  }
  .close-btn:active { transform: rotate(90deg) scale(.9); }

  .player-wrap {
    position: relative; width: 100%;
    background: #000;
    border-radius: 18px;
    overflow: hidden;
    margin-bottom: 18px;
    box-shadow: var(--shadow-lg), 0 0 60px var(--accent-glow-2);
    border: 1px solid var(--line);
    animation: fade-slide-in .5s cubic-bezier(.34,1.56,.64,1);
  }
  video { width: 100%; display: block; background: #000; max-height: 78vh; }

  .detail-head {
    display: flex; gap: 18px;
    margin-bottom: 20px;
    animation: fade-slide-in .5s cubic-bezier(.34,1.56,.64,1) backwards;
    animation-delay: .1s;
  }
  .detail-head .poster {
    width: 132px; flex-shrink: 0;
    aspect-ratio: 3/4;
    border-radius: 16px;
    overflow: hidden;
    background: var(--sk-1);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-md), 0 0 30px var(--accent-glow-2);
  }
  @media (max-width: 560px) { .detail-head .poster { width: 106px; } }
  .detail-info { min-width: 0; padding-top: 2px; }
  .detail-info h1 {
    font-size: 19px; line-height: 1.38;
    margin-bottom: 12px;
    font-weight: 800;
    color: var(--text);
    letter-spacing: .3px;
  }
  .detail-info .tags {
    display: flex; flex-wrap: wrap; gap: 7px;
    margin-bottom: 12px;
  }
  .tag {
    font-size: 12px; font-weight: 600;
    padding: 5px 11px;
    border-radius: 20px;
    background: var(--panel);
    color: var(--sub);
    border: 1px solid var(--line);
    backdrop-filter: blur(8px);
  }
  .tag.accent {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: #fff; border-color: transparent;
    font-weight: 700;
    box-shadow: 0 4px 16px var(--accent-glow);
  }
  .desc {
    font-size: 12.5px; line-height: 1.75;
    color: var(--sub);
    display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .ep-section-title {
    display: flex; align-items: center; gap: 10px;
    font-size: 15.5px; font-weight: 800;
    color: var(--text);
    margin: 24px 0 14px;
    letter-spacing: .3px;
  }
  .ep-section-title::before {
    content: "";
    width: 4px; height: 18px; border-radius: 3px;
    background: linear-gradient(180deg, var(--accent), var(--accent-2));
    box-shadow: 0 0 12px var(--accent-glow);
    flex-shrink: 0;
  }
  .episodes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
    gap: 10px;
  }
  .ep {
    background: var(--panel-solid);
    border: 1px solid var(--line);
    border-radius: 11px;
    padding: 11px 6px;
    font-size: 12.5px; font-weight: 600;
    color: var(--sub);
    text-align: center;
    cursor: pointer;
    transition: all .3s cubic-bezier(.34,1.4,.64,1);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    user-select: none;
  }
  .ep:hover {
    color: var(--text);
    border-color: var(--accent);
    transform: translateY(-3px) scale(1.04);
    box-shadow: 0 8px 22px var(--accent-glow);
  }
  .ep:active { transform: translateY(-1px) scale(.98); }
  .ep.on {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: #fff; border-color: transparent;
    font-weight: 800;
    box-shadow: 0 8px 24px var(--accent-glow);
  }
  .ep.on:hover { transform: translateY(-3px) scale(1.06); }

  .empty {
    text-align: center;
    padding: 90px 20px;
    color: var(--sub); font-size: 14px;
    font-weight: 500;
  }
  .empty .ico { font-size: 52px; margin-bottom: 18px; opacity: .45; }

  .player-error {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: rgba(0,0,0,.85);
    color: #fff; gap: 16px;
    font-size: 14px; font-weight: 500;
    padding: 24px; text-align: center;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .player-error button {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    border: none; color: #fff;
    padding: 11px 26px;
    border-radius: 11px;
    font-size: 14px; font-weight: 700;
    cursor: pointer;
    box-shadow: 0 10px 28px var(--accent-glow);
    transition: all .3s cubic-bezier(.34,1.4,.64,1);
  }
  .player-error button:hover { transform: translateY(-2px) scale(1.05); }
  .player-error button:active { transform: translateY(0) scale(.94); }

  .topbar {
    position: fixed; top: 0; left: 0;
    height: 3px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2), var(--accent-3), var(--accent));
    background-size: 200% 100%;
    width: 0; z-index: 999;
    transition: width .3s cubic-bezier(.34,1.4,.64,1);
    box-shadow: 0 0 16px var(--accent-glow), 0 0 32px var(--accent-glow-2);
    border-radius: 0 3px 3px 0;
    animation: topbar-shine 2s linear infinite;
  }
  @keyframes topbar-shine {
    0% { background-position: 0% 0; }
    100% { background-position: 200% 0; }
  }

  /* ============================================================
     浅色模式：iOS 26 液态玻璃
     ============================================================ */
  :root[data-theme="light"] body {
    background:
      radial-gradient(1200px 700px at 15% -10%, #ffd9c2 0%, transparent 55%),
      radial-gradient(900px 600px at 90% 5%, #c9e0ff 0%, transparent 55%),
      radial-gradient(900px 700px at 50% 100%, #f5d6ff 0%, transparent 55%),
      linear-gradient(180deg, #eef1f8 0%, #e7ebf5 100%);
    background-attachment: fixed;
  }
  :root[data-theme="light"] body::before {
    background:
      radial-gradient(50% 80% at 20% 0%, rgba(255,255,255,.7) 0%, transparent 65%),
      radial-gradient(45% 70% at 85% 5%, rgba(201,224,255,.55) 0%, transparent 60%);
    opacity: 1;
  }

  :root[data-theme="light"] header {
    background: rgba(255,255,255,.48);
    backdrop-filter: blur(32px) saturate(200%);
    -webkit-backdrop-filter: blur(32px) saturate(200%);
    border-bottom: 1px solid rgba(255,255,255,.7);
    box-shadow: 0 8px 32px rgba(120,130,180,.10), inset 0 -1px 0 rgba(255,255,255,.6);
  }

  :root[data-theme="light"] .icon-btn {
    background: linear-gradient(145deg, rgba(255,255,255,.9), rgba(255,255,255,.55));
    border: 1px solid rgba(255,255,255,.9);
    box-shadow:
      0 6px 18px rgba(120,130,180,.12),
      inset 0 1px 0 rgba(255,255,255,1),
      inset 0 -1px 0 rgba(180,190,220,.25);
    color: #2a3145;
  }
  :root[data-theme="light"] .icon-btn:hover {
    background: linear-gradient(145deg, rgba(255,255,255,1), rgba(255,255,255,.75));
    border-color: rgba(255,94,46,.5);
    color: var(--accent);
    box-shadow:
      0 10px 28px var(--accent-glow),
      inset 0 1px 0 rgba(255,255,255,1);
  }

  :root[data-theme="light"] .search {
    background: linear-gradient(145deg, rgba(255,255,255,.85), rgba(255,255,255,.5));
    border: 1px solid rgba(255,255,255,.95);
    box-shadow:
      0 8px 24px rgba(120,130,180,.10),
      inset 0 1px 0 rgba(255,255,255,1),
      inset 0 -1px 0 rgba(180,190,220,.2);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
  }
  :root[data-theme="light"] .search:focus-within {
    border-color: rgba(255,94,46,.6);
    box-shadow:
      0 0 0 4px var(--accent-glow),
      0 12px 32px var(--accent-glow),
      inset 0 1px 0 rgba(255,255,255,1);
  }
  :root[data-theme="light"] .search input::placeholder { color: #8b93a7; }

  :root[data-theme="light"] .stats-bar {
    background: linear-gradient(145deg, rgba(255,255,255,.75), rgba(255,255,255,.45));
    border: 1px solid rgba(255,255,255,.95);
    box-shadow:
      0 8px 24px rgba(120,130,180,.10),
      inset 0 1px 0 rgba(255,255,255,1);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
  }

  :root[data-theme="light"] .drawer {
    background: linear-gradient(180deg, rgba(255,255,255,.55) 0%, rgba(255,255,255,.35) 100%);
    backdrop-filter: blur(56px) saturate(220%);
    -webkit-backdrop-filter: blur(56px) saturate(220%);
    border: 1px solid rgba(255,255,255,.7);
    box-shadow: 0 24px 64px rgba(80,90,140,.18);
  }
  :root[data-theme="light"] .drawer-head {
    border-bottom: 1px solid rgba(255,255,255,.5);
  }
  :root[data-theme="light"] .nav-item {
    color: #3a4258;
  }
  :root[data-theme="light"] .nav-item:hover {
    background: linear-gradient(145deg, rgba(255,255,255,.75), rgba(255,255,255,.45));
    box-shadow: 0 6px 18px rgba(120,130,180,.10), inset 0 1px 0 rgba(255,255,255,.8);
    color: #0f1424;
  }
  :root[data-theme="light"] .drawer-mask {
    background: rgba(120,130,180,.06);
    backdrop-filter: blur(10px) saturate(120%);
    -webkit-backdrop-filter: blur(10px) saturate(120%);
  }
  :root[data-theme="light"] .tg-marquee::before {
    background: linear-gradient(90deg, rgba(238,241,248,1) 0%, transparent 100%);
  }
  :root[data-theme="light"] .tg-marquee::after {
    background: linear-gradient(270deg, rgba(238,241,248,1) 0%, transparent 100%);
  }

  :root[data-theme="light"] .card {
    background: linear-gradient(160deg, rgba(255,255,255,.85) 0%, rgba(255,255,255,.55) 100%);
    border: 1px solid rgba(255,255,255,.95);
    box-shadow:
      0 10px 30px rgba(120,130,180,.12),
      0 2px 6px rgba(120,130,180,.06),
      inset 0 1px 0 rgba(255,255,255,1);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
  }
  :root[data-theme="light"] .card:hover {
    border-color: rgba(255,94,46,.4);
    box-shadow:
      0 24px 60px rgba(120,130,180,.22),
      0 0 0 1px var(--accent-glow),
      0 0 40px var(--accent-glow-2),
      inset 0 1px 0 rgba(255,255,255,1);
  }
  :root[data-theme="light"] .card-title { color: #0f1424; }

  :root[data-theme="light"] .hero-card {
    border: 1px solid rgba(255,255,255,.95);
    box-shadow:
      0 16px 44px rgba(120,130,180,.20),
      0 2px 8px rgba(120,130,180,.08),
      inset 0 1px 0 rgba(255,255,255,1);
  }
  :root[data-theme="light"] .hero-card:hover {
    box-shadow:
      0 32px 72px rgba(120,130,180,.28),
      0 0 0 1px var(--accent-glow),
      0 0 60px var(--accent-glow-2);
  }

  :root[data-theme="light"] .pager button,
  :root[data-theme="light"] .pager .goto input {
    background: linear-gradient(145deg, rgba(255,255,255,.9), rgba(255,255,255,.6));
    border: 1px solid rgba(255,255,255,.95);
    box-shadow:
      0 6px 18px rgba(120,130,180,.12),
      inset 0 1px 0 rgba(255,255,255,1);
    color: #2a3145;
  }
  :root[data-theme="light"] .pager button:hover:not(:disabled) {
    background: linear-gradient(145deg, rgba(255,255,255,1), rgba(255,255,255,.8));
    border-color: rgba(255,94,46,.6);
    color: var(--accent);
    box-shadow: 0 10px 26px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,1);
  }
  :root[data-theme="light"] .pager .pg-info { color: #5f6880; }

  :root[data-theme="light"] .player-wrap {
    border: 1px solid rgba(255,255,255,.95);
    box-shadow:
      0 24px 60px rgba(120,130,180,.22),
      0 0 60px var(--accent-glow-2),
      inset 0 1px 0 rgba(255,255,255,1);
  }
  :root[data-theme="light"] .detail-head .poster {
    border: 1px solid rgba(255,255,255,.95);
    box-shadow:
      0 16px 40px rgba(120,130,180,.20),
      0 0 30px var(--accent-glow-2),
      inset 0 1px 0 rgba(255,255,255,1);
  }
  :root[data-theme="light"] .back-btn,
  :root[data-theme="light"] .close-btn {
    background: linear-gradient(145deg, rgba(255,255,255,.9), rgba(255,255,255,.6));
    border: 1px solid rgba(255,255,255,.95);
    box-shadow:
      0 6px 18px rgba(120,130,180,.12),
      inset 0 1px 0 rgba(255,255,255,1);
    color: #3a4258;
  }
  :root[data-theme="light"] .back-btn:hover,
  :root[data-theme="light"] .close-btn:hover {
    color: var(--accent);
    border-color: rgba(255,94,46,.5);
    box-shadow: 0 10px 26px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,1);
  }

  :root[data-theme="light"] .ep {
    background: linear-gradient(145deg, rgba(255,255,255,.9), rgba(255,255,255,.55));
    border: 1px solid rgba(255,255,255,.95);
    box-shadow:
      0 4px 14px rgba(120,130,180,.10),
      inset 0 1px 0 rgba(255,255,255,1);
    color: #3a4258;
    backdrop-filter: blur(16px) saturate(180%);
    -webkit-backdrop-filter: blur(16px) saturate(180%);
  }
  :root[data-theme="light"] .ep:hover {
    border-color: rgba(255,94,46,.5);
    color: var(--accent);
    box-shadow: 0 10px 26px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,1);
  }

  :root[data-theme="light"] .tag {
    background: linear-gradient(145deg, rgba(255,255,255,.9), rgba(255,255,255,.6));
    border: 1px solid rgba(255,255,255,.95);
    color: #5f6880;
    box-shadow: 0 4px 12px rgba(120,130,180,.10), inset 0 1px 0 rgba(255,255,255,1);
  }
  :root[data-theme="light"] .desc { color: #5f6880; }
</style>
</head>
<body>

<div class="topbar" id="topbar"></div>

<div class="drawer-mask" id="drawerMask"></div>
<aside class="drawer" id="drawer">
  <div class="drawer-head">
    <div class="avatar"><img src="https://jsnz.pages.dev/f/5ab7e916.gif" alt="头像"></div>
    <div class="info">
      <div class="name">裤佬Ai短剧</div>
      <div class="sub">✈️@stymei</div>
    </div>
    <button class="close" id="drawerClose" title="关闭">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>
  <div class="drawer-body">
    <div class="drawer-label">分类</div>
    <div id="drawerCats"></div>
  </div>
</aside>

<header>
  <div class="top">
    <button class="icon-btn" id="menuBtn" title="菜单">
      <svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
    <div class="brand" onclick="goHome()">
      <div class="logo">裤佬Ai短剧</div>
      <div class="avatar"><img src="https://jsnz.pages.dev/f/5ab7e916.gif" alt="头像"></div>
    </div>
    <button class="icon-btn theme-btn" id="themeBtn" title="切换主题">
      <svg class="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
      <svg class="moon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    </button>
  </div>
  <div class="search-wrap">
    <div class="search">
      <input id="wd" type="search" placeholder="搜索你想看的短剧…" autocomplete="off"
             onkeydown="if(event.key==='Enter')doSearch()">
      <button onclick="doSearch()">搜索</button>
    </div>
  </div>
  <div class="stats-bar" id="statsBar" style="display:none">
    <span class="dot"></span>
    <span>全站已收录 <b id="statTotal">10万+</b> 部作品</span>
  </div>
</header>

<main id="app"></main>

<script>
const API_BASE = "";
const TG_LINK = "https://t.me/stymei";

(function initTheme() {
  const saved = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
})();
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
}

const state = {
  top: [],
  tid: "explore",
  pg: 1,
  pagecount: 1,
  total: 0,
  list: [],
  mode: "home",
  keyword: "",
  loading: false,
  detail: null,
  episodes: [],
  currentEp: 0,
  hls: null,
  savedScrollY: 0,
  heroList: [],
};

function shuffle(arr) {
  const a = [...(arr || [])];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function api(path, params) {
  const p = Object.assign({}, params || {});
  p._t = Date.now();
  const qs = "?" + new URLSearchParams(p).toString();
  return fetch(API_BASE + path + qs, { cache: "no-store" }).then(r => r.json());
}
function progress(on) {
  const bar = document.getElementById("topbar");
  if (on) { bar.style.width = "70%"; bar.style.opacity = "1"; }
  else { bar.style.width = "100%"; setTimeout(() => { bar.style.opacity = "0"; bar.style.width = "0"; }, 300); }
}
function esc(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function openDrawer() {
  document.getElementById("drawer").classList.add("show");
  document.getElementById("drawerMask").classList.add("show");
  document.body.style.overflow = "hidden";
}
function closeDrawer() {
  document.getElementById("drawer").classList.remove("show");
  document.getElementById("drawerMask").classList.remove("show");
  document.body.style.overflow = "";
}

function renderCats() {
  const box = document.getElementById("drawerCats");
  if (!box) return;
  box.innerHTML = state.top.map((c, i) => {
    const tid = String(c.type_id);
    const isActive = state.mode === "category" && state.tid === tid;
    const delay = Math.min(i * 0.03, 0.4).toFixed(2);
    return \`
      <div class="nav-item \${isActive ? 'active' : ''}" data-tid="\${esc(tid)}" style="animation-delay:\${delay}s">
        \${esc(c.type_name)}
      </div>
    \`;
  }).join("");
  box.querySelectorAll(".nav-item").forEach(node => {
    node.onclick = () => switchCategory(node.dataset.tid);
  });
}

function switchCategory(tid) {
  state.tid = String(tid);
  state.pg = 1;
  state.list = [];
  state.mode = "category";
  state.savedScrollY = 0;
  renderCats();
  renderList(true);
  loadCategory();
  closeDrawer();
}

async function loadStats() {
  try {
    const data = await api("/stats");
    if (data) {
      state.total = data.total || 0;
      state.top = data.top || [];
      const bar = document.getElementById("statsBar");
      document.getElementById("statTotal").textContent = data.displayText || "10万+";
      bar.style.display = "flex";
      renderCats();
    }
  } catch (e) { console.warn("stats fail", e); }
}

async function goHome() {
  state.mode = "home";
  state.pg = 1;
  state.list = [];
  state.keyword = "";
  state.savedScrollY = 0;
  document.getElementById("wd").value = "";
  renderCats();
  progress(true);
  try {
    const [homeData] = await Promise.all([api("/home"), loadStats()]);
    if (homeData.top) state.top = homeData.top;

    const heroAll = shuffle(homeData.hero || []);
    const heroCount = 4 + Math.floor(Math.random() * 3);
    state.heroList = heroAll.slice(0, heroCount);
    state.list = shuffle(homeData.list || []).slice(0, 30);

    renderCats();
    renderHome();
  } catch (e) {
    renderEmpty("加载失败，请稍后重试");
  }
  progress(false);
}

function renderHome() {
  const app = document.getElementById("app");
  const heroes = state.heroList || [];

  const heroCards = heroes.map((h, i) => \`
    <div class="hero-card" data-i="\${i}">
      <div class="hero-badge">✨ 随机推荐</div>
      <img src="\${esc(h.vod_pic)}" alt="" onerror="this.style.opacity=.15">
      <div class="hero-info">
        <div class="hero-tag">今日精选</div>
        <div class="hero-title">\${esc(h.vod_name)}</div>
        \${h.vod_remarks ? \`<div class="hero-desc">\${esc(h.vod_remarks)}</div>\` : ""}
      </div>
    </div>
  \`).join("");

  const dots = heroes.map((_, i) => \`<div class="dot-item \${i === 0 ? 'on' : ''}" data-i="\${i}"></div>\`).join("");

  const cards = state.list.map((it, i) => \`
    <div class="card" data-i="\${i}">
      <div class="thumb">
        <img loading="lazy" src="\${esc(it.vod_pic)}" alt="" onerror="this.style.opacity=.15">
      </div>
      <div class="card-title">\${esc(it.vod_name)}</div>
    </div>
  \`).join("");

  const tgItemHtml = \`
    <span class="tg-item">
      <span class="tg-plane">✈️</span>
      <span>关注裤佬TG频道</span>
      <span class="tg-link">https://t.me/stymei</span>
    </span>
  \`;

  app.innerHTML = \`
    <a class="tg-marquee" href="\${esc(TG_LINK)}" target="_blank" rel="noopener" title="关注裤佬TG频道">
      <div class="tg-track">
        \${tgItemHtml}\${tgItemHtml}\${tgItemHtml}\${tgItemHtml}
      </div>
    </a>
    <div class="hero-scroll" id="heroScroll">\${heroCards}</div>
    <div class="hero-dots" id="heroDots">\${dots}</div>
    <div class="section-title">热门推荐</div>
    <div class="grid">\${cards}</div>
  \`;

  app.querySelectorAll(".hero-card").forEach(node => {
    node.onclick = () => openDetail(heroes[+node.dataset.i]);
  });
  app.querySelectorAll(".grid .card").forEach(node => {
    node.onclick = () => openDetail(state.list[+node.dataset.i]);
  });

  const scroll = document.getElementById("heroScroll");
  const dotsEl = document.getElementById("heroDots");
  if (scroll && dotsEl) {
    scroll.addEventListener("scroll", () => {
      const cardW = scroll.querySelector(".hero-card")?.offsetWidth || 1;
      const gap = 14;
      const idx = Math.round(scroll.scrollLeft / (cardW + gap));
      dotsEl.querySelectorAll(".dot-item").forEach((d, i) => {
        d.classList.toggle("on", i === idx);
      });
    }, { passive: true });
    dotsEl.querySelectorAll(".dot-item").forEach((d, i) => {
      d.onclick = () => {
        const card = scroll.querySelectorAll(".hero-card")[i];
        if (card) card.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
      };
    });
  }
}

async function loadCategory() {
  if (state.loading) return;
  state.loading = true;
  progress(true);
  try {
    const data = await api("/category", { tid: state.tid, pg: state.pg });
    state.list = data.list || [];
    state.pagecount = data.pagecount || 1;
    state.total = data.total || 0;
    renderList();
  } catch (e) {
    if (state.list.length === 0) renderEmpty("加载失败");
  }
  state.loading = false;
  progress(false);
}

async function doSearch() {
  const wd = document.getElementById("wd").value.trim();
  if (!wd) return;
  state.mode = "search";
  state.keyword = wd;
  state.pg = 1;
  state.list = [];
  state.savedScrollY = 0;
  renderCats();
  renderList(true);
  progress(true);
  try {
    const data = await api("/search", { wd, pg: 1 });
    state.list = data.list || [];
    state.pagecount = data.pagecount || 1;
    state.total = data.total || 0;
    renderList();
    if (state.list.length === 0) renderEmpty("未找到「" + esc(wd) + "」相关作品");
  } catch (e) {
    renderEmpty("搜索失败");
  }
  progress(false);
}

function renderList(skeleton) {
  const app = document.getElementById("app");

  if (skeleton && state.list.length === 0) {
    app.innerHTML = \`<div class="grid">\${
      Array.from({length: 12}).map(() => \`
        <div class="card skel"><div class="thumb"></div><div class="card-title"></div></div>
      \`).join("")
    }</div>\`;
    return;
  }

  if (state.list.length === 0) return;

  const title = state.mode === "search"
    ? \`搜索结果：\${esc(state.keyword)}\`
    : (state.top.find(c => String(c.type_id) === state.tid)?.type_name || "作品");

  const cards = state.list.map((it, i) => \`
    <div class="card" data-i="\${i}">
      <div class="thumb">
        <img loading="lazy" src="\${esc(it.vod_pic)}" alt="" onerror="this.style.opacity=.15">
      </div>
      <div class="card-title">\${esc(it.vod_name)}</div>
    </div>
  \`).join("");

  const PAGE_SIZE = 24;
  const isLastPage = state.list.length < PAGE_SIZE;
  const pg = state.pg;
  const knownTotal = isLastPage ? pg : pg + 1;
  const totalText = isLastPage
    ? \`共 <b>\${knownTotal}</b> 页\`
    : \`共 <b>\${knownTotal}+</b> 页\`;

  const pagerHtml = \`
    <div class="pager">
      <button id="pgFirst" \${pg <= 1 ? "disabled" : ""}>首页</button>
      <button id="pgPrev" \${pg <= 1 ? "disabled" : ""}>上一页</button>
      <div class="pg-info">第 <b>\${pg}</b> 页 · \${totalText}</div>
      <button id="pgNext" \${isLastPage ? "disabled" : ""}>下一页</button>
      <button id="pgLast" \${isLastPage ? "disabled" : ""}>末页</button>
      <div class="goto"><input type="number" id="pgInput" min="1" placeholder="页码"></div>
    </div>
  \`;

  app.innerHTML = \`
    <div class="section-title">\${title}</div>
    <div class="grid">\${cards}</div>
    \${pagerHtml}
  \`;

  app.querySelectorAll(".card").forEach(node => {
    node.onclick = () => openDetail(state.list[+node.dataset.i]);
  });

  const jumpTo = (p) => {
    if (p < 1) return;
    if (isLastPage && p > pg) return;
    if (p === pg) return;
    state.pg = p;
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (state.mode === "category") loadCategory();
    else if (state.mode === "search") loadSearchPage();
  };
  const $ = (id) => document.getElementById(id);
  if ($("pgFirst")) $("pgFirst").onclick = () => jumpTo(1);
  if ($("pgPrev")) $("pgPrev").onclick = () => jumpTo(pg - 1);
  if ($("pgNext")) $("pgNext").onclick = () => jumpTo(pg + 1);
  if ($("pgLast")) {
    $("pgLast").onclick = () => {
      if (isLastPage) return;
      jumpTo(pg + 1);
    };
  }
  if ($("pgInput")) $("pgInput").onkeydown = (e) => {
    if (e.key === "Enter") {
      const v = parseInt($("pgInput").value);
      if (v) jumpTo(v);
    }
  };
}

async function loadSearchPage() {
  if (state.loading) return;
  state.loading = true;
  progress(true);
  try {
    const data = await api("/search", { wd: state.keyword, pg: state.pg });
    state.list = data.list || [];
    state.pagecount = data.pagecount || 1;
    renderList();
  } catch (e) {}
  state.loading = false;
  progress(false);
}

function renderEmpty(msg) {
  document.getElementById("app").innerHTML = \`<div class="empty"><div class="ico">🎬</div><div>\${msg || "暂无内容"}</div></div>\`;
}

async function openDetail(item) {
  if (!item || !item.vod_id) return;
  state.savedScrollY = window.scrollY || window.pageYOffset || 0;
  state.mode = "detail";
  state.detail = { ...item };
  state.episodes = [];
  state.currentEp = 0;
  window.scrollTo(0, 0);
  renderDetailSkeleton();
  progress(true);
  try {
    const data = await api("/detail", { id: item.vod_id });
    const d = (data.list && data.list[0]) || null;
    if (d) {
      state.detail = d;
      state.episodes = parseEpisodes(d.vod_play_url);
      renderDetail();
    }
  } catch (e) { console.log("detail error", e); }
  progress(false);
}

function parseEpisodes(playUrl) {
  if (!playUrl) return [];
  return playUrl.split("#").map(part => {
    const idx = part.indexOf("$");
    if (idx < 0) return null;
    return {
      title: part.slice(0, idx).trim(),
      playId: part.slice(idx + 1).trim()
    };
  }).filter(Boolean);
}

function renderDetailSkeleton() {
  document.getElementById("app").innerHTML = \`
    <div class="player-toolbar">
      <div class="back-btn" id="backBtn">← 返回</div>
      <div class="toolbar-right"><button class="close-btn" id="closeBtn" title="关闭">✕</button></div>
    </div>
    <div class="player-wrap" id="playerWrap">
      <video id="video" controls playsinline preload="metadata"></video>
    </div>
    <div class="detail-head">
      <div class="poster"></div>
      <div class="detail-info"><h1 style="color:var(--sub);font-size:15px">加载中…</h1></div>
    </div>
  \`;
  document.getElementById("backBtn").onclick = closePlayer;
  document.getElementById("closeBtn").onclick = closePlayer;
}

function renderDetail() {
  const app = document.getElementById("app");
  const d = state.detail || {};
  const title = d.vod_name || "作品";
  const pic = d.vod_pic || "";
  const desc = d.vod_content || "";
  const remark = d.vod_remarks || "";

  const epHtml = state.episodes.map((ep, i) => \`
    <div class="ep \${i === state.currentEp ? 'on' : ''}" data-idx="\${i}">\${esc(ep.title)}</div>
  \`).join("");

  app.innerHTML = \`
    <div class="player-toolbar">
      <div class="back-btn" id="backBtn">← 返回</div>
      <div class="toolbar-right"><button class="close-btn" id="closeBtn" title="关闭">✕</button></div>
    </div>
    <div class="player-wrap" id="playerWrap">
      <video id="video" controls playsinline preload="metadata" poster="\${esc(pic)}"></video>
    </div>
    <div class="detail-head">
      <div class="poster"><img src="\${esc(pic)}" onerror="this.style.opacity=.15"></div>
      <div class="detail-info">
        <h1>\${esc(title)}</h1>
        <div class="tags">
          <span class="tag accent">野果短剧</span>
          \${remark ? \`<span class="tag">\${esc(remark)}</span>\` : ""}
        </div>
        \${desc ? \`<div class="desc">\${esc(desc)}</div>\` : ""}
      </div>
    </div>
    <div class="ep-section-title">选集 · 共 \${state.episodes.length} 集</div>
    <div class="episodes">\${epHtml || '<div style="color:var(--sub);font-size:13px">暂无剧集</div>'}</div>
  \`;

  document.getElementById("backBtn").onclick = closePlayer;
  document.getElementById("closeBtn").onclick = closePlayer;
  app.querySelectorAll(".ep").forEach(node => {
    node.onclick = () => {
      const idx = parseInt(node.dataset.idx);
      if (idx !== state.currentEp) playEpisode(idx);
    };
  });
  if (state.episodes.length > 0) playEpisode(0);
}

async function playEpisode(idx) {
  if (idx < 0 || idx >= state.episodes.length) return;
  state.currentEp = idx;
  document.querySelectorAll(".ep").forEach((el, i) => el.classList.toggle("on", i === idx));
  showPlayerLoading(\`正在加载第 \${idx + 1} 集…\`);
  const ep = state.episodes[idx];
  try {
    const data = await api("/play", { id: ep.playId });
    if (!data || !data.url) { showPlayerError("解析播放地址失败"); return; }
    playVideo(data.url);
  } catch (e) {
    showPlayerError("请求失败：" + (e.message || e));
  }
}

function closePlayer() {
  destroyPlayer();
  const backMode = (state.mode === "search") ? "search" : "category";
  state.mode = backMode;
  state.detail = null;
  state.episodes = [];
  renderList();
  renderCats();
  requestAnimationFrame(() => window.scrollTo(0, state.savedScrollY || 0));
}

function destroyPlayer() {
  if (state.hls) { try { state.hls.destroy(); } catch (e) {} state.hls = null; }
  const v = document.getElementById("video");
  if (v) {
    try { v.pause(); } catch (e) {}
    try { v.removeAttribute("src"); v.load(); } catch (e) {}
    v.onended = null;
  }
}

function showPlayerLoading(msg) {
  const wrap = document.getElementById("playerWrap");
  if (!wrap) return;
  wrap.querySelectorAll(".player-error").forEach(n => n.remove());
  const div = document.createElement("div");
  div.className = "player-error";
  div.style.background = "rgba(0,0,0,.6)";
  div.innerHTML = \`<div>\${esc(msg)}</div>\`;
  wrap.appendChild(div);
}
function showPlayerError(msg) {
  const wrap = document.getElementById("playerWrap");
  if (!wrap) return;
  wrap.querySelectorAll(".player-error").forEach(n => n.remove());
  const div = document.createElement("div");
  div.className = "player-error";
  div.innerHTML = \`<div>⚠️ \${esc(msg)}</div><button id="retryPlay">重试</button>\`;
  wrap.appendChild(div);
  div.querySelector("#retryPlay").onclick = () => { div.remove(); playEpisode(state.currentEp); };
}
function showPlayerLoadingHide() {
  const wrap = document.getElementById("playerWrap");
  if (!wrap) return;
  wrap.querySelectorAll(".player-error").forEach(n => n.remove());
}
function showFinishedOverlay() {
  const wrap = document.getElementById("playerWrap");
  if (!wrap) return;
  wrap.querySelectorAll(".player-error").forEach(n => n.remove());
  const div = document.createElement("div");
  div.className = "player-error";
  div.style.background = "rgba(0,0,0,.75)";
  div.innerHTML = \`<div>🎉 已看完最后一集</div>\`;
  wrap.appendChild(div);
}

function playVideo(src) {
  destroyPlayer();
  const v = document.getElementById("video");
  if (!v) return;

  v.onended = () => {
    const next = state.currentEp + 1;
    if (next < state.episodes.length) {
      playEpisode(next);
      setTimeout(() => {
        const el = document.querySelector(\`.ep[data-idx="\${next}"]\`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } else showFinishedOverlay();
  };

  const isM3u8 = src.includes(".m3u8") || src.includes("mpegurl") || src.includes("/proxy?url=");

  if (isM3u8 && window.Hls && Hls.isSupported()) {
    const hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60, enableWorker: true, lowLatencyMode: false });
    state.hls = hls;
    hls.loadSource(src);
    hls.attachMedia(v);
    hls.on(Hls.Events.MANIFEST_PARSED, () => { showPlayerLoadingHide(); v.play().catch(() => {}); });
    hls.on(Hls.Events.ERROR, (e, data) => {
      if (data && data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR: showPlayerError("网络错误，播放失败"); break;
          case Hls.ErrorTypes.MEDIA_ERROR: try { hls.recoverMediaError(); } catch (err) { showPlayerError("媒体解码失败"); } break;
          default: showPlayerError("播放失败：" + (data.details || "未知错误"));
        }
      }
    });
  } else {
    v.src = src;
    v.addEventListener("loadedmetadata", () => { showPlayerLoadingHide(); v.play().catch(() => {}); }, { once: true });
    v.addEventListener("error", () => showPlayerError("播放失败"), { once: true });
  }
}

document.getElementById("menuBtn").onclick = openDrawer;
document.getElementById("drawerClose").onclick = closeDrawer;
document.getElementById("drawerMask").onclick = closeDrawer;
document.getElementById("themeBtn").onclick = toggleTheme;

(async function boot() {
  await loadStats();
  renderCats();
  goHome();
})();
<\/script>
</body>
</html>`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*"
        }
      });
    }

    try {
      if (API_PATHS.has(path)) {
        switch (path) {
          case "/home":     return await handleHome(url);
          case "/category": return await handleCategory(url);
          case "/detail":   return await handleDetail(url);
          case "/play":     return await handlePlay(url);
          case "/search":   return await handleSearch(url);
          case "/proxy":    return await handleProxy(url);
          case "/stats":    return await handleStats(url);
        }
      }

      if (path === "/" || path === "/index.html") {
        return new Response(INDEX_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" }
        });
      }

      if (env && env.ASSETS) return env.ASSETS.fetch(request);
      return new Response("Not Found", { status: 404 });
    } catch (e) {
      console.log("[Worker Error]", e.message);
      return new Response("Worker Error: " + e.message, { status: 500 });
    }
  }
};