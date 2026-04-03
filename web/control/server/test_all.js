/**
 * PUBG LIVE Control - Full Integration Test
 * ทดสอบทุก feature ผ่าน Socket.io + HTTP
 */
const { io } = require('socket.io-client');
const http = require('http');

const SERVER = 'http://localhost:3001';
let passed = 0;
let failed = 0;
let results = [];

function log(status, test, detail = '') {
    const icon = status === 'PASS' ? '✅' : '❌';
    if (status === 'PASS') passed++;
    else failed++;
    const msg = `${icon} [${status}] ${test}${detail ? ' — ' + detail : ''}`;
    results.push(msg);
    console.log(msg);
}

function httpRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, SERVER);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method,
            headers: { 'Content-Type': 'application/json' }
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, data }); }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runTests() {
    console.log('');
    console.log('========================================');
    console.log('  PUBG LIVE Control - Integration Test');
    console.log('========================================');
    console.log('');

    // =====================================
    // TEST 1: Socket Connection
    // =====================================
    const socket = io(SERVER, { autoConnect: false });

    // Listen for init_state BEFORE connect so we don't miss it
    const initStatePromise = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 5000);
        socket.on('init_state', (state) => {
            clearTimeout(timeout);
            resolve(state);
        });
    });

    const connectResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 5000);
        socket.on('connect', () => {
            clearTimeout(timeout);
            resolve(true);
        });
        socket.connect();
    });

    log(connectResult ? 'PASS' : 'FAIL', 'Socket.io Connection',
        connectResult ? `Connected as ${socket.id}` : 'Timeout');

    if (!connectResult) {
        console.log('\n⛔ Cannot continue without socket connection');
        process.exit(1);
    }

    // =====================================
    // TEST 2: Receive init_state
    // =====================================
    const initState = await initStatePromise;

    if (initState) {
        log('PASS', 'init_state received', `${initState.teams?.length} teams, match #${initState.activeMatchId}`);
        log(initState.teams?.length > 0 ? 'PASS' : 'FAIL', 'Teams data present', `${initState.teams?.length} teams`);
        log(initState.overlayState ? 'PASS' : 'FAIL', 'Overlay state present');
        log(initState.activeMatchId ? 'PASS' : 'FAIL', 'Active match ID present', `Match #${initState.activeMatchId}`);
    } else {
        log('FAIL', 'init_state received', 'Timeout - no data received');
    }

    // =====================================
    // TEST 3: Toggle Overlay Controls
    // =====================================
    for (const type of ['ranking', 'killfeed', 'top4']) {
        const overlayResult = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 2000);
            socket.once('overlay_state_update', (state) => {
                clearTimeout(timeout);
                resolve(state);
            });
            socket.emit('toggle_overlay', { type, isVisible: false });
        });

        log(overlayResult ? 'PASS' : 'FAIL', `Toggle overlay: ${type} OFF`,
            overlayResult ? `State: ${JSON.stringify(overlayResult)}` : 'No response');
    }

    // Turn ranking back ON
    await new Promise((resolve) => {
        socket.once('overlay_state_update', resolve);
        socket.emit('toggle_overlay', { type: 'ranking', isVisible: true });
    });
    log('PASS', 'Toggle overlay: ranking ON');

    // =====================================
    // TEST 4: Close All Overlays
    // =====================================
    const closeAllResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 2000);
        socket.once('overlay_state_update', (state) => {
            clearTimeout(timeout);
            resolve(state);
        });
        socket.emit('close_all_overlays');
    });

    if (closeAllResult) {
        const allOff = !closeAllResult.ranking && !closeAllResult.killfeed && !closeAllResult.top4;
        log(allOff ? 'PASS' : 'FAIL', 'Close All Overlays', JSON.stringify(closeAllResult));
    } else {
        log('FAIL', 'Close All Overlays', 'No response');
    }

    // =====================================
    // TEST 5: Switch Matches (M1 → M2 → M3 → M1)
    // =====================================
    for (const matchId of [2, 3, 1]) {
        const matchResult = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 2000);
            socket.once('match_changed', (id) => {
                clearTimeout(timeout);
                resolve(id);
            });
            socket.emit('change_match', matchId);
        });

        log(matchResult === matchId ? 'PASS' : 'FAIL', `Switch to Match ${matchId}`,
            matchResult ? `Confirmed Match #${matchResult}` : 'No confirmation');
    }

    // =====================================
    // TEST 6: Update Player Status (Alive → Knocked → Dead)
    // =====================================
    const statusUpdates = ['knocked', 'dead', 'alive'];
    for (const status of statusUpdates) {
        const statusResult = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 2000);
            socket.once('state_update', (update) => {
                clearTimeout(timeout);
                if (update.type === 'teams') resolve(update.data);
                else resolve(null);
            });
            socket.emit('update_player_status', { teamId: 1, playerIndex: 0, status });
        });

        if (statusResult) {
            const team = statusResult.find(t => t.id === 1);
            const actualStatus = team?.players[0]?.status;
            log(actualStatus === status ? 'PASS' : 'FAIL', `Player Status → ${status}`,
                `Actual: ${actualStatus}`);
        } else {
            log('FAIL', `Player Status → ${status}`, 'No response');
        }
    }

    // =====================================
    // TEST 7: Update Team Info
    // =====================================
    const teamsData = initState?.teams || [];
    if (teamsData.length > 0) {
        const modifiedTeams = teamsData.map(t => {
            if (t.id === 1) return { ...t, tag: 'TEST', name: 'Test Team' };
            return t;
        });

        const teamUpdateResult = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 2000);
            socket.once('state_update', (update) => {
                clearTimeout(timeout);
                if (update.type === 'teams') resolve(update.data);
                else resolve(null);
            });
            socket.emit('update_teams', modifiedTeams);
        });

        if (teamUpdateResult) {
            const team = teamUpdateResult.find(t => t.id === 1);
            log(team?.tag === 'TEST' ? 'PASS' : 'FAIL', 'Update team tag', `Tag: ${team?.tag}`);
            log(team?.name === 'Test Team' ? 'PASS' : 'FAIL', 'Update team name', `Name: ${team?.name}`);
        } else {
            log('FAIL', 'Update team info', 'No response');
        }

        // Restore original
        socket.emit('update_teams', teamsData);
        await wait(500);
    }

    // =====================================
    // TEST 8: Push Killfeed
    // =====================================
    const killfeedResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 2000);
        socket.once('state_update', (update) => {
            clearTimeout(timeout);
            if (update.type === 'killfeed') resolve(update.data);
            else if (update.type === 'teams') {
                // Wait for killfeed update after teams
                socket.once('state_update', (u2) => {
                    clearTimeout(timeout);
                    if (u2.type === 'killfeed') resolve(u2.data);
                    else resolve(null);
                });
            }
        });
        socket.emit('push_killfeed', {
            killer: { name: 'TestKiller', teamId: 1, playerIdx: 0 },
            victim: { name: 'TestVictim', teamId: 2, playerIdx: 0 }
        });
    });

    log(killfeedResult ? 'PASS' : 'FAIL', 'Push Killfeed',
        killfeedResult ? `Feed length: ${killfeedResult.length}` : 'No response');

    // =====================================
    // TEST 9: Clear Killfeed
    // =====================================
    const clearResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 2000);
        socket.once('state_update', (update) => {
            clearTimeout(timeout);
            if (update.type === 'killfeed') resolve(update.data);
            else resolve(null);
        });
        socket.emit('clear_killfeed');
    });

    log(clearResult && clearResult.length === 0 ? 'PASS' : 'FAIL', 'Clear Killfeed',
        clearResult ? `Feed items: ${clearResult.length}` : 'No response');

    // =====================================
    // TEST 10: Reset Match
    // =====================================
    const resetResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 3000);
        const handler = (update) => {
            if (update.type === 'teams') {
                clearTimeout(timeout);
                socket.off('state_update', handler);
                resolve(update.data);
            }
        };
        socket.on('state_update', handler);
        socket.emit('reset_match');
    });

    if (resetResult) {
        const team1 = resetResult.find(t => t.id === 1);
        const allAlive = team1?.players.every(p => p.status === 'alive');
        log(allAlive ? 'PASS' : 'FAIL', 'Reset Match',
            `Team 1 all alive: ${allAlive}, elims: ${team1?.elims}`);
    } else {
        log('FAIL', 'Reset Match', 'No response');
    }

    // =====================================
    // TEST 11: Chat
    // =====================================
    const chatResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 2000);
        socket.once('receive_chat', (msg) => {
            clearTimeout(timeout);
            resolve(msg);
        });
        socket.emit('send_chat', {
            sender: 'TestUser',
            message: 'Hello from test!',
            timestamp: new Date().toLocaleTimeString()
        });
    });

    log(chatResult?.sender === 'TestUser' ? 'PASS' : 'FAIL', 'Send/Receive Chat',
        chatResult ? `From: ${chatResult.sender}, Msg: ${chatResult.message}` : 'No response');

    // =====================================
    // TEST 12: vMix Info Update (Day/Week)
    // =====================================
    const vmixResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 2000);
        socket.once('vmix_update', (state) => {
            clearTimeout(timeout);
            resolve(state);
        });
        socket.emit('update_vmix_info', { day: '2', week: '3' });
    });

    log(vmixResult?.day === '2' ? 'PASS' : 'FAIL', 'vMix Update Day', `Day: ${vmixResult?.day}`);
    log(vmixResult?.week === '3' ? 'PASS' : 'FAIL', 'vMix Update Week', `Week: ${vmixResult?.week}`);

    // Reset day/week
    socket.emit('update_vmix_info', { day: '1', week: '1' });
    await wait(300);

    // =====================================
    // TEST 13: vMix Map Update
    // =====================================
    const mapResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 2000);
        socket.once('vmix_update', (state) => {
            clearTimeout(timeout);
            resolve(state);
        });
        socket.emit('update_vmix_info', { matches: { 1: { map: 'Miramar' } } });
    });

    log(mapResult?.matches?.[1]?.map === 'Miramar' ? 'PASS' : 'FAIL', 'vMix Map Update',
        `Match 1 Map: ${mapResult?.matches?.[1]?.map}`);

    // Reset map
    socket.emit('update_vmix_info', { matches: { 1: { map: 'Erangel' } } });
    await wait(300);

    // =====================================
    // TEST 14: Timer Control
    // =====================================
    // Set timer
    const timerSetResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 2000);
        socket.once('vmix_update', (state) => {
            clearTimeout(timeout);
            resolve(state);
        });
        socket.emit('control_timer', { command: 'set', minutes: 5, seconds: 30 });
    });

    log(timerSetResult?.timer?.minutes === 5 ? 'PASS' : 'FAIL', 'Timer SET',
        `${timerSetResult?.timer?.minutes}:${timerSetResult?.timer?.seconds}`);

    // Start timer
    const timerStartResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 2000);
        socket.once('vmix_update', (state) => {
            clearTimeout(timeout);
            resolve(state);
        });
        socket.emit('control_timer', { command: 'start' });
    });

    log(timerStartResult?.timer?.isRunning === true ? 'PASS' : 'FAIL', 'Timer START',
        `Running: ${timerStartResult?.timer?.isRunning}`);

    await wait(1500);

    // Check timer tick
    const tickResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 2000);
        socket.once('timer_tick', (tick) => {
            clearTimeout(timeout);
            resolve(tick);
        });
    });

    log(tickResult ? 'PASS' : 'FAIL', 'Timer TICK received',
        tickResult ? `Time: ${tickResult.timeStr}` : 'No tick');

    // Stop timer
    const timerStopResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 2000);
        socket.once('vmix_update', (state) => {
            clearTimeout(timeout);
            resolve(state);
        });
        socket.emit('control_timer', { command: 'stop' });
    });

    log(timerStopResult?.timer?.isRunning === false ? 'PASS' : 'FAIL', 'Timer STOP',
        `Running: ${timerStopResult?.timer?.isRunning}`);

    // =====================================
    // TEST 15: Swap Players API (HTTP)
    // =====================================
    try {
        const swapRes = await httpRequest('POST', '/api/teams/1/swap-players', { index1: 0, index2: 1 });
        log(swapRes.data.success === true ? 'PASS' : 'FAIL', 'HTTP: Swap Players API',
            `Status: ${swapRes.status}, Response: ${JSON.stringify(swapRes.data)}`);

        // Swap back
        await httpRequest('POST', '/api/teams/1/swap-players', { index1: 0, index2: 1 });
    } catch (e) {
        log('FAIL', 'HTTP: Swap Players API', e.message);
    }

    // =====================================
    // TEST 16: Map Randomizer Event
    // =====================================
    const randomizerResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 2000);
        socket.once('start_randomizer', () => {
            clearTimeout(timeout);
            resolve(true);
        });
        socket.emit('start_randomizer');
    });

    log(randomizerResult ? 'PASS' : 'FAIL', 'Map Randomizer Event');

    // =====================================
    // TEST 17: Winner Update with Show/Hide
    // =====================================
    const winnerResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 2000);
        socket.once('vmix_update', (state) => {
            clearTimeout(timeout);
            resolve(state);
        });
        socket.emit('update_vmix_info', {
            matches: { 1: { winner: { id: 1, tag: 'TM1', name: 'Team 1' }, showWinner: true } }
        });
    });

    log(winnerResult?.matches?.[1]?.winner?.tag === 'TM1' ? 'PASS' : 'FAIL', 'vMix Winner Set',
        `Winner: ${winnerResult?.matches?.[1]?.winner?.tag}`);

    // Hide winner
    const hideResult = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 2000);
        socket.once('vmix_update', (state) => {
            clearTimeout(timeout);
            resolve(state);
        });
        socket.emit('update_vmix_info', { matches: { 1: { showWinner: false } } });
    });

    log(hideResult?.matches?.[1]?.showWinner === false ? 'PASS' : 'FAIL', 'vMix Winner Hide');

    // =====================================
    // PRINT SUMMARY
    // =====================================
    console.log('');
    console.log('========================================');
    console.log(`  RESULTS: ${passed} PASSED / ${failed} FAILED`);
    console.log('========================================');
    console.log('');

    if (failed > 0) {
        console.log('❌ FAILED TESTS:');
        results.filter(r => r.includes('[FAIL]')).forEach(r => console.log('  ' + r));
        console.log('');
    }

    socket.disconnect();
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});
