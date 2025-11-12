const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { mapAniListToAnicrush, getCommonHeaders } = require('./mapper');
const { getHlsLink } = require('./hls');
require('dotenv').config();

const app = express();

// Remove explicit port for Vercel
const PORT = process.env.PORT || 3000;

// CORS configuration for Vercel
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Endpoint to map AniList ID to anicrush
app.get('/api/mapper/:anilistId', async (req, res) => {
    try {
        const { anilistId } = req.params;
        
        if (!anilistId) {
            return res.status(400).json({ error: 'AniList ID is required' });
        }

        const mappedData = await mapAniListToAnicrush(anilistId);
        res.json(mappedData);
    } catch (error) {
        console.error('Error in mapper:', error);
        res.status(500).json({
            error: 'Failed to map AniList ID',
            message: error.message
        });
    }
});

// Endpoint to search for anime
app.get('/api/anime/search', async (req, res) => {
    try {
        const { keyword, page = 1, limit = 24 } = req.query;

        if (!keyword) {
            return res.status(400).json({ error: 'Search keyword is required' });
        }

        const headers = getCommonHeaders();

        const response = await axios({
            method: 'GET',
            url: `https://api.anicrush.to/shared/v2/movie/list`,
            params: {
                keyword,
                page,
                limit
            },
            headers
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error searching anime:', error);
        res.status(500).json({
            error: 'Failed to search anime',
            message: error.message
        });
    }
});

// Endpoint to fetch episode list
app.get('/api/anime/episodes', async (req, res) => {
    try {
        const { movieId } = req.query;

        if (!movieId) {
            return res.status(400).json({ error: 'Movie ID is required' });
        }

        const headers = getCommonHeaders();

        const response = await axios({
            method: 'GET',
            url: `https://api.anicrush.to/shared/v2/episode/list`,
            params: {
                _movieId: movieId
            },
            headers
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching episode list:', error);
        res.status(500).json({
            error: 'Failed to fetch episode list',
            message: error.message
        });
    }
});

// Endpoint to fetch servers for an episode
app.get('/api/anime/servers/:movieId', async (req, res) => {
    try {
        const { movieId } = req.params;
        const { episode } = req.query;

        if (!movieId) {
            return res.status(400).json({ error: 'Movie ID is required' });
        }

        const headers = getCommonHeaders();

        const response = await axios({
            method: 'GET',
            url: `https://api.anicrush.to/shared/v2/episode/servers`,
            params: {
                _movieId: movieId,
                ep: episode || 1
            },
            headers
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching servers:', error);
        res.status(500).json({
            error: 'Failed to fetch servers',
            message: error.message
        });
    }
});

// Main endpoint to fetch anime sources
app.get('/api/anime/sources', async (req, res) => {
    try {
        const { movieId, episode, server, subOrDub } = req.query;

        if (!movieId) {
            return res.status(400).json({ error: 'Movie ID is required' });
        }

        const headers = getCommonHeaders();

        // First, check if the episode list exists
        const episodeListResponse = await axios({
            method: 'GET',
            url: `https://api.anicrush.to/shared/v2/episode/list`,
            params: {
                _movieId: movieId
            },
            headers
        });

        if (!episodeListResponse.data || episodeListResponse.data.status === false) {
            return res.status(404).json({ error: 'Episode list not found' });
        }

        // Then, get the servers for the episode
        const serversResponse = await axios({
            method: 'GET',
            url: `https://api.anicrush.to/shared/v2/episode/servers`,
            params: {
                _movieId: movieId,
                ep: episode || 1
            },
            headers
        });

        if (!serversResponse.data || serversResponse.data.status === false) {
            return res.status(404).json({ error: 'Servers not found' });
        }

        // Finally, get the sources
        const sourcesResponse = await axios({
            method: 'GET',
            url: `https://api.anicrush.to/shared/v2/episode/sources`,
            params: {
                _movieId: movieId,
                ep: episode || 1,
                sv: server || 4,
                sc: subOrDub || 'sub'
            },
            headers
        });

        res.json(sourcesResponse.data);
    } catch (error) {
        console.error('Error fetching anime sources:', error);
        res.status(500).json({
            error: 'Failed to fetch anime sources',
            message: error.message
        });
    }
});

// Endpoint to get HLS link
app.get('/api/anime/hls/:movieId', async (req, res) => {
    try {
        const { movieId } = req.params;
        const { episode = 1, server = 4, subOrDub = 'sub' } = req.query;

        if (!movieId) {
            return res.status(400).json({ error: 'Movie ID is required' });
        }

        const headers = getCommonHeaders();

        // First get the embed link
        const embedResponse = await axios({
            method: 'GET',
            url: `https://api.anicrush.to/shared/v2/episode/sources`,
            params: {
                _movieId: movieId,
                ep: episode,
                sv: server,
                sc: subOrDub
            },
            headers
        });

        if (!embedResponse.data || embedResponse.data.status === false) {
            return res.status(404).json({ error: 'Embed link not found' });
        }

        const embedUrl = embedResponse.data.result.link;
        
        // Get HLS link from embed URL
        const hlsData = await getHlsLink(embedUrl);
        res.json(hlsData);

    } catch (error) {
        console.error('Error fetching HLS link:', error);
        res.status(500).json({
            error: 'Failed to fetch HLS link',
            message: error.message
        });
    }
});

// Combined endpoint to get HLS link directly from AniList ID
app.get('/api/anime/:anilistId/:episodeNum', async (req, res) => {
    try {
        const { anilistId, episodeNum } = req.params;
        const { server = 4, subOrDub = 'sub' } = req.query;

        if (!anilistId) {
            return res.status(400).json({ error: 'AniList ID is required' });
        }

        // First map AniList ID to Anicrush ID
        const mappedData = await mapAniListToAnicrush(anilistId);
        
        if (!mappedData || !mappedData.anicrush_id) {
            return res.status(404).json({ error: 'Anime not found on Anicrush' });
        }
        
        const movieId = mappedData.anicrush_id;
        const headers = getCommonHeaders();

        // Get the embed link
        const embedResponse = await axios({
            method: 'GET',
            url: `https://api.anicrush.to/shared/v2/episode/sources`,
            params: {
                _movieId: movieId,
                ep: episodeNum || 1,
                sv: server,
                sc: subOrDub
            },
            headers
        });

        if (!embedResponse.data || embedResponse.data.status === false) {
            return res.status(404).json({ error: 'Embed link not found' });
        }

        const embedUrl = embedResponse.data.result.link;
        
        // Get HLS link from embed URL
        const hlsData = await getHlsLink(embedUrl);
        
        // Find the specific episode data
        const episodeNumber = parseInt(episodeNum) || 1;
        const episodeData = (mappedData.episodes || []).find(ep => ep.number === episodeNumber) || {};
        
        // Add metadata from the mapped data
        const response = {
            ...hlsData,
            metadata: {
                title: mappedData.title?.english || mappedData.title?.romaji,
                anilistId: parseInt(anilistId),
                movieId: movieId,
                episode: episodeNumber,
                server: parseInt(server) || 4,
                subOrDub: subOrDub || 'sub',
                image: episodeData.image || null
            }
        };
        
        res.json(response);

    } catch (error) {
        console.error('Error fetching anime stream:', error);
        res.status(500).json({
            error: 'Failed to fetch anime stream',
            message: error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK' });
});

// Only start the server if not in Vercel environment
if (process.env.VERCEL !== '1') {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

// Export the Express app for Vercel
module.exports = app; 
