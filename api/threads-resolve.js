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

// Threads' normal post page is a JS-rendered app shell — the real media
// URLs are fetched client-side after load, so scraping it directly only
// yields a generic placeholder icon. The /embed variant of the same post
// is what Threads itself serves for iframe embeds elsewhere on the web,
// so it MUST be server-rendered with the real media baked into the HTML.
// We try that first, then fall back to the normal page.
function buildEmbedUrl(url) {
  try {
    const u = new URL(url);
    u.search = ""; // drop tracking params like ?xmt=...
    if (!/\/embed\/?$/.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/$/, "") + "/embed";
    }
    return u.toString();
  } catch {
    return null;
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
  const seen = new Set();

  // video urls: video_url / playback_url / video_versions[].url
  const videoPatterns = [
    /"(video_url|playback_url)":"([^"]+\.mp4[^"]*)"/g,
    /"video_versions":\s*\[\s*{[^}]*?"url":"([^"]+\.mp4[^"]*)"/g,
  ];
  for (const re of videoPatterns) {
    let m;
    while ((m = re.exec(html))) {
      const raw = m[2] || m[1];
      const url = raw.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
      if (url && url.includes(".mp4") && !seen.has(url)) {
        seen.add(url);
        items.push({ type: "video", url });
      }
    }
  }

  // image urls: display_url / src / image_versions2 candidates
  const imagePatterns = [
    /"(display_url|src)":"([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/g,
    /"image_versions2":\s*{\s*"candidates":\s*\[\s*{[^}]*?"url":"([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/g,
  ];
  for (const re of imagePatterns) {
    let m;
    while ((m = re.exec(html))) {
      const raw = m[2] || m[1];
      const url = raw.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
      if (url && !seen.has(url)) {
        seen.add(url);
        items.push({ type: "image", url });
      }
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
    let html = "";
    const embedUrl = buildEmbedUrl(url);

    // Attempt 1: the /embed snapshot (server-rendered, most likely to
    // contain real media instead of a generic placeholder icon).
    if (embedUrl) {
      try {
        html = await fetchHtml(embedUrl);
      } catch {
        html = "";
      }
    }

    // Attempt 2: fall back to the normal post/profile page if the embed
    // page failed to load or didn't contain any usable media.
    let carousel = html ? embeddedCarousel(html) : [];
    let meta = html ? metaTags(html) : {};
    const embedHadMedia = carousel.length > 0 || meta.video || meta.image;

    if (!embedHadMedia) {
      html = await fetchHtml(url);
      carousel = embeddedCarousel(html);
      meta = metaTags(html);
    }

    if (mode === "profile") {
      const items = meta.image ? [{ type: "image", url: meta.image, thumb: meta.image }] : [];
      return res.status(200).json({ items });
    }

    if (carousel.length > 1) {
      return res.status(200).json({ items: carousel });
    }

    const items = [];
    if (meta.video) items.push({ type: "video", url: meta.video, thumb: meta.image || "" });
    else if (meta.image) items.push({ type: "image", url: meta.image, thumb: meta.image });
    else if (carousel.length === 1) items.push(carousel[0]);

    return res.status(200).json({ items });
  } catch (err) {
    return res.status(502).json({ error: "resolve_failed", detail: String(err), items: [] });
  }
};
    return res.status(502).json({ error: "resolve_failed", detail: String(err), items: [] });
  }
};
