const API_KEY = '4687220268e3225c2b7585813360081a1f258dfa';
const BSD_BASE = 'https://sports.bzzoiro.com/api';
const CACHE_KEY = 'drawPredictionsCache';
const CACHE_DURATION = 3600000; // 1 hour
const AUTO_REFRESH = 10800000; // 3 hours;

let isLoading = false;
let currentTab = 'upcoming';

// Fetch with auth header
async function fetchAPI(endpoint) {
    const response = await fetch(BSD_BASE + endpoint, {
        headers: { 'Authorization': 'Token ' + API_KEY }
    });
    if (!response.ok) throw new Error('API error: ' + response.status);
    return response.json();
}

// Cache management - stores {timestamp, upcoming[], results[]}
function getCache() {
    const cachedData = localStorage.getItem(CACHE_KEY);
    if (!cachedData) return null;
    try {
        const data = JSON.parse(cachedData);
        if (Date.now() - data.timestamp > CACHE_DURATION) return null;
        return data;
    } catch {
        return null;
    }
}

function setCache(upcoming, results) {
    const existingCache = getCache();
    const cacheObj = {
        timestamp: Date.now(),
        upcoming: upcoming || (existingCache && existingCache.upcoming) || [],
        results: results || (existingCache && existingCache.results) || []
    };

    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cacheObj));
    } catch (e) {
        console.warn('Cache quota exceeded, clearing cache');
        localStorage.removeItem(CACHE_KEY);
    }
}

// All 48 BSD leagues
const ALL_LEAGUES = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,17,18,19,20,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,38,39,40,41,42,43,44,46,47,48,49,50,51,52];

// Build standings map: { team_id: position }
async function buildStandingsMap() {
    const map = {};
    for (const leagueId of ALL_LEAGUES) {
        try {
            const data = await fetchAPI('/leagues/' + leagueId + '/standings/');
            if (data.standings) {
                data.standings.forEach(s => {
                    map[s.team_id] = s.position;
                });
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 50));
    }
    return map;
}

// Fetch upcoming events
async function fetchUpcomingEvents() {
    const data = await fetchAPI('/events/?status=notstarted&limit=500');
    return Array.isArray(data.results) ? data.results : (Array.isArray(data) ? data : []);
}

// Fetch finished events (last 30 days)
async function fetchFinishedEvents() {
    const dateTo = new Date().toISOString().split('T')[0];
    const dateFrom = new Date(Date.now() - 30*86400000).toISOString().split('T')[0];
    const data = await fetchAPI('/events/?status=finished&date_from=' + dateFrom + '&date_to=' + dateTo + '&limit=500');
    return Array.isArray(data.results) ? data.results : (Array.isArray(data) ? data : []);
}

// Fetch predictions
async function fetchPredictions() {
    try {
        const data = await fetchAPI('/predictions/');
        return Array.isArray(data.results) ? data.results : (Array.isArray(data) ? data : []);
    } catch {
        return [];
    }
}

// Format date
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Render matches
function renderMatches(matches, isResultsTab) {
    const container = document.getElementById('matchesContainer');
    const countEl = document.getElementById('count');

    if (!Array.isArray(matches)) {
        matches = [];
    }

    if (matches.length === 0) {
        container.innerHTML = '<div class="loading">No matches found</div>';
        countEl.textContent = '';
        return;
    }

    countEl.textContent = matches.length + ' matches found';

    container.innerHTML = matches.map(m => {
        const league = m.league || 'Unknown';
        const homePos = m.homePos;
        const awayPos = m.awayPos;
        const drawProb = m.prob_draw != null ? m.prob_draw.toFixed(1) + '%' : 'N/A';
        const drawOdds = m.odds_draw ? m.odds_draw.toFixed(2) : 'N/A';
        const scoreDisplay = (m.home_score != null && m.away_score != null)
            ? m.home_score + '-' + m.away_score
            : '';

        return '<div class="match-card">' +
            '<div class="league-info">' +
                '<span class="league-name">' + league + '</span>' +
                '<span class="match-date">' + formatDate(m.event_date) + '</span>' +
            '</div>' +
            '<div class="teams">' + m.home_team + ' vs ' + m.away_team +
            (scoreDisplay ? ' <span class="score">(' + scoreDisplay + ')</span>' : '') +
            '</div>' +
            '<div class="stats">' +
                '<div class="stat">' +
                    '<div class="stat-label">' + (isResultsTab ? 'Result' : 'Draw Probability') + '</div>' +
                    '<div class="stat-value">' + (isResultsTab ? scoreDisplay : drawProb) + '</div>' +
                '</div>' +
                '<div class="stat">' +
                    '<div class="stat-label">Draw Odds</div>' +
                    '<div class="stat-value ' + (!m.odds_draw ? 'no-data' : '') + '">' + drawOdds + '</div>' +
                '</div>' +
            '</div>' +
            (awayPos && homePos ? '<div class="positions">Away (' + awayPos + getOrdinal(awayPos) + ') vs Home (' + homePos + getOrdinal(homePos) + ')</div>' : '') +
        '</div>';
    }).join('');
}

function getOrdinal(n) {
    if (n > 3 && n < 21) return 'th';
    switch (n % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

// Switch tabs
function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    if (tab === 'upcoming') {
        loadUpcoming();
    } else {
        loadResults();
    }
}

// Load upcoming matches (away team higher in standings)
async function loadUpcoming() {
    if (isLoading) return;
    isLoading = true;

    const statusEl = document.getElementById('status');
    const refreshBtn = document.getElementById('refreshBtn');
    refreshBtn.disabled = true;

    try {
        statusEl.textContent = 'Loading upcoming matches...';

        const cached = getCache();
        if (cached && cached.upcoming && Array.isArray(cached.upcoming)) {
            renderMatches(cached.upcoming, false);
            document.getElementById('lastUpdate').textContent = 'Last updated: ' + new Date(cached.timestamp).toLocaleTimeString();
            isLoading = false;
            refreshBtn.disabled = false;
            return;
        }

        statusEl.textContent = 'Building standings map...';
        const standingsMap = await buildStandingsMap();

        statusEl.textContent = 'Fetching upcoming matches...';
        const events = await fetchUpcomingEvents();

        statusEl.textContent = 'Fetching predictions...';
        const predictions = await fetchPredictions();
        const predMap = {};
        predictions.forEach(p => { predMap[p.event.id] = p; });

        statusEl.textContent = 'Filtering matches...';
        const matches = events.filter(event => {
            const homeId = event.home_team_obj?.id;
            const awayId = event.away_team_obj?.id;
            const homePos = standingsMap[homeId];
            const awayPos = standingsMap[awayId];
            if (!homePos || !awayPos) return false;
            return awayPos < homePos;
        }).map(event => {
            const pred = predMap[event.id] || {};
            return {
                league: event.league?.name || 'Unknown',
                home_team: event.home_team,
                away_team: event.away_team,
                event_date: event.event_date,
                homePos: standingsMap[event.home_team_obj.id],
                awayPos: standingsMap[event.away_team_obj.id],
                prob_draw: pred.prob_draw,
                odds_draw: event.odds_draw
            };
        });

        matches.sort((a, b) => (b.prob_draw || 0) - (a.prob_draw || 0));

        statusEl.textContent = 'Found ' + matches.length + ' matches';

        setCache(matches, null);

        renderMatches(matches, false);
        document.getElementById('lastUpdate').textContent = 'Last updated: ' + new Date().toLocaleTimeString();

    } catch (error) {
        statusEl.innerHTML = '<div class="error">Error: ' + error.message + '</div>';
        console.error(error);
    } finally {
        isLoading = false;
        refreshBtn.disabled = false;
    }
}

// Load finished matches that ended in draws
async function loadResults() {
    if (isLoading) return;
    isLoading = true;
    
    const statusEl = document.getElementById('status');
    const refreshBtn = document.getElementById('refreshBtn');
    refreshBtn.disabled = true;
    
    try {
        statusEl.textContent = 'Loading finished matches...';
        
        const cached = getCache();
        if (cached && cached.results && Array.isArray(cached.results) && cached.results.length > 0) {
            console.log('Using cached results:', cached.results.length, 'matches');
            renderMatches(cached.results, true);
            document.getElementById('lastUpdate').textContent = 'Last updated: ' + new Date(cached.timestamp).toLocaleTimeString();
            isLoading = false;
            refreshBtn.disabled = false;
            return;
        }
        
        statusEl.textContent = 'Fetching finished matches...';
        const events = await fetchFinishedEvents();
        
        if (!Array.isArray(events)) {
            throw new Error('Invalid events data from API');
        }
        
        statusEl.textContent = 'Filtering drawn matches...';
        const drawnMatches = events.filter(event => {
            if (!event || event.home_score === null || event.away_score === null) return false;
            return event.home_score === event.away_score;
        }).map(event => {
            return {
                league: event.league?.name || 'Unknown',
                home_team: event.home_team,
                away_team: event.away_team,
                event_date: event.event_date,
                home_score: event.home_score,
                away_score: event.away_score,
                odds_draw: event.odds_draw,
                homePos: null,
                awayPos: null
            };
        });
        
        if (!Array.isArray(drawnMatches)) {
            throw new Error('drawnMatches is not an array');
        }
        
        statusEl.textContent = 'Found ' + drawnMatches.length + ' drawn matches';
        
        // Save to cache
        setCache(null, drawnMatches);
        
        renderMatches(drawnMatches, true);
        document.getElementById('lastUpdate').textContent = 'Last updated: ' + new Date().toLocaleTimeString();
        
    } catch (error) {
        statusEl.innerHTML = '<div class="error">Error: ' + error.message + '</div>';
        console.error(error);
    } finally {
        isLoading = false;
        refreshBtn.disabled = false;
    }
}

        statusEl.textContent = 'Fetching finished matches...';
        const events = await fetchFinishedEvents();

        statusEl.textContent = 'Filtering drawn matches...';
        const drawnMatches = events.filter(event => {
            return event.home_score === event.away_score && event.home_score !== null;
        }).map(event => {
            return {
                league: event.league?.name || 'Unknown',
                home_team: event.home_team,
                away_team: event.away_team,
                event_date: event.event_date,
                home_score: event.home_score,
                away_score: event.away_score,
                odds_draw: event.odds_draw
            };
        });

        statusEl.textContent = 'Found ' + drawnMatches.length + ' drawn matches';

        setCache(null, drawnMatches);

        renderMatches(drawnMatches, true);
        document.getElementById('lastUpdate').textContent = 'Last updated: ' + new Date().toLocaleTimeString();

    } catch (error) {
        statusEl.innerHTML = '<div class="error">Error: ' + error.message + '</div>';
        console.error(error);
    } finally {
        isLoading = false;
        refreshBtn.disabled = false;
    }
}

// Manual refresh
function manualRefresh() {
    localStorage.removeItem(CACHE_KEY);
    if (currentTab === 'upcoming') {
        loadUpcoming();
    } else {
        loadResults();
    }
}

// Auto refresh every 3 hours
setInterval(() => {
    if (currentTab === 'upcoming') {
        loadUpcoming();
    }
}, AUTO_REFRESH);

// Initial load
loadUpcoming();
