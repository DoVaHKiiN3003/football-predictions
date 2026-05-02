const API_KEY = '4687220268e3225c2b7585813360081a1f258dfa';
const BSD_BASE = 'https://sports.bzzoiro.com/api';
const CACHE_KEY = 'drawPredictionsCache';
const CACHE_DURATION = 3600000; // 1 hour
const AUTO_REFRESH = 10800000; // 3 hours

let isLoading = false;

// Fetch with auth header
async function fetchAPI(endpoint) {
    const response = await fetch(BSD_BASE + endpoint, {
        headers: { 'Authorization': 'Token ' + API_KEY }
    });
    if (!response.ok) throw new Error('API error: ' + response.status);
    return response.json();
}

// Cache management - store only essential fields
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

function setCache(matches) {
    // Store only essential fields to reduce size
    const minimal = matches.map(m => ({
        league: m.league,
        home_team: m.home_team,
        away_team: m.away_team,
        event_date: m.event_date,
        homePos: m.homePos,
        awayPos: m.awayPos,
        prob_draw: m.prob_draw,
        odds_draw: m.odds_draw
    }));
    
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
            timestamp: Date.now(),
            data: minimal
        }));
    } catch (e) {
        console.warn('Cache quota exceeded, clearing cache');
        localStorage.removeItem(CACHE_KEY);
    }
}

// Fetch all leagues
async function fetchLeagues() {
    const data = await fetchAPI('/leagues/');
    return data.results || [];
}

// Fetch standings for a league
async function fetchStandings(leagueId) {
    try {
        const data = await fetchAPI('/leagues/' + leagueId + '/standings/');
        return data.standings || [];
    } catch {
        return [];
    }
}

// Build standings map: { team_id: position }
async function buildStandingsMap() {
    const map = {};
    const leaguesWithStandings = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 15, 19, 20, 22, 23, 24, 25, 26, 28, 30, 32, 33, 34, 38, 42, 43, 44, 46, 47, 48, 49, 50, 51, 52];
    
    for (const leagueId of leaguesWithStandings) {
        const standings = await fetchStandings(leagueId);
        standings.forEach(s => {
            map[s.team_id] = s.position;
        });
        await new Promise(r => setTimeout(r, 100));
    }
    return map;
}

// Fetch upcoming events
async function fetchUpcomingEvents() {
    const data = await fetchAPI('/events/?status=notstarted&limit=500');
    return data.results || [];
}

// Fetch predictions
async function fetchPredictions() {
    try {
        const data = await fetchAPI('/predictions/');
        return data.results || [];
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
function renderMatches(matches) {
    const container = document.getElementById('matchesContainer');
    const countEl = document.getElementById('count');
    
    if (matches.length === 0) {
        container.innerHTML = '<div class="loading">No matches found (away team higher in standings)</div>';
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
        
        return '<div class="match-card">' +
            '<div class="league-info">' +
                '<span class="league-name">' + league + '</span>' +
                '<span class="match-date">' + formatDate(m.event_date) + '</span>' +
            '</div>' +
            '<div class="teams">' + m.home_team + ' vs ' + m.away_team + '</div>' +
            '<div class="stats">' +
                '<div class="stat">' +
                    '<div class="stat-label">Draw Probability</div>' +
                    '<div class="stat-value ' + (m.prob_draw == null ? 'no-data' : '') + '">' + drawProb + '</div>' +
                '</div>' +
                '<div class="stat">' +
                    '<div class="stat-label">Draw Odds</div>' +
                    '<div class="stat-value ' + (!m.odds_draw ? 'no-data' : '') + '">' + drawOdds + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="positions">Away (' + awayPos + getOrdinal(awayPos) + ') vs Home (' + homePos + getOrdinal(homePos) + ')</div>' +
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

// Main function to load and process data
async function loadData(forceRefresh = false) {
    if (isLoading) return;
    isLoading = true;
    
    const statusEl = document.getElementById('status');
    const refreshBtn = document.getElementById('refreshBtn');
    refreshBtn.disabled = true;
    
    try {
        statusEl.textContent = 'Loading data...';
        
        if (!forceRefresh) {
            const cached = getCache();
            if (cached) {
                statusEl.textContent = 'Loaded from cache';
                renderMatches(cached.data);
                document.getElementById('lastUpdate').textContent = 'Last updated: ' + new Date(cached.timestamp).toLocaleTimeString();
                isLoading = false;
                refreshBtn.disabled = false;
                return;
            }
        }
        
        statusEl.textContent = 'Fetching leagues...';
        const leagues = await fetchLeagues();
        
        statusEl.textContent = 'Building standings map...';
        const standingsMap = await buildStandingsMap();
        
        statusEl.textContent = 'Fetching upcoming matches...';
        const events = await fetchUpcomingEvents();
        
        statusEl.textContent = 'Fetching predictions...';
        const predictions = await fetchPredictions();
        const predMap = {};
        predictions.forEach(p => {
            predMap[p.event.id] = p;
        });
        
        statusEl.textContent = 'Filtering matches by standings...';
        const finalMatches = events.filter(event => {
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
        
        finalMatches.sort((a, b) => (b.prob_draw || 0) - (a.prob_draw || 0));
        
        statusEl.textContent = 'Found ' + finalMatches.length + ' matches';
        setCache(finalMatches);
        renderMatches(finalMatches);
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
    loadData(true);
}

// Auto refresh every 3 hours
setInterval(() => {
    loadData(false);
}, AUTO_REFRESH);

// Initial load
loadData(false);
