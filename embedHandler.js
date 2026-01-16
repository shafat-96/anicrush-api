const axios = require("axios");

const MEGACLOUD_URL = "https://megacloud.blog";
const KEY_URL =
  "https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json";
const DECODE_URL =
  "https://script.google.com/macros/s/AKfycbx-yHTwupis_JD0lNzoOnxYcEYeXmJZrg7JeMxYnEZnLBy5V0--UxEvP-y9txHyy1TX9Q/exec";

const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

let cachedKey = null;

/* ---------------- NONCE ---------------- */

function extractNonce(html) {
  const m48 = html.match(/\b[a-zA-Z0-9]{48}\b/);
  if (m48) return m48[0];

  const m3x16 = html.match(
    /\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b/
  );
  if (m3x16) return m3x16.slice(1).join("");

  return null;
}

/* ---------------- KEY ---------------- */

async function fetchKey() {
  if (cachedKey) return cachedKey;

  const { data } = await axios.get(KEY_URL, {
    headers: { "User-Agent": UA },
  });

  if (!data?.mega) throw new Error("Mega key missing");
  cachedKey = data.mega;
  return cachedKey;
}

/* ---------------- DECRYPT ---------------- */

async function decrypt(encrypted, nonce, key) {
  const url =
    `${DECODE_URL}?encrypted_data=${encodeURIComponent(encrypted)}` +
    `&nonce=${encodeURIComponent(nonce)}` +
    `&secret=${encodeURIComponent(key)}`;

  const { data } = await axios.get(url);
  const m = data?.match(/"file":"(.*?)"/);
  if (!m) throw new Error("Decryption failed");

  return m[1].replace(/\\\//g, "/");
}

/* ---------------- MAIN ---------------- */

async function extract(embedUrl) {
  try {
    const headers = {
      Accept: "*/*",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${new URL(embedUrl).origin}/`,
      "User-Agent": UA,
    };

    /* Fetch embed page */
    const { data: html } = await axios.get(embedUrl, { headers });

    const nonce = extractNonce(html);
    if (!nonce) throw new Error("Nonce not found");

    /* Extract ID from URL (correct way) */
    const id = embedUrl.split("/").pop().split("?")[0];

    const apiUrl =
      `${MEGACLOUD_URL}/embed-2/v3/e-1/getSources` +
      `?id=${id}&_k=${nonce}`;

    const { data } = await axios.get(apiUrl, { headers });
    if (!data?.sources?.length) throw new Error("No sources");

    const tracks = (data.tracks || []).filter(t =>
      ["captions", "subtitles"].includes((t.kind || "").toLowerCase())
    );

    let file = data.sources[0].file;

    /* Direct HLS */
    if (!file.includes(".m3u8")) {
      const key = await fetchKey();
      file = await decrypt(file, nonce, key);
    }

    return {
      sources: [{ file, type: "hls" }],
      tracks,
      t: data.t ?? 0,
      server: data.server ?? 0,
      intro: data.intro ?? null,
      outro: data.outro ?? null,
    };
  } catch (err) {
    console.error("❌ MegaCloud failed:", err.message);
    return { sources: [], tracks: [] };
  }
}

/* ---------------- EXPORT ---------------- */

module.exports = {
  extract,
  handleEmbed: extract,
};
