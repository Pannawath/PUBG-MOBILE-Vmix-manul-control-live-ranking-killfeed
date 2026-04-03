require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

// ===========================
// Config & State Persistence
// ===========================
const CONFIG_FILE = path.join(__dirname, 'config.json');
const STATE_FILE = path.join(__dirname, 'state.json');

function loadConfig() {
  let fileConfig = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) { console.error('❌ [CONFIG] Failed to load config:', e.message); }
  
  // process.env takes precedence over config.json
  return {
    numMatches: fileConfig.numMatches !== undefined ? fileConfig.numMatches : 3,
    numTeams: fileConfig.numTeams !== undefined ? fileConfig.numTeams : 16,
    maps: fileConfig.maps || ['Erangel', 'Miramar', 'Sanhok', 'Rondo'],
    mapBasePath1: process.env.MAP_BASE_PATH_1 || fileConfig.mapBasePath1 || '',
    mapBasePath2: process.env.MAP_BASE_PATH_2 || fileConfig.mapBasePath2 || '',
    logoBasePath: process.env.LOGO_BASE_PATH || fileConfig.logoBasePath || '',
    vmixHost: process.env.VMIX_HOST || fileConfig.vmixHost || '',
    placementPoints: fileConfig.placementPoints || { '1': 10, '2': 6, '3': 5, '4': 4, '5': 3, '6': 2, '7': 1, '8': 1 }
  };
}

function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); }
  catch (e) { console.error('❌ [CONFIG] Failed to save config:', e.message); }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      console.log('💾 [STATE] Loaded saved state from disk');
      return saved;
    }
  } catch (e) { console.error('❌ [STATE] Failed to load state:', e.message); }
  return null;
}

function saveState() {
  try {
    const stateToSave = { matchesData, vmixState, activeMatchId, matchTop4Ids };
    fs.writeFileSync(STATE_FILE, JSON.stringify(stateToSave));
  } catch (e) { console.error('❌ [STATE] Failed to save state:', e.message); }
}

let config = loadConfig();

// Helper: get placement points from config
function getPlacementPoints(rank) {
  const pts = config.placementPoints;
  const key = String(rank);
  if (pts[key] !== undefined) return pts[key];
  // Find highest rank that is <= this rank
  const ranks = Object.keys(pts).map(Number).sort((a, b) => a - b);
  for (let i = ranks.length - 1; i >= 0; i--) {
    if (ranks[i] <= rank) return pts[String(ranks[i])];
  }
  return 0;
}

const app = express();
app.use(cors());
app.use(express.json()); // Support JSON body

// Serve static files from React Frontend (Build)
app.use(express.static(path.join(__dirname, '../client/dist')));

// File Upload Configuration
const upload = multer({ storage: multer.memoryStorage() });

// Helper to format Excel Date/Serial
function formatExcelVal(val) {
  if (!val) return '';
  // Check if it's a number that looks like a date serial (e.g., 40000+)
  // Excel date 45000 is around year 2023.
  // But user input might be "5/6" which Excel treats as May 6th.
  // Excel serial dates for 2024 are ~45300.
  // "6/4" (June 4th) is roughly 45447 (in 2024) or similar.
  // "5/67" is likely a string.

  // If it's a pure number and seems large, it might be a date.
  // However, "6/4" in text csv is just "6/4". 
  // In XLSX, "6/4" might be converted to date number automatically.

  if (typeof val === 'number' && val > 30000) {
    // Convert Excel serial date to JS Date
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    // Return as M/D format (Month/Day) because users often use D/M input which excel flips, or we just standardizing to M/D?
    // User Input "6/4" (June 4th or April 6th?). Usually Thai is D/M.
    // If Excel parses "6/4" as June 4th (M/D in US), we probably want to preserve the input.
    // But if user meant Class 6 Room 4, and we show "6/4", that matches M/D style.
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  return String(val).trim();
}

// ===========================
// Config & System API
// ===========================
app.get('/api/config', (req, res) => {
  res.json(config);
});

app.post('/api/config', (req, res) => {
  try {
    config = { ...config, ...req.body };
    saveConfig(config);

    // Extend matchesData if numMatches increased
    for (let m = 1; m <= config.numMatches; m++) {
      if (!matchesData[m]) {
        matchesData[m] = JSON.parse(JSON.stringify(makeInitialTeams(config.numTeams)));
      }
      if (!matchTop4Ids[m]) matchTop4Ids[m] = [];
      if (!vmixState.matches[m]) {
        vmixState.matches[m] = { map: config.maps[m - 1] || config.maps[0] || 'Erangel', winner: null };
      }
    }

    saveState();
    io.emit('config_update', config);
    io.emit('vmix_update', vmixState);
    res.json({ success: true, config });
    console.log('\u2699\ufe0f [CONFIG] Updated:', JSON.stringify(config));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reset-state', (req, res) => {
  try {
    matchesData = makeInitialMatchesData(config.numMatches, config.numTeams);
    activeMatchId = 1;
    teams = matchesData[activeMatchId];
    matchTop4Ids = {};
    for (let m = 1; m <= config.numMatches; m++) matchTop4Ids[m] = [];
    top4Ids = [];
    killfeed = [];
    pendingKillfeed = [];
    vmixState = makeInitialVmixState(config.numMatches, config.maps);
    saveState();
    io.emit('init_state', { teams, killfeed, pendingKillfeed, overlayState, activeMatchId, top4Ids, chatHistory });
    io.emit('vmix_update', vmixState);
    res.json({ success: true });
    console.log('\ud83d\udd04 [STATE] Full state reset');
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helper to grab images and save them directly, with redirect following
function downloadImage(url, dest, redirectCount = 0) {
  if (!url || !url.startsWith('http')) return;
  
  if (redirectCount > 5) {
      console.error(`❌ [IMPORT] Too many redirects for: ${url}`);
      return;
  }

  const file = fs.createWriteStream(dest);
  const req = (url.startsWith('https') ? https : http).get(url, (response) => {
    // Follow redirect
    if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303 || response.statusCode === 307 || response.statusCode === 308) {
        file.close();
        fs.unlink(dest, () => {}); // remove empty file
        if (response.headers.location) {
            console.log(`🔀 [IMPORT] Redirecting to: ${response.headers.location}`);
            return downloadImage(response.headers.location, dest, redirectCount + 1);
        }
    }

    if (response.statusCode !== 200) {
      console.error(`❌ [IMPORT] Failed downloading logo: ${url} (Status: ${response.statusCode})`);
      file.close();
      return;
    }
    
    response.pipe(file);
    file.on('finish', () => {
      file.close();
      console.log(`📥 [IMPORT] Downloaded logo to ${dest}`);
    });
  }).on('error', (err) => {
    console.error(`❌ [IMPORT] Error downloading logo: ${url}`, err.message);
    fs.unlink(dest, () => {});
    file.close();
  });
  
  // Set a timeout to prevent hanging
  const timeoutId = req.setTimeout(15000, () => {
    req.destroy();
    file.close();
    fs.unlink(dest, () => {});
    console.error(`❌ [IMPORT] Timeout downloading logo: ${url}`);
  });

  req.on('response', () => {
      // Clear timeout once we start getting a response, or handle it better
      // Actually, timeout applies to socket inactivity, but let's just make sure it doesn't trigger erroneously.
      req.setTimeout(0); // Disable timeout once connected
  });
}

app.post('/api/import-teams', upload.single('file'), (req, res) => {

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer', codepage: 65001 });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Read as Array of Arrays (header: 1)
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    console.log('📂 [IMPORT] Total Rows:', rows.length);
    if (rows.length < 2) {
      return res.status(400).json({ success: false, message: 'Empty file or no data' });
    }

    // Header Row
    const headers = rows[0].map(h => String(h || '').trim());

    // Indices
    const nameIdx = headers.findIndex(h => h.includes('ชื่อทีม'));
    const tagIdx = headers.findIndex(h => h.includes('ชื่อย่อทีม'));
    const flagIdx = headers.findIndex(h => h.includes('ธงทีม'));
    const leaderIdx = headers.findIndex(h => h.includes('หัวหน้าทีม') && h.includes('ชื่อ'));
    const classIdx = headers.findIndex(h => h.includes('ระดับชั้น'));
    const discordIdx = headers.findIndex(h => h.includes('Discord'));
    const phoneIdx = headers.findIndex(h => h.includes('เบอร์ติดต่อ'));
    const proofIdx = headers.findIndex(h => h.includes('ยืนยันว่าเป็นนักเรียน'));

    const ignIndices = [];
    const realNameIndices = [];
    const classIndices = [];
    const uidIndices = [];

    headers.forEach((h, i) => {
      if (h.includes('ชื่อในเกม (IGN)')) ignIndices.push(i);
      if (h.includes('ชื่อ–นามสกุล') && !h.includes('หัวหน้าทีม')) realNameIndices.push(i);
      if (h.includes('ชั้น') && h.includes('ห้อง') && !h.includes('ระดับ')) classIndices.push(i);
      if (h.includes('Player ID (UID)')) uidIndices.push(i);
    });

    console.log('🔑 [DEBUG] Indices Found:', {
      nameIdx, tagIdx,
      ign: ignIndices,
      realName: realNameIndices,
      class: classIndices,
      uid: uidIndices
    });

    // LOG TO FILE
    const logPath = path.join(__dirname, 'import_debug.log');
    const logData = `
    ================ IMPORT ${new Date().toISOString()} ================
    Indices:
    IGN: ${JSON.stringify(ignIndices)}
    RealName: ${JSON.stringify(realNameIndices)}
    Class: ${JSON.stringify(classIndices)}
    UID: ${JSON.stringify(uidIndices)}
    
    Processing Rows...
    `;
    fs.writeFileSync(logPath, logData);

    const newTeams = [];

    let teamIdCounter = 1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const teamName = row[nameIdx] || '';
      const teamTag = row[tagIdx] || '';
      const teamFlag = row[flagIdx] || '';

      // Fix: Filter out empty teams more aggressively
      if (!teamName && !teamTag) continue;

      // Trigger Logo Download in background
      if (teamFlag && teamFlag.startsWith('http') && teamTag) {
        // Use teamTag (English abbreviation) instead of teamName for the filename
        const safeName = teamTag.replace(/[<>:"/\\|?*]+/g, '_').trim();
        
        let finalUrl = teamFlag;
        let ext = '.png'; // Default
        
        // Auto-convert Google Drive links to direct download links
        const gDriveMatch = teamFlag.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([^/&]+)/);
        if (gDriveMatch) {
            const fileId = gDriveMatch[1];
            finalUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
            // Drive links don't have explicit extensions in the URL predictably, assume PNG
        } else {
            // Determine extension for non-Drive links
            try {
              const urlObj = new URL(teamFlag);
              const pathname = urlObj.pathname;
              const match = pathname.match(/\.(png|jpe?g|svg|webp|gif)$/i);
              if (match) ext = match[0];
            } catch(e) {}
        }
        
        const logoPath = path.join(config.logoBasePath, `${safeName}${ext}`);
        downloadImage(finalUrl, logoPath);
      }

      // Log first valid team row
      if (teamIdCounter === 1) {
        const rowDebug = `
             ROW ${i} DATA (First Team):
             Team: ${teamName}
             Length: ${row.length}
             
             Player 1 IGN (Idx ${ignIndices[0]}): ${row[ignIndices[0]]}
             Player 2 IGN (Idx ${ignIndices[1]}): ${row[ignIndices[1]]}
             Player 3 IGN (Idx ${ignIndices[2]}): ${row[ignIndices[2]]}
             Player 4 IGN (Idx ${ignIndices[3]}): ${row[ignIndices[3]]}

             Player 1 Name (Idx ${realNameIndices[0]}): ${row[realNameIndices[0]]}
             Player 4 Name (Idx ${realNameIndices[3]}): ${row[realNameIndices[3]]}
             
             Player 4 Name Index was: ${realNameIndices[3]}
             ROW dump: ${JSON.stringify(row)}
             `;
        fs.appendFileSync(logPath, rowDebug);
      }

      const extraInfo = {
        leaderName: row[leaderIdx] || '',
        classRoom: row[classIdx] || '',
        discord: row[discordIdx] || '',
        phone: row[phoneIdx] || '',
        proof: row[proofIdx] || ''
      };

      const teamId = teamIdCounter++;
      const players = [];
      const maxPlayers = 5; // Support up to 5 players (Reserve)

      // Detailed logging for first team to debug
      if (i === 1) {
        console.log(`🔎 [DEBUG] Processing Team 1 (${teamName}):`);
        console.log(`   IGNs raw:`, ignIndices.map(idx => row[idx]));
        console.log(`   Names raw:`, realNameIndices.map(idx => row[idx]));
      }

      for (let p = 0; p < maxPlayers; p++) {
        let ign = '';
        if (p < ignIndices.length) ign = row[ignIndices[p]];
        ign = String(ign || '').trim();

        let realName = '';
        if (p < realNameIndices.length) realName = row[realNameIndices[p]];

        let classRoom = '';
        if (p < classIndices.length) classRoom = formatExcelVal(row[classIndices[p]]);

        let uid = '';
        if (p < uidIndices.length) uid = row[uidIndices[p]];

        // Fallback or Clean
        if (ign === 'undefined') ign = '';

        // Should we skip if empty? 
        // User wants to pull even if empty.
        // But for display cleanliness, maybe we mark status?

        const isReserve = p === 4; // 5th player (index 4)

        players.push({
          name: ign || (isReserve ? 'Reserve' : `Player ${p + 1}`),
          realName: String(realName || '').trim(),
          classRoom: classRoom,
          uid: String(uid || '').trim(),
          status: isReserve ? 'reserve' : 'alive' // Default first 4 to alive, 5th to reserve
        });
      }

      newTeams.push({
        id: teamId,
        tag: teamTag || `TM${teamId}`,
        name: teamName || `Team ${teamId}`,
        flag: teamFlag,
        extra: extraInfo,
        players: players,
        placement: 0,
        elims: 0,
        wwcd: 0,
        aliveCount: 4
      });
    }

    // Update Global Teams
    teams = newTeams;

    // Persist to ALL matches (M1, M2, M3)
    for (let m = 1; m <= 3; m++) {
      matchesData[m] = JSON.parse(JSON.stringify(newTeams));
    }
    console.log('📋 [IMPORT] Team data copied to ALL 3 matches (M1, M2, M3)');

    // Reset/Recalculate
    recalculateWWCD();
    checkTop4Trigger();

    // Broadcast
    io.emit('state_update', { type: 'teams', data: teams });

    res.json({ success: true, count: newTeams.length, teams: newTeams });

  } catch (err) {
    console.error('❌ [IMPORT] Error:', err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins (ngrok, localhost, etc.)
    methods: ["GET", "POST"]
  }
});

// Initial States — driven by config
function makeInitialTeams(num) {
  return Array.from({ length: num }, (_, i) => ({
    id: i + 1,
    tag: `TM${i + 1}`,
    name: `Team ${i + 1}`,
    players: Array(4).fill(null).map((_, pIdx) => ({ name: `Player ${pIdx + 1}`, status: 'alive' })),
    placement: 0,
    elims: 0,
    wwcd: 0,
    aliveCount: 4
  }));
}

function makeInitialMatchesData(numMatches, numTeams) {
  const data = {};
  const teams = makeInitialTeams(numTeams);
  for (let m = 1; m <= numMatches; m++) {
    data[m] = JSON.parse(JSON.stringify(teams));
  }
  return data;
}

// Load persisted state or init fresh
const savedState = loadState();
let matchesData = savedState?.matchesData || makeInitialMatchesData(config.numMatches, config.numTeams);

// --- vMix Data & State ---
function makeInitialVmixState(numMatches, maps) {
  const matches = {};
  for (let m = 1; m <= numMatches; m++) {
    matches[m] = { map: maps[m - 1] || maps[0] || 'Erangel', winner: null };
  }
  return { day: '1', week: '1', activeMap: maps[0] || 'Erangel', matches, timer: { minutes: 10, seconds: 0, isRunning: false, endTime: 0 } };
}

let vmixState = savedState?.vmixState || makeInitialVmixState(config.numMatches, config.maps);

let timerInterval = null;

// Ensure vmix output directory exists
const VMIX_DIR = path.join(__dirname, 'vmix');
if (!fs.existsSync(VMIX_DIR)) {
  fs.mkdirSync(VMIX_DIR, { recursive: true });
}

// Helper to write text files for vMix
function writeVMixFile(filename, content) {
  try {
    fs.writeFileSync(path.join(VMIX_DIR, filename), String(content));
    console.log(`💾 [VMIX] Saved ${filename}: ${content}`);
  } catch (err) {
    console.error(`❌ [VMIX] Error writing ${filename}:`, err);
  }
}

// Initial File Write
writeVMixFile('day.txt', `D${vmixState.day}`);
writeVMixFile('week.txt', `W${vmixState.week}`);
writeVMixFile('COMINGday.txt', vmixState.day);
writeVMixFile('COMINGweek.txt', vmixState.week);
writeVMixFile('timer.txt', '00:00');
Object.keys(vmixState.matches).forEach(m => {
  writeVMixFile(`map_${m}.txt`, vmixState.matches[m].map);

  if (vmixState.matches[m].map) {
    const mapFileName = `${vmixState.matches[m].map.toUpperCase()}.png`;
    const path1 = `${config.mapBasePath1}${mapFileName}`;
    const path2 = `${config.mapBasePath2}${mapFileName}`;
    writeVMixFile(`map_img_${m}.csv`, `${path1}\r\n${path2}`);
  }

  writeVMixFile(`winner_${m}.txt`, '');
  writeVMixFile(`winner_team_${m}.txt`, '');
});

function startServerTimer() {
  if (timerInterval) clearInterval(timerInterval);

  // Calculate end time based on current duration setting
  const totalSeconds = (vmixState.timer.minutes * 60) + vmixState.timer.seconds;
  vmixState.timer.endTime = Date.now() + (totalSeconds * 1000);
  vmixState.timer.isRunning = true;

  io.emit('vmix_update', vmixState);

  timerInterval = setInterval(() => {
    const now = Date.now();
    const diff = vmixState.timer.endTime - now;

    if (diff <= 0) {
      clearInterval(timerInterval);
      vmixState.timer.isRunning = false;
      vmixState.timer.minutes = 0;
      vmixState.timer.seconds = 0;
      writeVMixFile('timer.txt', '00:00');
      io.emit('vmix_update', vmixState);
    } else {
      // Update file every second? Maybe too frequent for disk, but okay for single file.
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      writeVMixFile('timer.txt', timeStr);

      // We don't necessarily need to emit every second if client calculates locally based on endTime,
      // but emitting helps sync exactly.
      io.emit('timer_tick', { m, s, timeStr });
    }
  }, 1000);
}

function stopServerTimer() {
  if (timerInterval) clearInterval(timerInterval);
  vmixState.timer.isRunning = false;
  io.emit('vmix_update', vmixState);
}

let activeMatchId = savedState?.activeMatchId || 1;
let teams = matchesData[activeMatchId];
let matchTop4Ids = savedState?.matchTop4Ids || (() => { const t = {}; for (let m = 1; m <= config.numMatches; m++) t[m] = []; return t; })();
let top4Ids = matchTop4Ids[activeMatchId] || [];

let killfeed = [];
let pendingKillfeed = [];
let chatHistory = []; // Team Chat History
let overlayState = {
  ranking: true,
  killfeed: true,
  top4: true
};

// Helper to auto-calculate WWCD % based on game state
function recalculateWWCD() {
  let totalScore = 0;
  const teamScores = teams.map(team => {
    const alive = team.players.filter(p => p.status === 'alive').length;
    const knocked = team.players.filter(p => p.status === 'knocked').length;
    // Weight: Alive = 10pts, Knocked = 2pts, Elims = 1pt
    let score = (alive * 10) + (knocked * 2) + (team.elims * 1);

    // Dead teams have 0 chance
    if (alive === 0 && knocked === 0) score = 0;

    totalScore += score;
    return { id: team.id, score };
  });

  if (totalScore > 0) {
    teams.forEach(t => {
      const ts = teamScores.find(s => s.id === t.id);
      t.wwcd = ts ? ((ts.score / totalScore) * 100).toFixed(1) : 0;
    });
  } else {
    teams.forEach(t => t.wwcd = 0);
  }
}

function checkTop4Trigger() {
  const activeTeams = teams.filter(t => t.players.some(p => p.status !== 'dead'));

  // Trigger when 4 or fewer teams are alive, AND we haven't locked yet
  if (activeTeams.length <= 4 && top4Ids.length === 0) {
    console.log('🔒 [AUTO-LOCK] Top 4 Teams Determined!');

    // Detect the 4 teams to lock
    // If exactly 4 alive: Lock them.
    // If < 4 alive (skipped): Lock alive + highest ranking dead teams to fill 4 slots.

    let potentialTop4 = [...activeTeams];
    if (potentialTop4.length < 4) {
      const deadTeams = teams.filter(t => !activeTeams.includes(t));
      // Sort dead by placement points (highest first) or rank? 
      // Placement points: Rank 4 = 4pts, Rank 5 = 3pts. So higher points = better rank.
      deadTeams.sort((a, b) => (b.placement || 0) - (a.placement || 0));
      const needed = 4 - potentialTop4.length;
      potentialTop4 = [...potentialTop4, ...deadTeams.slice(0, needed)];
    }

    top4Ids = potentialTop4.map(t => t.id);

    // Persist to match storage
    matchTop4Ids[activeMatchId] = top4Ids;

    // Auto Open Overlay
    overlayState.top4 = true;
    overlayState.ranking = false; // Mutually exclusive usually

    console.log('🔓 [AUTO-OPEN] Top 4 Locked IDs:', top4Ids);
    io.emit('overlay_state_update', overlayState);
    io.emit('state_update', { type: 'top4Ids', data: top4Ids });
  }
  else if (activeTeams.length > 4 && top4Ids.length > 0) {
    // AUTO-UNLOCK: If admin revived someone and we have > 4 teams again, unlock!
    console.log('🔓 [AUTO-UNLOCK] Active Teams > 4 -> Resetting Top 4 Lock');

    top4Ids = [];
    matchTop4Ids[activeMatchId] = [];

    // Optional: Switch back to ranking?
    // overlayState.ranking = true;
    // overlayState.top4 = false;
    // Or just let admin control visibility? User might prefer it closes or switches.
    // Let's safe switch back to Ranking to show all teams.
    overlayState.ranking = true;
    overlayState.top4 = false;

    io.emit('overlay_state_update', overlayState);
    io.emit('state_update', { type: 'top4Ids', data: top4Ids });
  }
}

// Swap players endpoint (MUST be outside io.on to avoid re-registering on each connection)
app.post('/api/teams/:id/swap-players', (req, res) => {
  const { id } = req.params;
  const { index1, index2 } = req.body;

  const teamId = parseInt(id);
  const team = teams.find(t => t.id === teamId);

  if (!team) {
    return res.status(404).json({ success: false, message: 'Team not found' });
  }

  if (index1 < 0 || index1 >= team.players.length || index2 < 0 || index2 >= team.players.length) {
    return res.status(400).json({ success: false, message: 'Invalid player indices' });
  }

  // Swap
  const temp = team.players[index1];
  team.players[index1] = team.players[index2];
  team.players[index2] = temp;

  // Update statuses: Active slots (0-3) become alive, Reserve slot (4+) becomes reserve
  team.players.forEach((p, i) => {
    if (i < 4) {
      if (p.status === 'reserve') p.status = 'alive';
    } else {
      p.status = 'reserve';
    }
  });

  // Persist
  matchesData[activeMatchId] = JSON.parse(JSON.stringify(teams));
  io.emit('state_update', { type: 'teams', data: teams });

  res.json({ success: true });
});

io.on('connection', (socket) => {
  console.log('✅ [DEBUG] User connected:', socket.id);

  // Send initial state
  console.log('📤 [DEBUG] Sending init_state to:', socket.id);
  socket.emit('init_state', { teams, killfeed, pendingKillfeed, overlayState, activeMatchId, top4Ids, chatHistory });

  // --- Chat Handler ---
  socket.on('send_chat', (data) => {
    const msg = { ...data, id: Date.now() };
    chatHistory.push(msg);
    if (chatHistory.length > 50) chatHistory.shift();
    io.emit('receive_chat', msg);
  });

  // --- Teams Handlers ---
  socket.on('update_player_status', ({ teamId, playerIndex, status }) => {
    const team = teams.find(t => t.id === teamId);
    if (team && team.players[playerIndex]) {
      team.players[playerIndex].status = status;
      team.aliveCount = team.players.filter(p => p.status !== 'dead').length;
      console.log(`🔄 [DEBUG] Player status updated: Team ${teamId}, Player ${playerIndex + 1} -> ${status}`);

      // --- AUTO PLACEMENT (Manual Toggle) ---
      if (team.aliveCount === 0) {
        const activeTeamsCount = teams.filter(t => t.id !== team.id && t.players.some(p => p.status !== 'dead')).length;
        const rank = activeTeamsCount + 1;

        const points = getPlacementPoints(rank);

        team.placement = points;
        console.log(`🏆 [AUTO-SCORE-MANUAL] ${team.tag} finishes Rank #${rank} -> +${points} pts`);

        // Checkout Winner
        if (activeTeamsCount === 1) {
          const winner = teams.find(t => t.id !== team.id && t.players.some(p => p.status !== 'dead'));
          if (winner) {
            winner.placement = getPlacementPoints(1);
            console.log(`🏆 [AUTO-SCORE-MANUAL] ${winner.tag} is CHAMPION (Rank #1) -> +${getPlacementPoints(1)} pts`);
          }
        }
      } else {
        // TEAM REVIVED (Alive > 0)
        if (team.placement !== 0) {
          console.log(`🚑 [REVIVE] ${team.tag} revived -> Reset Placement Points to 0`);
          team.placement = 0;
        }

        // CHECK WINNER REVERSAL
        const activeTeamsCount = teams.filter(t => t.players.some(p => p.status !== 'dead')).length;
        if (activeTeamsCount > 1) {
          teams.forEach(t => {
            if (t.placement === 10) {
              t.placement = 0;
              console.log(`⚠️ [REVOKE] ${t.tag} is NO LONGER Champion (Rank #1) -> Reset to 0 pts`);
            }
          });
        }
      }

      recalculateWWCD();
      checkTop4Trigger();
      matchesData[activeMatchId] = teams;
      saveState();
      io.emit('state_update', { type: 'teams', data: teams });
    }
  });

  socket.on('update_teams', (newTeams) => {
    teams = newTeams;
    console.log('📝 [DEBUG] Teams updated');
    recalculateWWCD();
    checkTop4Trigger();
    matchesData[activeMatchId] = teams;
    saveState();
    io.emit('state_update', { type: 'teams', data: teams });
  });

  socket.on('reset_match', () => {
    teams = teams.map(team => ({
      ...team,
      // placement: 0, // Keep placement points
      elims: 0,
      wwcd: 0,
      aliveCount: 4,
      players: team.players.map(p => ({ ...p, status: 'alive' }))
    }));
    killfeed = [];
    pendingKillfeed = [];
    console.log('🔁 [DEBUG] Match reset');
    // No need to calc WWCD here, it's 0 (or balanced 100/16)
    // Actually, on reset, everyone is alive, so chances should be equal ~6.25%
    recalculateWWCD();

    // Reset Top 4 Lock
    top4Ids = [];
    matchTop4Ids[activeMatchId] = [];
    io.emit('state_update', { type: 'top4Ids', data: [] });

    io.emit('state_update', { type: 'teams', data: teams });
    io.emit('state_update', { type: 'killfeed', data: killfeed });
    io.emit('pending_killfeed_update', pendingKillfeed);
  });

  // --- Manual Killfeed Handler (from Admin Dashboard) ---
  socket.on('push_killfeed', (item) => {
    console.log('💀 [DEBUG] Manual Killfeed:', item);

    // 1. Update Victim's Player Status
    if (item.victim && item.victim.teamId && item.victim.playerIdx !== null) {
      const team = teams.find(t => t.id === item.victim.teamId);
      if (team && team.players[item.victim.playerIdx]) {
        // Check if this is a Team Wipe (all others are dead)
        const otherPlayersAlive = team.players.filter((p, i) => i !== item.victim.playerIdx && p.status !== 'dead').length;

        if (otherPlayersAlive === 0) {
          // TEAM WIPE -> Set victim as DEAD (not just knocked)
          team.players[item.victim.playerIdx].status = 'dead';

          const killerName = typeof item.killer === 'object' ? item.killer.name : item.killer;
          console.log(`☠️ [DEBUG] TEAM WIPE: ${team.tag} eliminated by ${killerName}`);

          // Emit Wipe Event
          io.emit('team_wiped', {
            teamId: team.id,
            teamTag: team.tag,
            teamName: team.name,
            killer: killerName
          });

          // --- AUTO PLACEMENT POINTS CALCULATION ---
          // 1. Count how many OTHER teams are still alive
          const activeTeamsCount = teams.filter(t => t.id !== team.id && t.players.some(p => p.status !== 'dead')).length;
          const rank = activeTeamsCount + 1; // The rank of the team that just died

          const points = getPlacementPoints(rank);

          team.placement = points;
          console.log(`🏆 [AUTO-SCORE] ${team.tag} finishes Rank #${rank} -> +${points} pts`);

          // 2. Check if the Winner is decided (Only 1 team left)
          if (activeTeamsCount === 1) {
            const winner = teams.find(t => t.id !== team.id && t.players.some(p => p.status !== 'dead'));
            if (winner) {
              winner.placement = getPlacementPoints(1);
              console.log(`🏆 [AUTO-SCORE] ${winner.tag} is CHAMPION (Rank #1) -> +${getPlacementPoints(1)} pts`);
            }
          }
          // -----------------------------------------

        } else {
          // Normal Knock
          team.players[item.victim.playerIdx].status = 'knocked';
          console.log(`🎯 [DEBUG] Auto-Knocked: ${team.tag} Player ${item.victim.playerIdx + 1}`);
        }

        team.aliveCount = team.players.filter(p => p.status !== 'dead').length;
      }
    }

    // Broadcast team update
    recalculateWWCD();
    checkTop4Trigger();
    matchesData[activeMatchId] = teams;
    saveState();
    io.emit('state_update', { type: 'teams', data: teams });

    // 2. Directly add to Killfeed (NO pending confirmation)
    const newFeed = {
      id: Date.now(),
      killer: typeof item.killer === 'object' ? item.killer.name : item.killer,
      victim: typeof item.victim === 'object' ? item.victim.name : item.victim
    };
    killfeed.push(newFeed);
    if (killfeed.length > 50) killfeed.shift();
    io.emit('state_update', { type: 'killfeed', data: killfeed });
  });

  // --- OCR Killfeed Handler ---
  socket.on('new_kill_data', (item) => {
    // 1. Basic Cleaning
    const killer = String(item.killer || '').trim();
    const victim = String(item.victim || '').trim();
    const action = item.action || 'knocked';

    if (!killer || !victim) return;

    // 2. Logic to Find Team & Match Player (Auto-Match Logic)
    // We try to find a player name match in our database
    let matchedVictim = null;
    let matchedKiller = null;

    for (const team of teams) {
      if (!matchedVictim) {
        const vIdx = team.players.findIndex(p =>
          p.name.toLowerCase().includes(victim.toLowerCase()) ||
          victim.toLowerCase().includes(p.name.toLowerCase())
        );
        if (vIdx !== -1) matchedVictim = { teamTag: team.tag, name: team.players[vIdx].name, teamId: team.id, playerIdx: vIdx };
      }
      if (!matchedKiller) {
        const kIdx = team.players.findIndex(p =>
          p.name.toLowerCase().includes(killer.toLowerCase()) ||
          killer.toLowerCase().includes(p.name.toLowerCase())
        );
        if (kIdx !== -1) matchedKiller = { teamTag: team.tag, name: team.players[kIdx].name, teamId: team.id, playerIdx: kIdx };
      }
    }

    const ocrItem = {
      id: Date.now() + Math.random(),
      killer: killer,
      victim: victim,
      matchedKiller: matchedKiller,
      matchedVictim: matchedVictim,
      action: action,
      timestamp: item.timestamp || Date.now(),
      isOCR: true
    };

    console.log(`🤖 [OCR] Received: ${killer} -> ${victim} (${action})`);
    if (matchedVictim) console.log(`   └─ Match Found (Victim): ${matchedVictim.teamTag} ${matchedVictim.name}`);

    pendingKillfeed.push(ocrItem);
    if (pendingKillfeed.length > 10) pendingKillfeed.shift();

    io.emit('pending_killfeed_update', pendingKillfeed);
  });

  socket.on('reject_killfeed', (id) => {
    pendingKillfeed = pendingKillfeed.filter(i => i.id !== id);
    io.emit('pending_killfeed_update', pendingKillfeed);
  });

  socket.on('confirm_killfeed', (item) => {
    // 1. Remove from Pending
    if (item.id) {
      pendingKillfeed = pendingKillfeed.filter(i => i.id !== item.id);
      io.emit('pending_killfeed_update', pendingKillfeed);
    }

    // 2. Logic to Find Team & Match Player (Auto-Match Logic)
    // We try to find a player name match in our database
    const applyStatus = (matched) => {
      const team = teams.find(t => t.id === matched.teamId);
      if (team && team.players[matched.playerIdx]) {
        team.players[matched.playerIdx].status = item.action === 'killed' ? 'dead' : 'knocked';
        team.aliveCount = team.players.filter(p => p.status !== 'dead').length;
        console.log(`🎯 [CONFIRM] Direct Match: ${team.tag} ${team.players[matched.playerIdx].name} -> ${team.players[matched.playerIdx].status}`);
        return true;
      }
      return false;
    }

    const findAndKnock = (playerName) => {
      for (let tIdx = 0; tIdx < teams.length; tIdx++) {
        const pIdx = teams[tIdx].players.findIndex(p =>
          p.name.toLowerCase().includes(playerName.toLowerCase()) ||
          playerName.toLowerCase().includes(p.name.toLowerCase())
        );

        if (pIdx !== -1) {
          // Found Player -> Update Status
          teams[tIdx].players[pIdx].status = item.action === 'killed' ? 'dead' : 'knocked';
          teams[tIdx].aliveCount = teams[tIdx].players.filter(p => p.status !== 'dead').length;
          console.log(`🎯 [CONFIRM] Fuzzy Match: ${teams[tIdx].players[pIdx].name} -> ${teams[tIdx].players[pIdx].status}`);
          return true;
        }
      }
      return false;
    };

    // Attempt logic
    if (item.matchedVictim) {
      applyStatus(item.matchedVictim);
    } else {
      findAndKnock(item.victim);
    }

    // Broadcast Updates
    io.emit('state_update', { type: 'teams', data: teams });

    // 3. Push to Real Overlay
    const newFeed = { id: Date.now(), killer: item.killer, victim: item.victim, weapon: item.weapon };
    killfeed.push(newFeed);
    if (killfeed.length > 5) killfeed.shift();
    io.emit('state_update', { type: 'killfeed', data: killfeed });
  });





  // Manual Push (Directly from Admin Dashboard Manual Entry)
  socket.on('manual_killfeed', (item) => {
    // Direct push logic (Legacy or Manual)
    const newFeed = { id: Date.now(), ...item };
    killfeed.push(newFeed);
    if (killfeed.length > 5) killfeed.shift();
    io.emit('state_update', { type: 'killfeed', data: killfeed });
  });

  socket.on('clear_killfeed', () => {
    killfeed = [];
    io.emit('state_update', { type: 'killfeed', data: killfeed });
  });

  // --- Map Randomizer ---
  socket.on('start_randomizer', () => {
    io.emit('start_randomizer');
  });

  // --- Overlay Control ---
  socket.on('toggle_overlay', (data) => {
    const { type, isVisible } = data; // type: 'ranking', 'killfeed', 'top4'
    if (overlayState.hasOwnProperty(type)) {
      overlayState[type] = isVisible;

      // Auto-toggle logic: Ranking and Top4 are mutually exclusive
      if (type === 'ranking') {
        overlayState.top4 = !isVisible;
      } else if (type === 'top4') {
        overlayState.ranking = !isVisible;
      }

      io.emit('overlay_state_update', overlayState);
    }
  });

  socket.on('close_all_overlays', () => {
    console.log('🛑 [OVERLAY] Closing ALL overlays');
    Object.keys(overlayState).forEach(key => overlayState[key] = false);
    io.emit('overlay_state_update', overlayState);
  });

  // --- Match Control ---
  socket.on('change_match', (matchId) => {
    if (matchId >= 1 && matchId <= config.numMatches) {
      console.log(`🔄 [MATCH] Switching to Match ${matchId}`);
      activeMatchId = matchId;
      teams = matchesData[activeMatchId];
      top4Ids = matchTop4Ids[activeMatchId]; // Load locked IDs for this match

      // Note: In a real app we might want separate killfeeds per match.
      // For now, let's just clear killfeed on switch or keep it if requested.
      // Assuming fresh start for each match:
      killfeed = [];
      pendingKillfeed = [];

      recalculateWWCD();

      io.emit('state_update', { type: 'teams', data: teams });
      io.emit('state_update', { type: 'killfeed', data: killfeed });
      io.emit('state_update', { type: 'top4Ids', data: top4Ids });
      io.emit('match_changed', activeMatchId);
    }
  });

  // --- vMix Control Handlers ---
  socket.emit('vmix_update', vmixState); // Send initial vmix state

  socket.on('update_vmix_info', (data) => {
    // data: { day, week, matches: { 1: { map, winner: teamObj } } }
    console.log('🎬 [VMIX] Update Info:', data);

    // Base Paths from User's Config
    const MAP_BASE_PATH = process.env.MAP_BASE_PATH_1 || config.mapBasePath1;
    const LOGO_BASE_PATH = process.env.LOGO_BASE_PATH || config.logoBasePath;

    if (data.day) {
      vmixState.day = data.day;
      writeVMixFile('day.txt', `D${data.day}`);
      writeVMixFile('COMINGday.txt', data.day);
    }
    if (data.week) {
      vmixState.week = data.week;
      writeVMixFile('week.txt', `W${data.week}`);
      writeVMixFile('COMINGweek.txt', data.week);
    }

    if (data.matches) {
      // Merge matches update
      // Expected data.matches is an object with ID keys
      Object.keys(data.matches).forEach(key => {
        const mData = data.matches[key];
        if (!vmixState.matches[key]) vmixState.matches[key] = {};

        if (mData.map) {
          vmixState.matches[key].map = mData.map;
          writeVMixFile(`map_${key}.txt`, mData.map);

          const mapFileName = `${mData.map.toUpperCase()}.png`;
          const path1 = `${process.env.MAP_BASE_PATH_1 || config.mapBasePath1}${mapFileName}`;
          const path2 = `${process.env.MAP_BASE_PATH_2 || config.mapBasePath2}${mapFileName}`;

          // Write both paths with Windows CRLF
          writeVMixFile(`map_img_${key}.csv`, `${path1}\r\n${path2}`);
        }

        if (mData.winner !== undefined || mData.showWinner !== undefined) {
          if (mData.winner !== undefined) vmixState.matches[key].winner = mData.winner;

          let visibilityChanged = false;
          if (mData.showWinner !== undefined) {
            vmixState.matches[key].showWinner = mData.showWinner;
            visibilityChanged = true;
          }

          const winner = vmixState.matches[key].winner;
          const show = vmixState.matches[key].showWinner !== false; // Default true if undefined

          if (show && winner) {
            writeVMixFile(`winner_${key}.txt`, winner.name || '');
            writeVMixFile(`winner_team_${key}.txt`, winner.tag || '');
            const logoPath = winner.tag ? `${LOGO_BASE_PATH}${winner.tag}.png` : '';
            writeVMixFile(`winner_logo_${key}.txt`, logoPath);

            // 🚀 Send API Commands instantly for data
            const vMixHost = process.env.VMIX_HOST || config.vmixHost;
            const winnerInput = process.env.VMIX_WWCD_INPUT || '86bf3cbb-2e51-49c8-9311-5ebf65a77201'; // WWCD GT Title UUID
            
            // Send SetImage for Logo
            if (logoPath) {
              const urlImage = `${vMixHost}/api/?Function=SetImage&Input=${winnerInput}&SelectedName=logo${key}.Source&Value=${encodeURIComponent(logoPath)}`;
              http.get(urlImage, res => res.resume()).on('error', err => console.error('API Error:', err.message));
            }
            // Send SetText for Team Name & Tag (Assumed names, adjust if needed)
            const urlTextTag = `${vMixHost}/api/?Function=SetText&Input=${winnerInput}&SelectedName=winner_team_${key}.Text&Value=${encodeURIComponent(winner.tag || '')}`;
            http.get(urlTextTag, res => res.resume()).on('error', err => console.error('API Error:', err.message));

            const urlTextName = `${vMixHost}/api/?Function=SetText&Input=${winnerInput}&SelectedName=winner_${key}.Text&Value=${encodeURIComponent(winner.name || '')}`;
            http.get(urlTextName, res => res.resume()).on('error', err => console.error('API Error:', err.message));

          } else {
            // Hidden -> Write Empty
            writeVMixFile(`winner_${key}.txt`, '');
            writeVMixFile(`winner_team_${key}.txt`, '');
            writeVMixFile(`winner_logo_${key}.txt`, '');
          }

          // Trigger vMix API if visibility toggled
          if (visibilityChanged) {
            const cmd = show ? 'SetImageVisibleOn' : 'SetImageVisibleOff';
            const vMixHost = process.env.VMIX_HOST || config.vmixHost;

            // Determine which image elements to target based on the current match key (1, 2, or 3)
            // Example names in GT Title: fc1.Source, fc2.Source, fc3.Source
            // Image names in first GT: Image1.Source, Image2.Source, Image3.Source
            // WWCD names: WWCD1.Source, WWCD2.Source, WWCD3.Source
            // logo names: logo1.Source, logo2.Source, logo3.Source

            // NOTE: According to earlier data, the GT Titles might have different numbering. 
            // e.g. Match 1 = fc1, WWCD1, logo1, Image1 
            // We use `key` (which is '1', '2', or '3') to dynamically target them.

            const actions = [
              { input: process.env.VMIX_FC_INPUT || '653e40b9-2b68-4af0-8137-82db6b8d956e', name: `fc${key}.Source` },
              { input: process.env.VMIX_WWCD_INPUT || '86bf3cbb-2e51-49c8-9311-5ebf65a77201', name: `WWCD${key}.Source` },
              { input: process.env.VMIX_WWCD_INPUT || '86bf3cbb-2e51-49c8-9311-5ebf65a77201', name: `logo${key}.Source` },
              { input: process.env.VMIX_FC_INPUT || '653e40b9-2b68-4af0-8137-82db6b8d956e', name: `Image${key}.Source` }
            ];

            console.log(`📡 [VMIX-API] Sending ${cmd} for Match ${key} to ${actions.length} layers...`);

            actions.forEach(({ input, name }) => {
              const url = `${vMixHost}/api/?Function=${cmd}&Input=${input}&SelectedName=${name}`;
              console.log(`   └─ Calling: ${url}`);
              http.get(url, (res) => {
                // Consume response
                res.resume();
              }).on('error', (err) => {
                console.error(`❌ [VMIX-API] Error calling ${url}:`, err.message);
              });
            });
          }
        }
      });
    }

    io.emit('vmix_update', vmixState);
  });

  socket.on('control_timer', (action) => {
    // action: { command: 'start' | 'stop' | 'set', minutes, seconds }
    console.log('⏱️ [TIMER] Action:', action);

    if (action.command === 'set') {
      vmixState.timer.minutes = parseInt(action.minutes) || 0;
      vmixState.timer.seconds = parseInt(action.seconds) || 0;
      const timeStr = `${String(vmixState.timer.minutes).padStart(2, '0')}:${String(vmixState.timer.seconds).padStart(2, '0')}`;
      writeVMixFile('timer.txt', timeStr);
      io.emit('vmix_update', vmixState);
    }
    else if (action.command === 'start') {
      startServerTimer();
    }
    else if (action.command === 'stop') {
      stopServerTimer();
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ [DEBUG] User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;

// Handle React routing, return all requests to React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
