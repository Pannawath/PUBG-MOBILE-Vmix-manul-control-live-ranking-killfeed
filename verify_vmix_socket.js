const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const SOCKET_URL = 'http://localhost:3001';
const VMIX_DIR = 'c:\\Users\\mapay\\Desktop\\PUBG LIVE\\web\\control\\server\\vmix';

console.log('🔄 Connecting to Socket.IO Server:', SOCKET_URL);
const socket = io(SOCKET_URL);

// Helper to check file existence and content
function checkFile(filename) {
    const fullPath = path.join(VMIX_DIR, filename);
    if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        console.log(`✅ File Found: [${filename}] Content: "${content}"`);
    } else {
        console.error(`❌ File Missing: [${filename}]`);
    }
}

socket.on('connect', () => {
    console.log('✅ Connected to Server! ID:', socket.id);

    // 1. Test Timer
    console.log('\n--- 1. Testing Timer ---');
    console.log('setting timer to 5:00...');
    socket.emit('control_timer', { command: 'set', minutes: 5, seconds: 0 });

    setTimeout(() => {
        checkFile('timer.txt');

        console.log('starting timer...');
        socket.emit('control_timer', { command: 'start' });
    }, 1000);

    // 2. Test Day/Week
    setTimeout(() => {
        console.log('\n--- 2. Testing Day/Week ---');
        console.log('updating day to "5" and week to "2"...');
        socket.emit('update_vmix_info', { day: '5', week: '2' });

        setTimeout(() => {
            checkFile('day.txt');
            checkFile('week.txt');
        }, 1000);
    }, 3000);

    // 3. Test Map/Winner
    setTimeout(() => {
        console.log('\n--- 3. Testing Map/Winner ---');
        console.log('setting Match 1 Map to "Erangel" and Winner to "TEST_TEAM"...');

        // Emulating a team object
        const testTeam = { id: 999, name: 'Test Team', tag: 'TEST' };

        socket.emit('update_vmix_info', {
            matches: {
                1: { map: 'Erangel', winner: testTeam }
            }
        });

        setTimeout(() => {
            checkFile('map_1.txt');
            checkFile('map_img_1.txt'); // Should be .../map1/ERANGEL.png
            checkFile('winner_1.txt');
            checkFile('winner_team_1.txt');
            checkFile('winner_logo_1.txt'); // Should be .../team_logos/TEST.png

            console.log('\n🎉 Test Complete! Disconnecting...');
            socket.disconnect();
            process.exit(0);
        }, 1000);
    }, 6000);
});

socket.on('connect_error', (err) => {
    console.error('❌ Connection Error:', err.message);
    process.exit(1);
});
