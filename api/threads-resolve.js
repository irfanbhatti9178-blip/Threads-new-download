/**
 * FullyTool — Threads Media Resolver (Vercel Serverless Function)
 * ------------------------------------------------------------
 * Deploy path: api/threads-resolve.js  →  Vercel auto-exposes it at
 *   https://<your-project>.vercel.app/api/threads-resolve
 *
 * Same extraction logic as the Node/Express version, just wrapped
 * in Vercel's (req, res) handler format instead of an Express app.
 * ------------------------------------------------------------
 */

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function isThreadsUrl(url) {
  try {
    const u = new URL(url);
    return /(^|\.)threads\.(net|com)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error("fetch_failed_" + res.status);
  return res.text();
}

function metaTags(html) {
  const out = {};
  const patterns = {
    video: /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    image: /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
  };
  for (const [key, re] of Object.entries(patterns)) {
    const m = html.match(re);
    if (m) out[key] = m[1].replace(/&amp;/g, "&");
  }
  return out;
}

function embeddedCarousel(html) {
  const items = [];
  const urlPattern = /"(video_url|playback_url)":"([^"]+\.mp4[^"]*)"/g;
  const imgPattern = /"(display_url|src)":"([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/g;
  let m;
  const seen = new Set();

  while ((m = urlPattern.exec(html))) {
    const url = m[2].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    if (!seen.has(url)) {
      seen.add(url);
      items.push({ type: "video", url });
    }
  }
  while ((m = imgPattern.exec(html))) {
    const url = m[2].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    if (!seen.has(url)) {
      seen.add(url);
      items.push({ type: "image", url });
    }
  }
  return items;
}

module.exports = async function handler(req, res) {
  // CORS so the Blogger-hosted frontend can call this cross-origin
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url, mode } = req.query;

  if (!url || !isThreadsUrl(url)) {
    return res.status(400).json({ error: "invalid_url", items: [] });
  }

  try {
    const html = await fetchHtml(url);

    if (mode === "profile") {
      const meta = metaTags(html);
      const items = meta.image ? [{ type: "image", url: meta.image, thumb: meta.image }] : [];
      return res.status(200).json({ items });
    }

    const carousel = embeddedCarousel(html);
    if (carousel.length > 1) {
      return res.status(200).json({ items: carousel });
    }

    const meta = metaTags(html);
    const items = [];
    if (meta.video) items.push({ type: "video", url: meta.video, thumb: meta.image || "" });
    else if (meta.image) items.push({ type: "image", url: meta.image, thumb: meta.image });
    else if (carousel.length === 1) items.push(carousel[0]);

    return res.status(200).json({ items });
  } catch (err) {
    return res.status(502).json({ error: "resolve_failed", detail: String(err), items: [] });
  }
};
