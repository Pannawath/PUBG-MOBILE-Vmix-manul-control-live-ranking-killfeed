/**
 * PUBG Leaderboard Poster Generator
 * Canvas-based image generation with editable text
 */

// ========================================
// Configuration
// ========================================
const CONFIG = {
    // Canvas dimensions (match SVG)
    width: 3656,
    height: 2664,

    // Layout
    totalTeams: 16,
    teamsPerColumn: 8,

    // Coordinates for text placement
    leftColumn: {
        rankX: 380,      // ตามที่คุณปรับล่าสุด
        nameX: 1015,     // ตามที่คุณปรับล่าสุด (Center)
        scoreX: 1680,    // ตามที่คุณปรับล่าสุด (Center)
        startY: 1023,    // Tuned vertical start
        rowHeight: 175   // Tuned row height
    },
    rightColumn: {
        rankX: 1905,     // เลื่อนขวา 25px (จาก 1880)
        nameX: 2540,     // เลื่อนขวา 25px (จาก 2515)
        scoreX: 3205,    // เลื่อนขวา 25px (จาก 3180)
        startY: 1023,    // เท่ากับคอลัมน์ซ้าย
        rowHeight: 175   // เท่ากับคอลัมน์ซ้าย
    },

    // Text styling
    font: {
        family: "'Teko', 'Prompt', sans-serif",
        size: 85,
        weight: '600'
    },
    colors: {
        rank: '#F4D03F',
        rankHighlight: '#FFFFFF',
        text: '#FFFFFF',
        shadow: 'rgba(0, 0, 0, 0.8)'
    }
};

// ========================================
// State
// ========================================
let backgroundImage = null;
let overlayImage = null;
let isBackgroundLoaded = false;
let isOverlayLoaded = false;

// ========================================
// DOM Elements
// ========================================
const canvas = document.getElementById('posterCanvas');
const ctx = canvas.getContext('2d');

const teamsLeftContainer = document.getElementById('teamsLeft');
const teamsRightContainer = document.getElementById('teamsRight');

const btnGenerate = document.getElementById('btnGenerate');
const btnDownload = document.getElementById('btnDownload');
const btnClear = document.getElementById('btnClear');
const btnSample = document.getElementById('btnSample');

// ========================================
// Initialize
// ========================================
function init() {
    canvas.width = CONFIG.width;
    canvas.height = CONFIG.height;

    generateTeamInputs();
    loadAllImages();

    btnGenerate.addEventListener('click', generatePoster);
    btnDownload.addEventListener('click', downloadPoster);
    btnClear.addEventListener('click', clearForm);
    btnSample.addEventListener('click', fillSampleData);
}

// ========================================
// Generate Team Input Forms
// ========================================
function generateTeamInputs() {
    for (let i = 1; i <= 8; i++) {
        teamsLeftContainer.appendChild(createTeamRow(i));
    }
    for (let i = 9; i <= 16; i++) {
        teamsRightContainer.appendChild(createTeamRow(i));
    }

    // Add input listeners for auto-generate
    document.querySelectorAll('.team-row input').forEach(input => {
        input.addEventListener('input', debounce(generatePoster, 300));
    });
}

function createTeamRow(index) {
    const row = document.createElement('div');
    row.className = `team-row${index === 1 ? ' highlight' : ''}`;
    row.innerHTML = `
        <label>#${index}</label>
        <input type="text" id="name_${index}" placeholder="ชื่อทีม ${index}" maxlength="30">
        <input type="number" id="score_${index}" placeholder="คะแนน" min="0" max="9999" value="0">
    `;
    return row;
}

// ========================================
// Load Images
// ========================================
async function loadAllImages() {
    // Load Background
    backgroundImage = new Image();
    backgroundImage.onload = () => {
        isBackgroundLoaded = true;
        console.log('✓ Background loaded');
        tryGeneratePoster();
    };
    backgroundImage.onerror = () => console.error('✗ Failed to load BG.png');
    backgroundImage.src = 'BG.png';

    // Load and clean SVG overlay
    try {
        const response = await fetch('อันดับคะแนนรวม.svg');
        const svgText = await response.text();

        // Parse SVG and remove text images
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, 'image/svg+xml');

        // Remove all <image> elements that have aria-label (these are the static text)
        const textImages = doc.querySelectorAll('image[aria-label]');
        console.log(`Found ${textImages.length} text images to remove`);
        textImages.forEach(img => img.remove());

        // Convert back to image
        const serializer = new XMLSerializer();
        const cleanedSvg = serializer.serializeToString(doc);
        const blob = new Blob([cleanedSvg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);

        overlayImage = new Image();
        overlayImage.onload = () => {
            isOverlayLoaded = true;
            console.log('✓ Overlay loaded and cleaned');
            tryGeneratePoster();
        };
        overlayImage.onerror = () => console.error('✗ Failed to load cleaned SVG');
        overlayImage.src = url;

    } catch (err) {
        console.error('✗ Failed to fetch SVG:', err);
    }
}

function tryGeneratePoster() {
    if (isBackgroundLoaded && isOverlayLoaded) {
        generatePoster();
    }
}

// ========================================
// Generate Poster
// ========================================
function generatePoster() {
    ctx.clearRect(0, 0, CONFIG.width, CONFIG.height);

    // Layer 1: Background
    if (isBackgroundLoaded && backgroundImage) {
        ctx.drawImage(backgroundImage, 0, 0, CONFIG.width, CONFIG.height);
    } else {
        drawFallbackBackground();
    }

    // Layer 2: Cleaned Overlay (graphics only, no text)
    if (isOverlayLoaded && overlayImage) {
        ctx.drawImage(overlayImage, 0, 0, CONFIG.width, CONFIG.height);
    }

    // Layer 3: Dynamic Text
    const teams = getTeamData();
    teams.forEach((team, index) => {
        const isLeftColumn = index < 8;
        const rowIndex = isLeftColumn ? index : index - 8;
        const col = isLeftColumn ? CONFIG.leftColumn : CONFIG.rightColumn;
        const y = col.startY + (rowIndex * col.rowHeight);
        const isFirst = index === 0;

        drawTeamEntry(team, col, y, isFirst);
    });

    // Draw debug lines if active
    drawDebugGuidelines();
}

function drawFallbackBackground() {
    const gradient = ctx.createLinearGradient(0, 0, CONFIG.width, CONFIG.height);
    gradient.addColorStop(0, '#0a1628');
    gradient.addColorStop(0.5, '#1a3050');
    gradient.addColorStop(1, '#0a1628');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);
}

function getTeamData() {
    const teams = [];
    for (let i = 1; i <= CONFIG.totalTeams; i++) {
        const nameInput = document.getElementById(`name_${i}`);
        const scoreInput = document.getElementById(`score_${i}`);
        teams.push({
            rank: i,
            name: nameInput?.value || `TEAM ${i}`,
            score: parseInt(scoreInput?.value) || 0
        });
    }
    return teams;
}

function drawTeamEntry(team, col, y, isHighlight) {
    ctx.font = `${CONFIG.font.weight} ${CONFIG.font.size}px ${CONFIG.font.family}`;
    ctx.textBaseline = 'middle';
    ctx.shadowColor = CONFIG.colors.shadow;
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // Rank (Left Align)
    ctx.fillStyle = isHighlight ? CONFIG.colors.rankHighlight : CONFIG.colors.rank;
    ctx.textAlign = 'left';
    ctx.fillText(`#${team.rank}`, col.rankX, y);

    // Name (Center Align)
    ctx.fillStyle = CONFIG.colors.text;
    ctx.textAlign = 'center';
    ctx.fillText(team.name.toUpperCase(), col.nameX, y);

    // Score (Center Align)
    ctx.fillStyle = CONFIG.colors.text;
    ctx.textAlign = 'center';
    ctx.fillText(team.score.toString(), col.scoreX, y);

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
}

// ========================================
// Download Poster
// ========================================
function downloadPoster() {
    generatePoster();
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 10);
    link.download = `PUBG_Leaderboard_${timestamp}.png`;
    link.href = canvas.toDataURL('image/png', 1.0);
    link.click();
}

// ========================================
// Form Actions
// ========================================
function clearForm() {
    for (let i = 1; i <= CONFIG.totalTeams; i++) {
        const nameInput = document.getElementById(`name_${i}`);
        const scoreInput = document.getElementById(`score_${i}`);
        if (nameInput) nameInput.value = '';
        if (scoreInput) scoreInput.value = '0';
    }
    generatePoster();
}

function fillSampleData() {
    const sampleTeams = [
        { name: 'SPK ERAWAN ESPORTS', score: 156 },
        { name: 'BTR RA', score: 142 },
        { name: 'EVOS DIVINE', score: 138 },
        { name: 'RRQ ATHENA', score: 125 },
        { name: 'GEEK FAM', score: 118 },
        { name: 'BOOM ESPORTS', score: 112 },
        { name: 'TEAM SECRET', score: 105 },
        { name: 'NOVA ESPORTS', score: 98 },
        { name: 'VALDUS ESPORTS', score: 92 },
        { name: "D'XAVIER", score: 85 },
        { name: 'MORPH TEAM', score: 78 },
        { name: 'ALTER EGO', score: 72 },
        { name: '4AM', score: 65 },
        { name: 'NATUS VINCERE', score: 58 },
        { name: 'FaZe CLAN', score: 52 },
        { name: 'CLOUD9', score: 45 }
    ];

    sampleTeams.forEach((team, index) => {
        const nameInput = document.getElementById(`name_${index + 1}`);
        const scoreInput = document.getElementById(`score_${index + 1}`);
        if (nameInput) nameInput.value = team.name;
        if (scoreInput) scoreInput.value = team.score;
    });

    generatePoster();
}

// ========================================
// Utilities & Debug
// ========================================
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

let isDebugMode = false;
document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'd') {
        isDebugMode = !isDebugMode;
        generatePoster();
        console.log(`Debug Mode: ${isDebugMode ? 'ON' : 'OFF'}`);
    }
});

function drawDebugGuidelines() {
    if (!isDebugMode) return;
    ctx.save();
    ctx.strokeStyle = '#FF0000';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 5]);

    const cols = [CONFIG.leftColumn, CONFIG.rightColumn];
    cols.forEach((col, colIndex) => {
        for (let i = 0; i < 8; i++) {
            const y = col.startY + (i * col.rowHeight);
            ctx.beginPath();
            if (colIndex === 0) {
                ctx.moveTo(100, y);
                ctx.lineTo(1700, y);
            } else {
                ctx.moveTo(1900, y);
                ctx.lineTo(3500, y);
            }
            ctx.stroke();
        }
    });
    ctx.restore();
}

// ========================================
// Start
// ========================================
document.addEventListener('DOMContentLoaded', init);
