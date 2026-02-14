const axios = require('axios');
const stringSimilarity = require('string-similarity');

const PROXY_PRO = process.env.PROXY_PRO || "";
const PROXY_PRO2 = process.env.PROXY_PRO2;

// Common headers for API requests
const getCommonHeaders = () => ({
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    'x-site': 'anicrush',
    'Referer': 'https://anicrush.to/',
    'Origin': 'https://anicrush.to',
    'sec-fetch-site': 'same-site',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty'
});

// Minimal GraphQL query for AniList
const ANILIST_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title {
      romaji
      english
      native
    }
    synonyms
    format
    seasonYear
  }
}`;

// Normalize title
function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase()
        .replace(/[^a-z0-9\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\uff00-\uff9f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// 🔥 UPDATED FUNCTION WITH PROPER LOGGING
async function getAniListDetails(anilistId) {
    const targetUrl = 'https://graphql.anilist.co';

    try {
        console.log("⚡ Trying DIRECT AniList request...");

        const response = await axios({
            url: targetUrl,
            method: 'POST',
            data: {
                query: ANILIST_QUERY,
                variables: { id: parseInt(anilistId) }
            },
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            }
        });

        if (!response.data?.data?.Media) {
            throw new Error('Anime not found Direct');
        }

        console.log("✅ DIRECT REQUEST SUCCESS");
        return response.data.data.Media;

    } catch (error) {
        console.error("❌ DIRECT REQUEST FAILED");
        console.error("Status:", error.response?.status || "No response");
        console.error("Reason:", error.response?.data || error.message);

        // 🔁 Fallback to Proxy
        try {
            const proxyBase = PROXY_PRO2 || PROXY_PRO;
            const sep = proxyBase.includes('?') ? '&' : '?';
            const proxyUrl = `${proxyBase}${sep}url=${encodeURIComponent(targetUrl)}`;

            console.log("🌐 Trying PROXY request...");
            console.log("Proxy URL:", proxyUrl);

            const response = await axios.post(proxyUrl, {
                query: ANILIST_QUERY,
                variables: { id: parseInt(anilistId) }
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0'
                },
                timeout: 10000
            });

            if (!response.data?.data?.Media) {
                throw new Error('Anime not found via Proxy');
            }

            console.log("✅ PROXY REQUEST SUCCESS");
            return response.data.data.Media;

        } catch (err2) {
            console.error("❌ PROXY REQUEST ALSO FAILED");
            console.error("Status:", err2.response?.status || "No response");
            console.error("Reason:", err2.response?.data || err2.message);

            throw new Error('Failed to fetch anime details from AniList');
        }
    }
}

// Search anime on anicrush
async function searchAnicrush(title) {
    const headers = getCommonHeaders();

    const response = await axios({
        method: 'GET',
        url: 'https://api.anicrush.to/shared/v2/movie/list',
        params: {
            keyword: title,
            page: 1,
            limit: 24
        },
        headers
    });

    return response.data;
}

// Similarity
function calculateTitleSimilarity(title1, title2) {
    if (!title1 || !title2) return 0;
    return stringSimilarity.compareTwoStrings(
        title1.toLowerCase(),
        title2.toLowerCase()
    ) * 100;
}

function extractSeasonNumber(title) {
    if (!title) return null;
    const lower = title.toLowerCase();

    let match = lower.match(/(?:season|cour|part)\s*(\d{1,2})/i);
    if (match && match[1]) return parseInt(match[1], 10);

    match = lower.match(/(\d{1,2})\s*$/);
    if (match && match[1] && parseInt(match[1], 10) < 10)
        return parseInt(match[1], 10);

    return null;
}

function findBestMatch(anilistData, anicrushResults) {
    if (!anicrushResults?.result?.movies?.length) return null;

    const anilistTitles = [
        anilistData.title.romaji,
        anilistData.title.english,
        anilistData.title.native,
        ...(anilistData.synonyms || [])
    ].filter(Boolean).map(normalizeTitle);

    let bestMatch = null;
    let highestScore = 0;

    for (const result of anicrushResults.result.movies) {
        for (const aTitle of anilistTitles) {
            const similarity = calculateTitleSimilarity(aTitle, result.name);
            if (similarity > highestScore) {
                highestScore = similarity;
                bestMatch = result;
            }
        }
    }

    return highestScore >= 60 ? bestMatch : null;
}

// Main mapper
async function mapAniListToAnicrush(anilistId) {
    const anilistData = await getAniListDetails(anilistId);

    const titlesToTry = [
        anilistData.title.romaji,
        anilistData.title.english,
        anilistData.title.native
    ].filter(Boolean);

    let bestMatch = null;

    for (const title of titlesToTry) {
        const searchResults = await searchAnicrush(title);
        bestMatch = findBestMatch(anilistData, searchResults);
        if (bestMatch) break;
    }

    if (!bestMatch)
        throw new Error('No matching anime found on anicrush');

    return {
        anilist_id: anilistId,
        anicrush_id: bestMatch.id,
        title: bestMatch.name,
        type: bestMatch.type,
        year: anilistData.seasonYear
    };
}

module.exports = {
    mapAniListToAnicrush,
    getCommonHeaders
};
