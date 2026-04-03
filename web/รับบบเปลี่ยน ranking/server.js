require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const { createObjectCsvWriter } = require('csv-writer');

const app = express();
const port = process.env.PORT || 3000;

// ======== Global Error Handlers (Crash Protection) ========
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err.message);
    console.error(err.stack);
    // Don't exit - keep running
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[WARN] Unhandled Promise Rejection:', reason);
    // Don't exit - keep running
});

// Set up middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Set up view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Credentials: prefer .env, fallback to credentials.json file
const CREDENTIALS_PATH = 'credentials.json';
const OUTPUT_FILE = path.join(__dirname, 'data', 'vmix_data.csv');
const CONFIG_PATH = path.join(__dirname, 'config', 'sheets.json');

// Helper to read config
function getSheetConfig() {
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        } catch (e) {
            console.error("Error reading config:", e);
            return [];
        }
    }
    return [];
}

// Placeholder for sheets service
let sheetsService = null;

// Function to authenticate with Google Sheets API
function authenticateGoogleSheets() {
    // Method 1: Use credentials from .env
    if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        console.log('[AUTH] Using Google credentials from .env');
        const auth = new google.auth.GoogleAuth({
            credentials: {
                type: 'service_account',
                project_id: process.env.GOOGLE_PROJECT_ID,
                private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
                private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                client_id: process.env.GOOGLE_CLIENT_ID,
                auth_uri: process.env.GOOGLE_AUTH_URI || 'https://accounts.google.com/o/oauth2/auth',
                token_uri: process.env.GOOGLE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        return google.sheets({ version: 'v4', auth });
    }

    // Method 2: Fallback to credentials.json file
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        console.error('Credentials not found! Set GOOGLE_CLIENT_EMAIL & GOOGLE_PRIVATE_KEY in .env or provide credentials.json');
        return null;
    }
    console.log('[AUTH] Using Google credentials from credentials.json file');
    const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_PATH,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    return google.sheets({ version: 'v4', auth });
}

// Routes
app.get('/', (req, res) => {
    res.render('index', {
        credentialsStatus: fs.existsSync(CREDENTIALS_PATH),
        sheets: getSheetConfig()
    });
});

// Endpoint to fetch sheet names/tabs
app.post('/api/get-sheets', async (req, res) => {
    const { spreadsheetId } = req.body;
    if (!spreadsheetId) {
        return res.status(400).json({ error: 'Spreadsheet ID is required' });
    }

    try {
        if (!sheetsService) sheetsService = authenticateGoogleSheets();
        if (!sheetsService) {
            return res.status(500).json({ error: 'Authentication failed. Please check credentials.json.' });
        }

        const response = await sheetsService.spreadsheets.get({
            spreadsheetId,
        });

        const sheets = response.data.sheets.map(sheet => sheet.properties.title);
        res.json({ sheets });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch sheets: ' + error.message });
    }
});

// Endpoint to fetch data from a specific sheet
app.post('/api/get-data', async (req, res) => {
    const { spreadsheetId, sheetName, type } = req.body;
    if (!spreadsheetId || !sheetName) {
        return res.status(400).json({ error: 'Spreadsheet ID and Sheet Name are required' });
    }

    try {
        if (!sheetsService) sheetsService = authenticateGoogleSheets();
        if (!sheetsService) {
            return res.status(500).json({ error: 'Authentication failed. Please check credentials.json.' });
        }

        const response = await sheetsService.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A1:Z500`, // Adjust range as needed
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.json({ data: [] });
        }

        let targetHeaders = [];
        let data = [];

        if (type === 'day') {
            // New mapping for Day Ranking
            // Index: 0=TEAM ID, 1=TEAM NAME, 2=M1, 3=M2, 4=M3, 6=TOTAL, 7=RANK
            targetHeaders = ['Team ID', 'Team Name', 'M1', 'M2', 'M3', 'Total', 'Rank'];
            data = rows.slice(1).map(row => {
                return {
                    'Team ID': row[0] || '',
                    'Team Name': row[1] || '',
                    'M1': row[2] || '0',
                    'M2': row[3] || '0',
                    'M3': row[4] || '0',
                    'Total': row[6] || '0',
                    'Rank': row[7] || ''
                };
            });
        } else if (type === 'overall') {
            // Mapping for Overall Ranking
            // Index: 0=TEAM ID, 1=TEAM NAME, 2=WEEK1, 3=WEEK2, 4=FINAL, 5=TOTAL OVERALL, 6=RANK
            targetHeaders = ['Team ID', 'Team Name', 'Week 1', 'Week 2', 'Final', 'Total Overall', 'Rank'];
            data = rows.slice(1).map(row => {
                return {
                    'Team ID': row[0] || '',
                    'Team Name': row[1] || '',
                    'Week 1': row[2] || '0',
                    'Week 2': row[3] || '0',
                    'Final': row[4] || '0',
                    'Total Overall': row[5] || '0',
                    'Rank': row[6] || ''
                };
            });
        } else if (type === 'week') {
            // Mapping for Week Ranking
            // Index: 0=TEAM ID, 1=TEAM NAME, 2=DAY1, 3=DAY2, 4=TOTAL WEEK, 5=RANK
            targetHeaders = ['Team ID', 'Team Name', 'Day 1', 'Day 2', 'Total Week', 'Rank'];
            data = rows.slice(1).map(row => {
                return {
                    'Team ID': row[0] || '',
                    'Team Name': row[1] || '',
                    'Day 1': row[2] || '0',
                    'Day 2': row[3] || '0',
                    'Total Week': row[4] || '0',
                    'Rank': row[5] || ''
                };
            });
        } else {
            // Default fallback (though now mostly unused if types are correct)
            targetHeaders = ['Name', 'Rank', 'Kill', 'Score'];
            data = rows.slice(1).map(row => {
                return {
                    'Name': row[1] || '',
                    'Rank': row[0] || '',
                    'Kill': row[4] || '0',
                    'Score': row[5] || '0'
                };
            });
        }

        // Filter out rows that are largely empty
        const cleanData = data.filter(item => {
            if (type === 'day' || type === 'overall' || type === 'week') return item['Team Name'] || item['Team ID'];
            return item.Name || item.Rank;
        });

        // Auto-sort by Rank (ascending), then by score descending as tiebreaker
        const sortedData = sortByRank(cleanData, type);

        res.json({ headers: targetHeaders, data: sortedData });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch data: ' + error.message });
    }
});

// Helper function to sort data by rank/score
function sortByRank(data, type) {
    let sorted;
    if (type === 'day') {
        // Sort by Rank ascending (treat as number), tiebreak by Total descending
        sorted = [...data].sort((a, b) => {
            const rankA = parseInt(a['Rank']) || 9999;
            const rankB = parseInt(b['Rank']) || 9999;
            if (rankA !== rankB) return rankA - rankB;
            return (parseInt(b['Total']) || 0) - (parseInt(a['Total']) || 0);
        });
    } else if (type === 'week') {
        // Sort by Rank ascending, tiebreak by Total Week descending
        sorted = [...data].sort((a, b) => {
            const rankA = parseInt(a['Rank']) || 9999;
            const rankB = parseInt(b['Rank']) || 9999;
            if (rankA !== rankB) return rankA - rankB;
            return (parseInt(b['Total Week']) || 0) - (parseInt(a['Total Week']) || 0);
        });
    } else if (type === 'overall') {
        // Sort by Rank ascending, tiebreak by Total Overall descending
        sorted = [...data].sort((a, b) => {
            const rankA = parseInt(a['Rank']) || 9999;
            const rankB = parseInt(b['Rank']) || 9999;
            if (rankA !== rankB) return rankA - rankB;
            return (parseInt(b['Total Overall']) || 0) - (parseInt(a['Total Overall']) || 0);
        });
    } else {
        // Default: sort by Score descending
        sorted = [...data].sort((a, b) => {
            return (parseInt(b['Score']) || 0) - (parseInt(a['Score']) || 0);
        });
    }

    // Recalculate Rank numbers sequentially (1, 2, 3...)
    sorted.forEach((item, index) => {
        if ('Rank' in item) {
            item['Rank'] = String(index + 1);
        }
    });

    return sorted;
}

// Endpoint to save data to file for vMix
app.post('/api/send-to-vmix', async (req, res) => {
    const { data, headers, type } = req.body;

    // Ensure data directory exists
    if (!fs.existsSync(path.join(__dirname, 'data'))) {
        fs.mkdirSync(path.join(__dirname, 'data'));
    }

    let fileName = 'vmix_data.csv'; // default
    if (type === 'day') fileName = 'day_ranking.csv';
    else if (type === 'week') fileName = 'week_ranking.csv';
    else if (type === 'overall') fileName = 'overall_ranking.csv';

    const outputFilePath = path.join(__dirname, 'data', fileName);

    const csvWriter = createObjectCsvWriter({
        path: outputFilePath,
        header: headers.map(h => ({ id: h, title: h }))
    });

    try {
        // Sort data by rank before writing to CSV
        const sortedData = sortByRank(data, type);
        await csvWriter.writeRecords(sortedData);
        console.log(`Data written to ${outputFilePath} (sorted by rank)`);
        res.json({ success: true, message: `Data saved to ${fileName}` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to save file: ' + error.message });
    }
});

// ======== Express Error Middleware (must be last) ========
app.use((err, req, res, next) => {
    console.error('[EXPRESS ERROR]', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(port, () => {
    console.log(`[OK] Ranking Server running at http://localhost:${port}`);
    console.log(`[OK] Server is stable and crash-protected.`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[SHUTDOWN] Gracefully shutting down...');
    server.close(() => {
        console.log('[SHUTDOWN] Server closed.');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n[SHUTDOWN] SIGTERM received...');
    server.close(() => {
        console.log('[SHUTDOWN] Server closed.');
        process.exit(0);
    });
});
