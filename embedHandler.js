const axios = require("axios");
const cheerio = require("cheerio");

const MEGACLOUD_URL = "https://megacloud.blog";
const KEY_URL = "https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json";
const DECODE_URL = "https://script.google.com/macros/s/AKfycbx-yHTwupis_JD0lNzoOnxYcEYeXmJZrg7JeMxYnEZnLBy5V0--UxEvP-y9txHyy1TX9Q/exec";
const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

let cachedKey = null;

/** 🔹 Extract nonce from HTML */
function extractNonce(html) {
  const match48 = html.match(/\b[a-zA-Z0-9]{48}\b/);
  if (match48) return match48[0];

  const match3x16 = html.match(
    /\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b/
  );
  if (match3x16) return match3x16.slice(1, 4).join("");

  return null;
}

/** 🔹 Cache + fetch decryption key */
async function fetchKey() {
  if (cachedKey) return cachedKey;
  try {
    const { data } = await axios.get(KEY_URL, { headers: { "User-Agent": UA } });
    cachedKey = data?.mega;
    if (!cachedKey) throw new Error("Missing key in JSON");
    return cachedKey;
  } catch (err) {
    console.error("Failed to fetch key:", err.message);
    return null;
  }
}

/** 🔹 Call remote Google Script to decrypt */
async function decryptWithGoogleScript(encryptedData, nonce, key) {
  const fullUrl = `${DECODE_URL}?encrypted_data=${encodeURIComponent(
    typeof encryptedData === "string" ? encryptedData : JSON.stringify(encryptedData)
  )}&nonce=${encodeURIComponent(nonce)}&secret=${encodeURIComponent(key)}`;

  const { data } = await axios.get(fullUrl);
  const match = data.match(/"file":"(.*?)"/);
  if (!match) throw new Error("Decrypted file not found");
  return match[1].replace(/\\\//g, "/");
}

/** 🔹 Main extractor */
async function extract(embedUrl) {
  try {
    const headers = {
      Accept: "*/*",
      "X-Requested-With": "XMLHttpRequest",
      // Use domain as referer for proper CORS
      Referer: `${new URL(embedUrl).origin}/`,
      "User-Agent": UA,
    };

    // Fetch embed HTML
    const { data: html } = await axios.get(embedUrl, { headers });
    const $ = cheerio.load(html);

    // Extract file ID
    const fileId = $("#megacloud-player").attr("data-id");
    if (!fileId) throw new Error("data-id not found");

    // Extract nonce
    const nonce = extractNonce(html);
    if (!nonce) throw new Error("Nonce not found");

    // Build API URL dynamically
    const urlParts = new URL(embedUrl).pathname.split("/").filter(Boolean);
    // Always use v3 endpoint as it returns correct JSON even when embed URL contains v2
    const apiUrl = `${MEGACLOUD_URL}/embed-2/v3/e-1/getSources?id=${fileId}&_k=${nonce}`;

    // Fetch JSON
    const { data: response } = await axios.get(apiUrl, { headers });
    if (!response || !response.sources)
      throw new Error("No sources in API response");

    let sources = response.sources;
    const tracks = response.tracks || [];
    let m3u8Url;

    // 🔸 If sources is array and contains HLS directly
    if (Array.isArray(sources) && sources.length && sources[0].file) {
      m3u8Url = sources[0].file;
    }
    // 🔸 Encrypted string or empty array
    else {
      const key = await fetchKey();
      if (!key) throw new Error("No key available");

      m3u8Url = await decryptWithGoogleScript(sources, nonce, key);
    }

    return {
      sources: [{ file: m3u8Url, type: "hls" }],
      tracks: tracks.filter((t) =>
        ["captions", "subtitles"].includes((t.kind || "").toLowerCase())
      ),
      t: response.t || 0,
      server: response.server || 0,
      intro: response.intro || null,
      outro: response.outro || null,
    };
  } catch (err) {
    console.error("❌ MegaCloud extraction failed:", err.message);
    return {
      sources: [],
      tracks: [],
      t: 0,
      server: 0,
    };
  }
}

/** 🔹 Wrapper */
async function handleEmbed(embedUrl) {
  return await extract(embedUrl);
}

module.exports = { extract, handleEmbed };
