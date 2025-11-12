const axios = require('axios');

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

// Minimal GraphQL query for AniList (title, format, year only)
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

// Function to calculate string similarity using Levenshtein distance
function calculateLevenshteinSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    str1 = str1.toLowerCase();
    str2 = str2.toLowerCase();

    const matrix = Array(str2.length + 1).fill(null)
        .map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
        for (let i = 1; i <= str1.length; i++) {
            const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[j][i] = Math.min(
                matrix[j][i - 1] + 1,
                matrix[j - 1][i] + 1,
                matrix[j - 1][i - 1] + indicator
            );
        }
    }

    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 100;
    return ((maxLength - matrix[str2.length][str1.length]) / maxLength) * 100;
}

// Function to calculate word-based similarity
function calculateWordSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const words1 = str1.toLowerCase().split(/\s+/).filter(Boolean);
    const words2 = str2.toLowerCase().split(/\s+/).filter(Boolean);
    
    const commonWords = words1.filter(word => words2.includes(word));
    const totalUniqueWords = new Set([...words1, ...words2]).size;
    
    return (commonWords.length / totalUniqueWords) * 100;
}

// Function to normalize title for comparison
function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase()
        .replace(/[^a-z0-9\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\uff00-\uff9f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Function to get anime details from AniList
async function getAniListDetails(anilistId) {
    try {
        const response = await axios({
            url: 'https://graphql.anilist.co',
            method: 'POST',
            data: {
                query: ANILIST_QUERY,
                variables: {
                    id: parseInt(anilistId)
                }
            }
        });

        if (!response.data?.data?.Media) {
            throw new Error('Anime not found on AniList');
        }

        return response.data.data.Media;
    } catch (error) {
        console.error('Error fetching from AniList:', error.message);
        throw new Error('Failed to fetch anime details from AniList');
    }
}

// Function to search anime on anicrush
async function searchAnicrush(title) {
    if (!title) {
        throw new Error('Search title is required');
    }

    try {
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

        if (response.data?.status === false) {
            throw new Error(response.data.message || 'Search failed');
        }

        return response.data;
    } catch (error) {
        if (error.response) {
            console.error('Search API error:', error.response.data);
            throw new Error(error.response.data.message || 'Search request failed');
        } else if (error.request) {
            console.error('No response received:', error.request);
            throw new Error('No response from search API');
        } else {
            console.error('Search error:', error.message);
            throw new Error('Failed to search anime');
        }
    }
}

// Function to get episode list from anicrush
async function getEpisodeList(movieId) {
    if (!movieId) {
        throw new Error('Movie ID is required');
    }

    try {
        const headers = getCommonHeaders();
        const response = await axios({
            method: 'GET',
            url: 'https://api.anicrush.to/shared/v2/episode/list',
            params: {
                _movieId: movieId
            },
            headers
        });

        if (response.data?.status === false) {
            throw new Error(response.data.message || 'Failed to fetch episode list');
        }

        return response.data;
    } catch (error) {
        if (error.response) {
            console.error('Episode list API error:', error.response.data);
            throw new Error(error.response.data.message || 'Episode list request failed');
        } else if (error.request) {
            console.error('No response received:', error.request);
            throw new Error('No response from episode list API');
        } else {
            console.error('Episode list error:', error.message);
            throw new Error('Failed to fetch episode list');
        }
    }
}

// Function to calculate overall similarity between titles
function calculateTitleSimilarity(title1, title2) {
    const levenshteinSim = calculateLevenshteinSimilarity(title1, title2);
    const wordSim = calculateWordSimilarity(title1, title2);
    
    // Weight the similarities (favoring word-based matching for titles)
    return (levenshteinSim * 0.4) + (wordSim * 0.6);
}

// Function to find best match between AniList and anicrush results
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

    const formatTypeMap = {
        TV: 'TV',
        TV_SHORT: 'TV',
        MOVIE: 'MOVIE',
        SPECIAL: 'SPECIAL',
        OVA: 'OVA',
        ONA: 'ONA',
        MUSIC: 'MUSIC'
    };
    const expectedType = formatTypeMap[anilistData.format] || null;

    for (const result of anicrushResults.result.movies) {
        let typePenalty = 0;
        if (expectedType && result.type && expectedType !== result.type) {
            typePenalty = 15; // small penalty instead of skip
        }

        const resultTitles = [result.name, result.name_english].filter(Boolean).map(normalizeTitle);

        for (const aTitle of anilistTitles) {
            for (const rTitle of resultTitles) {
                const score = calculateTitleSimilarity(aTitle, rTitle);
                if (score > highestScore) {
                    highestScore = score;
                    bestMatch = result;
                }
            }
        }
    }

    return highestScore >= 25 ? bestMatch : null; // accept if 25%+ similarity
}

// Alias for compatibility
const findBestMatchFuzzy = findBestMatch;

// Function to parse episode list response
function parseEpisodeList(episodeList) {
    if (!episodeList?.result) return [];
    
    const episodes = [];
    for (const [key, value] of Object.entries(episodeList.result)) {
        if (Array.isArray(value)) {
            value.forEach(ep => {
                episodes.push({
                    number: ep.number,
                    name: ep.name,
                    name_english: ep.name_english,
                    is_filler: ep.is_filler
                });
            });
        }
    }
    return episodes.sort((a, b) => a.number - b.number);
}

// Function to fetch ani.zip mappings
async function getAniZipMappings(anilistId) {
    try {
        const response = await axios({
            method: 'GET',
            url: `https://api.ani.zip/mappings?anilist_id=${anilistId}`,
            headers: {
                'Accept': 'application/json'
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error fetching ani.zip mappings:', error.message);
        return null;
    }
}

// Main mapper function
async function mapAniListToAnicrush(anilistId) {
    try {
        const anilistData = await getAniListDetails(anilistId);

        const titlesToTry = [
            anilistData.title.romaji,
            anilistData.title.english,
            anilistData.title.native
        ].filter(Boolean);

        let bestMatch = null;
        for (const title of titlesToTry) {
            const searchResults = await searchAnicrush(title);
            bestMatch = findBestMatchFuzzy(anilistData, searchResults);
            if (bestMatch) break;
        }

        if (!bestMatch) throw new Error('No matching anime found on anicrush');

        return {
            anilist_id: anilistId,
            anicrush_id: bestMatch.id,
            title: {
                romaji: anilistData.title.romaji,
                english: anilistData.title.english,
                native: anilistData.title.native,
                anicrush: bestMatch.name,
                anicrush_english: bestMatch.name_english
            },
            type: bestMatch.type,
            year: anilistData.seasonYear
        };
    } catch (error) {
        console.error('Mapper error:', error.message);
        throw error;
    }
}
    
module.exports = {
    mapAniListToAnicrush,
    getCommonHeaders
}; 
