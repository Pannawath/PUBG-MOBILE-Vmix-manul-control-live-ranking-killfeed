import React, { useEffect, useState } from 'react';
import { socket } from '../socket';

function AdminDashboard() {
    const [isConnected, setIsConnected] = useState(socket.connected);
    const [activeTab, setActiveTab] = useState(() => localStorage.getItem('pubg_activeTab') || 'match');
    const [gameState, setGameState] = useState({ teams: [], killfeed: [] });
    const [overlayState, setOverlayState] = useState({ ranking: true, killfeed: true, top4: true });
    const [showDebug, setShowDebug] = useState(false);
    const [debugLogs, setDebugLogs] = useState([]);
    const [pendingKillfeed, setPendingKillfeed] = useState([]);
    const [wipeNotification, setWipeNotification] = useState(null);
    const [isRolling, setIsRolling] = useState(false);
    const [currentMatch, setCurrentMatch] = useState(() => parseInt(localStorage.getItem('pubg_currentMatch') || '1'));
    const [chatHistory, setChatHistory] = useState([]);
    const [serverConfig, setServerConfig] = useState({ numMatches: 3, numTeams: 16, maps: ['Erangel', 'Miramar', 'Sanhok', 'Rondo'], placementPoints: {}, mapBasePath1: '', mapBasePath2: '', logoBasePath: '', vmixHost: '' });
    const [vmixState, setVMixState] = useState({
        day: '1',
        week: '1',
        matches: { 1: { map: 'Erangel', winner: null }, 2: { map: 'Miramar', winner: null }, 3: { map: 'Sanhok', winner: null } },
        timer: { minutes: 10, seconds: 0, isRunning: false }
    });

    useEffect(() => {
        // Fetch initial config from server
        fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/config`)
            .then(r => r.json())
            .then(cfg => setServerConfig(cfg))
            .catch(() => { });

        const addLog = (msg) => {
            const time = new Date().toLocaleTimeString();
            setDebugLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 50));
        };

        function onConnect() {
            setIsConnected(true);
            addLog('✅ Connected to server');
        }
        function onDisconnect() {
            setIsConnected(false);
            addLog('❌ Disconnected from server');
        }

        function onInitState(state) {
            console.log("Init State:", state);
            setGameState(state);
            if (state.pendingKillfeed) setPendingKillfeed(state.pendingKillfeed);
            if (state.activeMatchId) setCurrentMatch(state.activeMatchId);
            if (state.chatHistory) setChatHistory(state.chatHistory);
            addLog(`📥 init_state: ${state.teams?.length || 0} teams (Match ${state.activeMatchId})`);
        }

        function onStateUpdate({ type, data }) {
            setGameState(prev => ({ ...prev, [type]: data }));
            addLog(`📥 state_update: ${type}`);
        }

        function onPendingUpdate(data) {
            setPendingKillfeed(data);
            addLog(`📥 pending_killfeed: ${data.length} items`);
        }

        function onNewKillfeed(item) {
            setGameState(prev => ({
                ...prev,
                killfeed: [...prev.killfeed, item].slice(-50)
            }));
            addLog(`💀 new_killfeed`);
        }

        function onOverlayStateUpdate(state) {
            setOverlayState(state);
            addLog(`👁️ overlay_state: ${JSON.stringify(state)}`);
        }

        function onTeamWiped(data) {
            setWipeNotification(data);
            // Auto hide after 5 seconds
            setTimeout(() => setWipeNotification(null), 5000);
            addLog(`💥 Team Wiped: ${data.teamTag} by ${data.killer}`);
        }

        function onStartRandomizer() {
            setIsRolling(true);
            addLog('🎲 Randomizer Started');
            setTimeout(() => setIsRolling(false), 8000);
        }

        function onConfigUpdate(cfg) {
            setServerConfig(cfg);
        }

        function onMatchChanged(id) {
            setCurrentMatch(id);
            localStorage.setItem('pubg_currentMatch', String(id));
            addLog(`🔄 Match changed to ${id}`);
        }

        function onReceiveChat(msg) {
            setChatHistory(prev => [...prev.slice(-49), msg]);
        }

        function onVMixUpdate(newState) {
            setVMixState(prev => ({ ...prev, ...newState })); // Merge updates
            // addLog(`🎬 vmix_update: Day ${newState.day || '?'} Week ${newState.week || '?'}`);
        }

        function onTimerTick({ m, s }) {
            setVMixState(prev => ({
                ...prev,
                timer: { ...prev.timer, minutes: m, seconds: s, isRunning: true }
            }));
        }

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('init_state', onInitState);
        socket.on('state_update', onStateUpdate);
        socket.on('pending_killfeed_update', onPendingUpdate);
        socket.on('new_killfeed', onNewKillfeed);
        socket.on('overlay_state_update', onOverlayStateUpdate);
        socket.on('team_wiped', onTeamWiped);
        socket.on('start_randomizer', onStartRandomizer);
        socket.on('match_changed', onMatchChanged);
        socket.on('receive_chat', onReceiveChat);
        socket.on('vmix_update', onVMixUpdate);
        socket.on('timer_tick', onTimerTick);
        socket.on('config_update', onConfigUpdate);

        // Force check in case we are already connected
        if (socket.connected) {
            onConnect();
        }

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('init_state', onInitState);
            socket.off('state_update', onStateUpdate);
            socket.off('pending_killfeed_update', onPendingUpdate);
            socket.off('new_killfeed', onNewKillfeed);
            socket.off('overlay_state_update', onOverlayStateUpdate);
            socket.off('team_wiped', onTeamWiped);
            socket.off('start_randomizer', onStartRandomizer);
            socket.off('match_changed', onMatchChanged);
            socket.off('receive_chat', onReceiveChat);
            socket.off('vmix_update', onVMixUpdate);
            socket.off('timer_tick', onTimerTick);
        };
    }, []);

    const [sidebarOpen, setSidebarOpen] = useState(false); // Mobile sidebar toggle, restored

    const toggleOverlay = (type) => {
        socket.emit('toggle_overlay', { type, isVisible: !overlayState[type] });
    };

    const closeAllOverlays = () => {
        socket.emit('close_all_overlays');
    };

    const openOverlay = (path) => {
        window.open(path, '_blank');
    };

    // --- OCR Confirm/Reject Helpers ---
    const confirmKill = (item) => socket.emit('confirm_killfeed', item);
    const rejectKill = (id) => socket.emit('reject_killfeed', id);

    // Keyboard shortcuts for first item
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (pendingKillfeed.length > 0) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmKill(pendingKillfeed[0]);
                } else if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    rejectKill(pendingKillfeed[0].id);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [pendingKillfeed]);

    return (
        <div className="flex flex-col h-screen bg-[#0a0c10] text-[#e2e8f0] font-sans overflow-hidden">
            {/* Team Wipe Notification */}
            {wipeNotification && (
                <div className="fixed top-16 left-1/2 transform -translate-x-1/2 z-50 animate-bounce">
                    <div className="bg-red-600 text-white px-8 py-4 rounded-lg shadow-2xl border-2 border-white flex flex-col items-center">
                        <h2 className="text-2xl font-black uppercase tracking-wider">TEAM WIPE!</h2>
                        <div className="text-lg mt-1">
                            <span className="font-bold text-yellow-300">{wipeNotification.teamTag}</span> eliminated by <span className="font-bold text-yellow-300">{wipeNotification.killer}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Global Top Bar */}
            <div className="h-16 bg-[#111318] border-b border-white/10 flex items-center justify-between px-4 shrink-0 z-20">
                <div className="flex items-center gap-6">
                    {/* Mobile Menu Toggle */}
                    <button
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        className="md:hidden p-2 bg-[#1a1d24] rounded text-gray-300 border border-white/10 hover:bg-white/5"
                    >
                        {sidebarOpen ? '✕' : '☰'}
                    </button>

                    <h1 className="text-2xl font-black text-yellow-500 tracking-tighter hidden md:block">PUBG CONTROL</h1>
                    
                    {/* Global Status Pill */}
                    <div className="hidden md:flex items-center gap-3 text-sm font-bold bg-[#0a0c10] px-4 py-1.5 rounded-full border border-white/5 shadow-inner">
                        <span className="text-gray-500 uppercase tracking-widest text-xs">Match</span>
                        <div className="flex gap-1">
                            {Array.from({ length: serverConfig.numMatches }, (_, i) => i + 1).map(m => (
                                <button
                                    key={m}
                                    onClick={() => socket.emit('change_match', m)}
                                    className={`w-6 h-6 rounded flex items-center justify-center text-xs transition-colors ${currentMatch === m ? 'bg-[#3182ce] text-white shadow-[0_0_8px_rgba(49,130,206,0.5)]' : 'bg-[#1a1d24] text-gray-400 hover:bg-white/10 hover:text-white'}`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                        <div className="w-px h-4 bg-white/10 mx-2"></div>
                        <span className="text-gray-500 uppercase tracking-widest text-xs">Alive Teams</span>
                        <span className="text-[#38a169]">{gameState.teams?.filter(t => t.players?.some(p => p.status === 'alive' || p.status === 'knocked')).length || 0}</span>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setShowDebug(!showDebug)}
                        className={`text-xs px-3 py-1.5 rounded font-bold transition-colors border ${showDebug ? 'bg-[#3182ce] text-white border-[#3182ce]' : 'bg-[#1a1d24] text-gray-400 border-white/10 hover:bg-white/5'}`}
                    >
                        🐞 DEBUG
                    </button>
                    <div className="flex items-center gap-2 bg-[#0a0c10] px-3 py-1.5 rounded-full border border-white/5">
                        <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? "bg-[#38a169] shadow-[0_0_8px_rgba(56,161,105,0.8)]" : "bg-[#e53e3e]"}`}></div>
                        <span className={`text-xs font-bold uppercase ${isConnected ? "text-[#38a169]" : "text-[#e53e3e]"}`}>{isConnected ? 'CONNECTED' : 'OFFLINE'}</span>
                    </div>
                </div>
            </div>

            {/* Main Application Area */}
            <div className="flex flex-1 overflow-hidden relative">
                
                {/* Compact Sidebar */}
                <div className={`${sidebarOpen ? 'flex absolute inset-y-0 left-0 z-30 w-64' : 'hidden'} md:flex flex-col md:w-48 lg:w-56 bg-[#111318] border-r border-white/10 h-full overflow-y-auto transition-all`}>
                    <nav className="flex flex-col py-4 w-full gap-1">
                        {[
                            { id: 'match', label: 'Dashboard', icon: '⚡' },
                            { id: 'teams', label: 'Teams', icon: '🛡️' },
                            { id: 'data', label: 'Data Import', icon: '📂' },
                            { id: 'info', label: 'Team Info', icon: '📋' },
                            { id: 'vmix', label: 'vMix Controls', icon: '🎬', isPro: true },
                            { id: 'vmix-mobile', label: 'vMix Mobile', icon: '📱', isPro: true, isExternal: `http://${window.location.hostname}:${import.meta.env.VITE_VMIX_MOBILE_PORT || '8000'}` },
                            { id: 'config', label: 'Config', icon: '⚙️' },
                        ].map(item => (
                            <button
                                key={item.id}
                                onClick={() => {
                                    if (item.isExternal) {
                                        window.open(item.isExternal, '_blank');
                                        return;
                                    }
                                    setActiveTab(item.id); 
                                    localStorage.setItem('pubg_activeTab', item.id); 
                                    setSidebarOpen(false); 
                                }}
                                className={`flex items-center gap-3 w-full text-left px-4 py-3 transition-colors border-l-4 ${activeTab === item.id 
                                    ? `bg-[#1a1d24] text-white ${item.isPro ? 'border-[#e53e3e]' : 'border-[#3182ce]'}` 
                                    : 'border-transparent text-gray-400 hover:bg-white/5 hover:text-white'}`}
                            >
                                <span className="text-lg">{item.icon}</span>
                                <span className="font-bold text-sm tracking-wide flex-1">{item.label}</span>
                                {item.isExternal && <span className="text-xs text-gray-600">↗</span>}
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Debug Panel overlay/flex-item logic is kept, we will inject it after the sidebar */}
                {showDebug && (
                    <div className="w-80 bg-[#0a0c10] border-r border-white/10 p-4 overflow-auto shrink-0 shadow-lg">
                        <h3 className="text-sm font-bold text-[#3182ce] mb-2">🐞 Debug Logs</h3>
                        <div className="space-y-1 text-[10px] font-mono">
                            {debugLogs.map((log, i) => (
                                <div key={i} className="text-gray-400 border-b border-white/5 py-1">{log}</div>
                            ))}
                            {debugLogs.length === 0 && <div className="text-gray-600">No logs yet...</div>}
                        </div>
                    </div>
                )}


                {/* Main Content Pane */}
                <div className="flex-1 p-4 md:p-6 bg-[#0a0c10] overflow-y-auto relative">
                    {activeTab === 'match' && 
                        <MatchControl 
                            killfeed={gameState.killfeed} 
                            teams={gameState.teams} 
                            isRolling={isRolling} 
                            pendingKillfeed={pendingKillfeed}
                            overlayState={overlayState}
                            toggleOverlay={toggleOverlay}
                            closeAllOverlays={closeAllOverlays}
                            openOverlay={openOverlay}
                            confirmKill={confirmKill}
                            rejectKill={rejectKill}
                        />
                    }
                {activeTab === 'teams' && <TeamsControl teams={gameState.teams} />}
                {activeTab === 'data' && <DataControl />}
                {activeTab === 'info' && <TeamInfoViewer teams={gameState.teams} />}
                {activeTab === 'vmix' && <VMixControl vmix={vmixState} teams={gameState.teams} socket={socket} serverConfig={serverConfig} />}
                {activeTab === 'config' && <ConfigControl serverConfig={serverConfig} />}
                </div>
            </div>

            {/* Floating Chat Widget */}
            <TeamChatWidget history={chatHistory} />
        </div>
    );
}

function TeamChatWidget({ history }) {
    const [isOpen, setIsOpen] = useState(false);
    const [username, setUsername] = useState(localStorage.getItem('chat_username') || '');
    const [message, setMessage] = useState('');
    const [hasUnread, setHasUnread] = useState(false);

    useEffect(() => {
        if (!isOpen && history.length > 0) {
            // Simple check: if last message is new (we could refine this)
            setHasUnread(true);
        }
    }, [history]);

    useEffect(() => {
        if (isOpen) setHasUnread(false);
    }, [isOpen]);

    const handleSend = (e) => {
        e.preventDefault();
        if (!message.trim()) return;
        if (!username.trim()) {
            alert('Please set a name first!');
            return;
        }

        localStorage.setItem('chat_username', username);

        const payload = {
            sender: username,
            message: message,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        socket.emit('send_chat', payload);
        setMessage('');
    };

    // Auto-scroll
    const chatBodyRef = React.useRef(null);
    useEffect(() => {
        if (chatBodyRef.current) {
            chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
        }
    }, [history, isOpen]);

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className={`fixed bottom-4 right-4 p-4 rounded-full shadow-lg transition-transform hover:scale-110 z-50 ${hasUnread ? 'bg-red-600 animate-bounce' : 'bg-blue-600'}`}
            >
                💬
            </button>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 w-80 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl flex flex-col z-50 h-96">
            <div className="bg-gray-800 p-3 rounded-t-lg flex justify-between items-center border-b border-gray-700">
                <h3 className="font-bold text-white">Team Chat</h3>
                <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>

            {/* Chat Body */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-900/95" ref={chatBodyRef}>
                {history.length === 0 && <div className="text-center text-gray-600 text-xs mt-4">No messages yet.</div>}
                {history.map((msg, i) => {
                    const isMe = msg.sender === username;
                    return (
                        <div key={i} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                            <div className={`max-w-[85%] rounded px-3 py-2 text-sm ${isMe ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-200'}`}>
                                {!isMe && <div className="text-[10px] text-gray-400 font-bold mb-1">{msg.sender}</div>}
                                {msg.message}
                            </div>
                            <div className="text-[10px] text-gray-500 mt-1">{msg.timestamp}</div>
                        </div>
                    );
                })}
            </div>

            {/* Input Area */}
            <div className="p-3 bg-gray-800 rounded-b-lg border-t border-gray-700">
                {!username ? (
                    <div className="flex gap-2">
                        <input
                            className="flex-1 bg-gray-700 rounded px-2 py-1 text-sm outline-none focus:ring-1 ring-blue-500"
                            placeholder="Your Name..."
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                        <button onClick={() => { if (username) localStorage.setItem('chat_username', username); }} className="bg-green-600 px-3 py-1 rounded text-sm font-bold">Set</button>
                    </div>
                ) : (
                    <form onSubmit={handleSend} className="flex gap-2">
                        <input
                            className="flex-1 bg-gray-700 rounded px-2 py-1 text-sm outline-none focus:ring-1 ring-blue-500"
                            placeholder="Type a message..."
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                        />
                        <button type="submit" className="bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded text-sm">➤</button>
                    </form>
                )}
            </div>
        </div>
    );
}


function MatchControl({ killfeed, teams, isRolling, pendingKillfeed, overlayState, toggleOverlay, closeAllOverlays, openOverlay, confirmKill, rejectKill }) {
    const [killer, setKiller] = useState('');
    const [victim, setVictim] = useState('');

    const handlePush = (e) => {
        e.preventDefault();
        if (!killer || !victim) return;

        // Helper to parse "[TAG] PlayerName" -> { teamId, playerIdx, name }
        const parsePlayer = (str) => {
            const match = str.match(/^\[(.*?)\]\s*(.*)$/);
            if (!match) return null;

            const tag = match[1];
            const name = match[2];

            const team = teams.find(t => t.tag === tag);
            if (!team) return { name: str, teamId: null, playerIdx: null };

            // Find player by name, using correct index
            const pIdx = team.players.findIndex((p, idx) => {
                const playerName = p.name || `Player ${idx + 1}`;
                return playerName === name;
            });

            return {
                teamId: team.id,
                playerIdx: pIdx !== -1 ? pIdx : null,
                name: name
            };
        };

        const killerData = parsePlayer(killer) || { name: killer };
        const victimData = parsePlayer(victim) || { name: victim };

        // Push to killfeed (Server handles status update)
        socket.emit('push_killfeed', { killer: killerData, victim: victimData });

        // NOTE: Score is NOT auto-incremented on Knock. 
        // Admin must manually increment score or mark as Dead if needed.

        setVictim(''); // Keep killer for potential multi-kill
    };

    const handleClear = () => {
        if (confirm('Clear Killfeed?')) socket.emit('clear_killfeed');
    };

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            
            {/* Top Row: Overlay Quick Actions */}
            <div className="bg-[#111318] p-4 rounded-xl border border-white/10 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-4">
                    <span className="text-gray-500 font-bold uppercase text-xs tracking-widest hidden md:inline">Overlays</span>
                    <div className="flex gap-2">
                        {['ranking', 'killfeed', 'top4'].map(type => (
                            <button
                                key={type}
                                onClick={() => toggleOverlay(type)}
                                className={`px-5 py-2.5 rounded-lg font-bold transition-all border outline-none flex flex-col items-center justify-center min-w-[110px] active:scale-95 ${overlayState[type] ? 'bg-[#e53e3e] border-red-500 text-white shadow-[0_0_15px_rgba(229,62,62,0.4)]' : 'bg-[#1a1d24] border-white/5 text-gray-400 hover:bg-white/5'}`}
                            >
                                <span className="uppercase text-sm tracking-wide leading-none mb-1">{type}</span>
                                <span className={`text-[9px] px-2 py-0.5 rounded-sm font-mono leading-none ${overlayState[type] ? 'bg-black/30 text-white' : 'bg-transparent text-gray-500'}`}>{overlayState[type] ? 'ON AIR' : 'OFF'}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={() => window.open('/random-map/index.html', '_blank')} className="bg-[#1a1d24] hover:bg-white/10 text-gray-300 px-4 py-2 rounded text-xs font-bold border border-white/10 transition-colors">MAP ↗</button>
                    {['ranking', 'killfeed', 'top4'].map(type => (
                        <button key={`open-${type}`} onClick={() => openOverlay(`/overlay/${type}`)} className="hidden md:inline bg-[#1a1d24] hover:bg-white/10 text-gray-400 px-3 py-2 rounded text-[10px] font-bold border border-white/10 uppercase transition-colors">{type} ↗</button>
                    ))}
                    <div className="w-px h-6 bg-white/10 mx-2"></div>
                    <button onClick={closeAllOverlays} className="text-[#e53e3e] hover:bg-red-900/30 px-4 py-2 rounded text-xs font-bold border border-red-900/50 transition-colors">CUT ALL</button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* Left Column: Actions */}
                <div className="lg:col-span-4 space-y-6">
                    
                    {/* Manual Entry */}
                    <div className="bg-[#111318] p-5 rounded-xl border border-white/10 shadow-lg">
                        <div className="flex justify-between items-center mb-4 border-b border-white/10 pb-2">
                            <h3 className="text-lg font-bold text-gray-300">New Feed Entry</h3>
                        </div>

                        <form onSubmit={handlePush} className="space-y-4">
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-[#3182ce] mb-1 font-bold">Killer (Source)</label>
                                <input
                                    list="players-list"
                                    value={killer}
                                    onChange={(e) => setKiller(e.target.value)}
                                    className="w-full bg-[#0a0c10] border border-white/10 rounded p-3 text-sm focus:border-[#3182ce] focus:outline-none transition-colors"
                                    placeholder="e.g. [DAY] mapayer"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-[#e53e3e] mb-1 font-bold">Victim (Target)</label>
                                <input
                                    list="players-list"
                                    value={victim}
                                    onChange={(e) => setVictim(e.target.value)}
                                    className="w-full bg-[#0a0c10] border border-white/10 rounded p-3 text-sm focus:border-[#e53e3e] focus:outline-none transition-colors"
                                    placeholder="e.g. [BRU] ConK"
                                />
                            </div>
                            <button type="submit" className="w-full bg-[#1a1d24] hover:bg-white/10 border border-white/10 text-white font-bold py-3 rounded transition-all tracking-widest text-sm mt-2 active:scale-95">
                                SUBMIT (PENDING)
                            </button>
                        </form>

                        <datalist id="players-list">
                            {teams.map(t => (
                                <React.Fragment key={t.id}>
                                    {(t.players || []).slice(0, 4).map((p, idx) => (
                                        <option key={`${t.id}-${idx}`} value={`[${t.tag}] ${p.name || `Player ${idx + 1}`}`} />
                                    ))}
                                </React.Fragment>
                            ))}
                        </datalist>
                    </div>

                    {/* Map Randomizer */}
                    <div className="bg-[#111318] p-5 rounded-xl border border-white/10 shadow-lg">
                        <h3 className="text-lg font-bold text-gray-300 mb-4 border-b border-white/10 pb-2">Map Randomizer</h3>
                        <button
                            onClick={() => socket.emit('start_randomizer')}
                            disabled={isRolling}
                            className={`w-full bg-[#3182ce] hover:bg-blue-500 text-white font-bold py-4 rounded shadow-lg flex items-center justify-center gap-3 transition-colors ${isRolling ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'}`}
                        >
                            <span className="text-xl">🎲</span>
                            <span className="tracking-widest">{isRolling ? 'ROLLING...' : 'ROLL RANDOM MAP'}</span>
                        </button>
                    </div>

                </div>

                {/* Right Column: Live Data */}
                <div className="lg:col-span-8 space-y-6 flex flex-col">
                    
                    {/* Pending Actions (High Priority) */}
                    {pendingKillfeed.length > 0 && (
                        <div className="bg-[#111318] border border-[#e53e3e] shadow-[0_0_15px_rgba(229,62,62,0.2)] rounded-xl overflow-hidden flex flex-col">
                            <div className="bg-[#e53e3e]/20 px-4 py-2 border-b border-[#e53e3e]/30 flex justify-between items-center">
                                <span className="font-bold text-[#e53e3e] text-sm tracking-widest flex items-center gap-2">
                                    <span className="animate-pulse">🔴</span> ACTION REQUIRED ({pendingKillfeed.length})
                                </span>
                                <span className="text-[10px] text-gray-400 font-mono">HOTKEYS: ENTER = AUTO, DEL = CUT</span>
                            </div>
                            
                            <div className="max-h-[300px] overflow-y-auto p-2 space-y-2">
                                {pendingKillfeed.map((item, idx) => (
                                    <div key={item.id} className={`flex flex-col md:flex-row items-center justify-between bg-[#0a0c10] p-3 rounded border transition-colors ${idx === 0 ? 'border-[#3182ce]' : 'border-white/5 opacity-70'}`}>
                                        <div className="flex items-center gap-3 w-full md:w-auto overflow-hidden">
                                            <div className="flex flex-col items-end w-24 md:w-32 shrink-0">
                                                {item.matchedKiller && <span className="text-[9px] text-[#3182ce] font-bold">{item.matchedKiller.teamTag}</span>}
                                                <span className="text-sm font-bold text-gray-200 truncate w-full text-right">{typeof item.killer === 'object' ? item.killer.name : item.killer}</span>
                                            </div>
                                            
                                            <div className="shrink-0 flex flex-col items-center px-2">
                                                <span className={`text-[10px] font-black tracking-wider px-2 py-0.5 rounded ${item.action === 'knocked' ? 'bg-orange-500/20 text-orange-500' : 'bg-red-500/20 text-red-500'}`}>
                                                    {item.action === 'knocked' ? 'KNOCKED' : 'KILLED'}
                                                </span>
                                            </div>

                                            <div className="flex flex-col items-start w-24 md:w-32 shrink-0">
                                                {item.matchedVictim && <span className="text-[9px] text-[#e53e3e] font-bold">{item.matchedVictim.teamTag}</span>}
                                                <span className="text-sm font-bold text-gray-200 truncate w-full text-left">{typeof item.victim === 'object' ? item.victim.name : item.victim}</span>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 shrink-0 mt-3 md:mt-0">
                                            <button onClick={() => confirmKill(item)} className={`px-4 py-2 rounded font-bold text-xs tracking-wider transition-all shadow-md active:scale-95 ${idx === 0 ? 'bg-[#38a169] hover:bg-green-500 text-white' : 'bg-[#1a1d24] text-gray-400 hover:text-white border border-white/10'}`}>AUTO</button>
                                            <button onClick={() => rejectKill(item.id)} className={`px-4 py-2 rounded font-bold text-xs tracking-wider transition-all shadow-md active:scale-95 ${idx === 0 ? 'bg-red-900 hover:bg-red-700 text-white' : 'bg-[#1a1d24] text-gray-400 hover:text-white border border-white/10'}`}>CUT</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Live Feed History */}
                    <div className="bg-[#111318] rounded-xl border border-white/10 shadow-lg flex-1 overflow-hidden flex flex-col min-h-[400px]">
                        <div className="px-5 py-3 border-b border-white/10 flex justify-between items-center bg-[#0a0c10]">
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Feed History</h3>
                            <button onClick={handleClear} className="text-[10px] font-bold text-gray-500 hover:text-red-400 uppercase tracking-widest transition-colors">Clear History</button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-1.5 font-mono text-sm bg-black/40">
                            {killfeed.slice().reverse().map((k) => (
                                <div key={k.id || Math.random()} className="flex items-center gap-3 py-1.5 border-b border-white/5 hover:bg-white/5 px-2 rounded transition-colors group">
                                    <div className="text-gray-500 text-[10px] w-12 shrink-0 group-hover:text-gray-400 transition-colors">
                                        {new Date(k.timestamp || Date.now()).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second:'2-digit' })}
                                    </div>
                                    <div className="flex-1 text-right text-gray-300 truncate">
                                        {typeof k.killer === 'object' ? `[${teams.find(t => t.id === k.killer.teamId)?.tag || '?'}] ${k.killer.name}` : k.killer}
                                    </div>
                                    <div className="text-gray-600 font-bold shrink-0 w-8 text-center">→</div>
                                    <div className="flex-1 text-left text-gray-300 truncate opacity-75 group-hover:opacity-100 transition-opacity">
                                        {typeof k.victim === 'object' ? `[${teams.find(t => t.id === k.victim.teamId)?.tag || '?'}] ${k.victim.name}` : k.victim}
                                    </div>
                                </div>
                            ))}
                            {killfeed.length === 0 && <div className="text-center text-gray-600 mt-10 text-xs">NO FEED DATA ._</div>}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}

function TeamsControl({ teams }) {
    const [editingTeamId, setEditingTeamId] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    // Filter Logic
    const filteredTeams = teams.filter(team => {
        const lowerSearch = searchTerm.toLowerCase();
        return (
            team.tag.toLowerCase().includes(lowerSearch) ||
            team.name.toLowerCase().includes(lowerSearch) ||
            team.players.some(p => (p.name || '').toLowerCase().includes(lowerSearch))
        );
    });

    // Status Mode Functions
    const cyclePlayerStatus = (teamId, playerIndex) => {
        const statusOrder = ['alive', 'knocked', 'dead'];
        const team = teams.find(t => t.id === teamId);
        if (!team || !team.players) return;

        const currentStatus = team.players[playerIndex]?.status || 'alive';
        const currentIdx = statusOrder.indexOf(currentStatus);
        const nextStatus = statusOrder[(currentIdx + 1) % 3];

        socket.emit('update_player_status', { teamId, playerIndex, status: nextStatus });
    };

    const handleScoreUpdate = (id, field, value) => {
        const newTeams = teams.map(t => {
            if (t.id === id) {
                return { ...t, [field]: Number(value) };
            }
            return t;
        });
        socket.emit('update_teams', newTeams);
    };

    const resetMatch = () => {
        if (confirm('Reset all STATUS to alive and SCORES to 0? (Names will remain)')) {
            socket.emit('reset_match');
        }
    };

    // Settings Mode Functions
    const handleInfoUpdate = (id, field, value, playerIndex = null) => {
        const newTeams = teams.map(t => {
            if (t.id === id) {
                if (playerIndex !== null) {
                    // Update Player Name
                    const newPlayers = [...t.players];
                    newPlayers[playerIndex] = { ...newPlayers[playerIndex], name: value };
                    return { ...t, players: newPlayers };
                } else {
                    // Update Team Info
                    return { ...t, [field]: value };
                }
            }
            return t;
        });
        socket.emit('update_teams', newTeams);
    };

    const isTeamAlive = (team) => {
        const players = team.players || [];
        return players.some(p => p.status === 'alive' || p.status === 'knocked');
    };

    return (
        <div className="max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <div className="flex gap-4 items-center">
                    <h2 className="text-3xl font-bold">Teams Management</h2>

                    {/* Search Input */}
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Search Team or Player..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="bg-[#111318] text-sm rounded-full px-4 py-2 w-64 border border-white/10 focus:border-[#3182ce] outline-none pl-10 transition-colors"
                        />
                        <svg className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {editingTeamId && (
                        <button onClick={() => setEditingTeamId(null)} className="text-sm bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg font-bold transition-colors shadow-lg">
                            Done Editing
                        </button>
                    )}
                    <button
                        onClick={resetMatch}
                        className="bg-red-900 border border-red-500/50 hover:bg-red-700 text-white px-6 py-2 rounded-lg font-bold transition-colors shadow-lg tracking-wide uppercase text-sm"
                    >
                        Reset Match
                    </button>
                </div>
            </div>

            <div className="bg-[#111318] rounded-xl border border-white/10 shadow-lg overflow-hidden">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-[#0a0c10] text-gray-400 text-[10px] tracking-widest uppercase border-b border-white/10">
                        <tr>
                            <th className="p-3 w-12 text-center border-r border-white/5">ID</th>
                            <th className="p-3">Team Info</th>
                            <th className="p-3 w-32">Status (Click)</th>
                            <th className="p-3 w-20 text-center text-[#3182ce]">Plcm Pts</th>
                            <th className="p-3 w-20 text-center text-[#e53e3e]">Elims</th>
                            <th className="p-3 w-20 text-center text-yellow-500">WWCD</th>
                            <th className="p-3 w-24 text-center border-l border-white/5">Total</th>
                            <th className="p-3 w-20 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {filteredTeams.map(team => {
                            const players = team.players || Array(4).fill({ name: '', status: 'alive' });
                            const teamAlive = isTeamAlive(team);
                            const isEditing = editingTeamId === team.id;

                            return (
                                <tr key={team.id} className={`transition-colors text-sm ${teamAlive ? 'hover:bg-white/5' : 'opacity-60 bg-black/40'} ${isEditing ? 'bg-blue-900/10' : ''}`}>
                                    <td className="p-3 text-gray-500 font-mono text-center border-r border-white/5 text-xs">{team.id}</td>

                                    {isEditing ? (
                                        <td colSpan={7} className="p-4 border-l-2 border-[#3182ce]">
                                            <div className="flex flex-col gap-4">
                                                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                                                    <div className="md:col-span-1">
                                                        <label className="text-[9px] text-gray-500 uppercase tracking-widest block mb-1 font-bold">Tag</label>
                                                        <input value={team.tag} onChange={e => handleInfoUpdate(team.id, 'tag', e.target.value)} className="w-full bg-[#0a0c10] border border-white/10 rounded px-3 py-2 text-sm focus:border-[#3182ce] outline-none transition-colors" />
                                                    </div>
                                                    <div className="md:col-span-2">
                                                        <label className="text-[9px] text-gray-500 uppercase tracking-widest block mb-1 font-bold">Team Name</label>
                                                        <input value={team.name} onChange={e => handleInfoUpdate(team.id, 'name', e.target.value)} className="w-full bg-[#0a0c10] border border-white/10 rounded px-3 py-2 text-sm focus:border-[#3182ce] outline-none transition-colors" />
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                    {[0, 1, 2, 3].map(idx => (
                                                        <div key={idx}>
                                                            <label className="text-[9px] text-gray-500 uppercase tracking-widest block mb-1 font-bold">Player {idx + 1}</label>
                                                            <input value={players[idx]?.name || ''} onChange={e => handleInfoUpdate(team.id, 'player', e.target.value, idx)} placeholder={`P${idx + 1}`} className="w-full bg-[#0a0c10] border border-white/10 rounded px-3 py-2 text-sm focus:border-[#3182ce] outline-none transition-colors" />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </td>
                                    ) : (
                                        <>
                                            {/* Read-Only Status Cells */}
                                            <td className="p-3 font-bold truncate max-w-[200px]">
                                                <span className="text-[#3182ce] font-mono text-[10px] mr-2 border border-[#3182ce]/30 bg-[#3182ce]/10 px-1.5 py-0.5 rounded align-middle">[{team.tag}]</span>
                                                <span className="align-middle text-gray-200">{team.name}</span>
                                            </td>

                                            <td className="p-3">
                                                <div className="flex gap-1.5">
                                                    {players.slice(0, 4).map((player, idx) => {
                                                        let bgColor, icon;
                                                        if (player.status === 'alive') { bgColor = 'bg-[#38a169] text-white shadow-[0_0_8px_rgba(56,161,105,0.3)]'; icon = '✓'; }
                                                        else if (player.status === 'knocked') { bgColor = 'bg-[#e53e3e] text-white shadow-[0_0_8px_rgba(229,62,62,0.3)]'; icon = '!!'; }
                                                        else { bgColor = 'bg-transparent border border-white/10 text-gray-600'; icon = '✕'; }

                                                        return (
                                                            <button
                                                                key={idx}
                                                                onClick={() => cyclePlayerStatus(team.id, idx)}
                                                                className={`w-6 h-6 text-[10px] rounded flex items-center justify-center font-bold transition-all hover:scale-110 active:scale-95 ${bgColor}`}
                                                                title={`${player.name || `Player ${idx + 1}`} (${player.status})`}
                                                            >
                                                                {icon}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </td>

                                            <td className="p-3 w-20">
                                                <input
                                                    type="number"
                                                    value={team.placement || 0}
                                                    onChange={e => handleScoreUpdate(team.id, 'placement', e.target.value)}
                                                    className="bg-black/20 border border-white/5 hover:border-[#3182ce]/50 focus:border-[#3182ce] focus:bg-[#0a0c10] rounded p-1 w-full text-center outline-none transition-colors font-mono text-sm"
                                                />
                                            </td>

                                            <td className="p-3 w-20">
                                                <input
                                                    type="number"
                                                    value={team.elims || 0}
                                                    onChange={e => handleScoreUpdate(team.id, 'elims', e.target.value)}
                                                    className="bg-[#e53e3e]/5 border border-[#e53e3e]/20 hover:border-[#e53e3e]/50 focus:border-[#e53e3e] focus:bg-[#0a0c10] rounded p-1 w-full text-center outline-none transition-colors font-mono text-sm text-[#e53e3e]"
                                                />
                                            </td>

                                            <td className="p-3 w-20">
                                                <input
                                                    type="number"
                                                    value={team.wwcd || 0}
                                                    onChange={e => handleScoreUpdate(team.id, 'wwcd', e.target.value)}
                                                    className="bg-yellow-500/5 border border-yellow-500/20 hover:border-yellow-500/50 focus:border-yellow-500 focus:bg-[#0a0c10] rounded p-1 w-full text-center outline-none transition-colors font-mono text-sm text-yellow-500"
                                                />
                                            </td>

                                            <td className="p-3 text-center font-black text-yellow-500 text-lg border-l border-white/5 bg-black/20 w-24">
                                                {(team.placement || 0) + (team.elims || 0)}
                                            </td>

                                            <td className="p-3 text-right">
                                                <button onClick={() => setEditingTeamId(team.id)} className="text-gray-500 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded text-[10px] font-bold tracking-widest transition-colors border border-white/5">EDIT</button>
                                            </td>
                                        </>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}


function DataControl() {
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState(null);

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
        setMessage(null);
    };

    const handleUpload = async () => {
        if (!file) {
            setMessage({ type: 'error', text: 'Please select a file first' });
            return;
        }
        setUploading(true);
        setMessage(null);

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/import-teams`, {
                method: 'POST',
                body: formData
            });
            const data = await res.json();

            if (data.success) {
                setMessage({ type: 'success', text: `✅ Imported ${data.count} teams successfully!` });
                setFile(null);
            } else {
                setMessage({ type: 'error', text: `❌ Error: ${data.message}` });
            }
        } catch (e) {
            setMessage({ type: 'error', text: `❌ Upload Failed: ${e.message}` });
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold mb-8">Data Management</h2>

            <div className="bg-[#111318] p-8 rounded-xl border border-white/10 shadow-lg">
                <h3 className="text-xl font-bold text-[#3182ce] mb-6 flex items-center gap-2">
                    <span>📂</span> Import Team Data
                </h3>

                <div className="mb-6 text-gray-400 text-sm">
                    <p>Upload an Excel file (.xlsx, .xls) containing the team registration data.</p>
                    <p className="mt-2">Supported Columns (Auto-detected):</p>
                    <ul className="list-disc list-inside mt-1 ml-2 space-y-1">
                        <li>Team Name (ชื่อทีม)</li>
                        <li>Team Tag (ชื่อย่อทีม)</li>
                        <li>Team Flag (ธงทีม)</li>
                        <li>Player IGNs (ชื่อในเกม)</li>
                    </ul>
                </div>

                <div className="flex flex-col md:flex-row gap-4 items-center border-2 border-dashed border-white/20 rounded-xl p-8 hover:border-[#3182ce] transition-colors bg-[#0a0c10]/50">
                    <input
                        type="file"
                        accept=".xlsx, .xls"
                        onChange={handleFileChange}
                        className="block w-full text-sm text-gray-400
                            file:mr-4 file:py-2 file:px-4
                            file:rounded-full file:border-0
                            file:text-sm file:font-semibold
                            file:bg-[#3182ce] file:text-white
                            hover:file:bg-blue-500
                            cursor-pointer transition-colors"
                    />

                    <button
                        onClick={handleUpload}
                        disabled={!file || uploading}
                        className={`w-full md:w-auto px-8 py-2 rounded-lg font-bold text-white shadow-lg transition-all
                            ${!file || uploading
                                ? 'bg-[#1a1d24] text-gray-400 cursor-not-allowed border border-white/10'
                                : 'bg-[#3182ce] hover:bg-blue-500 shadow-[0_0_15px_rgba(49,130,206,0.5)] transform hover:scale-105 active:scale-95'
                            }`}
                    >
                        {uploading ? (
                            <span className="flex items-center gap-2">
                                <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Importing...
                            </span>
                        ) : 'Import Data'}
                    </button>
                </div>

                {message && (
                    <div className={`mt-6 p-4 rounded-lg border flex items-center gap-3 animate-fade-in ${message.type === 'success'
                        ? 'bg-green-900/30 border-green-500/50 text-green-400'
                        : 'bg-red-900/30 border-red-500/50 text-red-400'
                        }`}>
                        <span className="text-xl">{message.type === 'success' ? '✅' : '⚠️'}</span>
                        <span className="font-bold">{message.text}</span>
                    </div>
                )}
            </div>
        </div>
    );
}

function TeamInfoViewer({ teams }) {
    const [selectedTeamId, setSelectedTeamId] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [swapSourceIndex, setSwapSourceIndex] = useState(null);

    const filteredTeams = teams.filter(t =>
        t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.tag.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const selectedTeam = teams.find(t => t.id === selectedTeamId);

    const handleSwapClick = async (index) => {
        if (swapSourceIndex === null) {
            // Select first player
            setSwapSourceIndex(index);
        } else {
            // Swap with second player
            if (swapSourceIndex === index) {
                // Cancel
                setSwapSourceIndex(null);
                return;
            }

            // Call API
            try {
                await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/teams/${selectedTeamId}/swap-players`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ index1: swapSourceIndex, index2: index })
                });
                // Reset
                setSwapSourceIndex(null);
            } catch (e) {
                alert("Swap failed");
            }
        }
    };

    return (
        <div className="h-full flex flex-col md:flex-row gap-4 overflow-hidden">
            {/* List Panel */}
            <div className="w-full md:w-1/3 bg-[#111318] rounded-xl border border-white/10 flex flex-col overflow-hidden">
                <div className="p-4 border-b border-white/5 bg-[#0a0c10]">
                    <h3 className="text-xl font-bold text-yellow-500 mb-2">Teams List</h3>
                    <input
                        type="text"
                        placeholder="Search teams..."
                        className="w-full bg-[#111318] text-[#e2e8f0] rounded px-3 py-2 border border-white/10 focus:border-[#3182ce] outline-none transition-colors"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {filteredTeams.map(team => (
                        <button
                            key={team.id}
                            onClick={() => setSelectedTeamId(team.id)}
                            className={`w-full text-left p-3 rounded-lg flex items-center gap-3 transition-all ${selectedTeamId === team.id ? 'bg-[#3182ce] text-white font-bold shadow-md' : 'bg-[#1a1d24] hover:bg-white/5 text-gray-300'}`}
                        >
                            <span className="bg-black/20 px-2 py-1 rounded text-xs font-mono w-12 text-center">{team.tag}</span>
                            <span className="truncate flex-1">{team.name}</span>
                        </button>
                    ))}
                    {filteredTeams.length === 0 && <div className="text-center text-gray-500 p-4">No teams found</div>}
                </div>
            </div>

            {/* Detail Panel */}
            <div className="flex-1 bg-[#111318] rounded-xl border border-white/10 p-8 overflow-y-auto shadow-lg">
                {selectedTeam ? (
                    <div className="space-y-8 animate-fade-in relative">
                        {/* Edit Button */}
                        <div className="absolute top-0 right-0">
                            <button
                                onClick={() => {
                                    const newData = prompt("Paste full JSON to update (Advanced) or Use UI (Just kidding, UI coming later)");
                                    if (newData) alert("Use the backend to update!");
                                }}
                                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm hidden"
                            >
                                Edit Data
                            </button>
                        </div>

                        {/* Header */}
                        <div className="flex items-start justify-between border-b border-gray-700 pb-6">
                            <div>
                                <h1 className="text-4xl font-black text-white mb-2">{selectedTeam.name}</h1>
                                <div className="text-2xl font-bold text-yellow-500 flex items-center gap-3">
                                    <span className="bg-yellow-900/30 px-3 py-1 rounded border border-yellow-500">{selectedTeam.tag}</span>
                                    {selectedTeam.flag && <span className="text-sm px-2 text-gray-400">Has Flag URL</span>}
                                </div>
                            </div>
                            <div className="bg-[#0a0c10] border border-white/5 p-4 rounded-lg text-center min-w-[100px]">
                                <div className="text-gray-400 text-xs uppercase mb-1">Team ID</div>
                                <div className="text-3xl font-mono font-bold">{selectedTeam.id}</div>
                            </div>
                        </div>

                        {/* Leader & Contact Info */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-[#0a0c10]/50 p-6 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                                <h3 className="text-lg font-bold text-blue-400 mb-4 flex items-center gap-2">
                                    <span>👤</span> Leader Information
                                </h3>
                                <div className="space-y-3">
                                    <InfoRow label="Name" value={selectedTeam.extra?.leaderName} />
                                    <InfoRow label="Class/Room" value={selectedTeam.extra?.classRoom} />
                                    <InfoRow label="Phone" value={selectedTeam.extra?.phone} />
                                </div>
                            </div>

                            <div className="bg-[#0a0c10]/50 p-6 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                                <h3 className="text-lg font-bold text-purple-400 mb-4 flex items-center gap-2">
                                    <span>🔗</span> Social & Verification
                                </h3>
                                <div className="space-y-3">
                                    <InfoRow label="Discord" value={selectedTeam.extra?.discord} />
                                    <div className="flex flex-col">
                                        <span className="text-xs text-gray-500 uppercase font-bold">Student Proof</span>
                                        {selectedTeam.extra?.proof ? (
                                            <a
                                                href={selectedTeam.extra.proof}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-blue-400 hover:underline truncate"
                                            >
                                                {selectedTeam.extra.proof}
                                            </a>
                                        ) : (
                                            <span className="text-gray-600 italic">Not provided</span>
                                        )}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-xs text-gray-500 uppercase font-bold">Team Flag URL</span>
                                        {selectedTeam.flag ? (
                                            <a
                                                href={selectedTeam.flag}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-blue-400 hover:underline truncate"
                                            >
                                                {selectedTeam.flag}
                                            </a>
                                        ) : (
                                            <span className="text-gray-600 italic">Not provided</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Active Roster */}
                        <div>
                            <h3 className="text-xl font-bold text-gray-300 mb-4">Active Roster</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                {(selectedTeam.players || []).slice(0, 4).map((p, i) => (
                                    <div key={i} className="bg-[#0a0c10] p-4 rounded-lg border border-white/5 hover:border-[#3182ce] transition-colors group relative overflow-hidden">

                                        <div className="absolute top-0 right-0 p-2 flex gap-2">
                                            <button
                                                onClick={() => handleSwapClick(i)}
                                                className={`text-xs px-2 py-0.5 rounded font-bold uppercase transition-colors ${swapSourceIndex === i
                                                    ? 'bg-yellow-500 text-black animate-pulse'
                                                    : swapSourceIndex !== null
                                                        ? 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                                                        : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                                                    }`}
                                            >
                                                {swapSourceIndex === i ? 'Selected' : swapSourceIndex !== null ? 'Swap Here' : 'Swap'}
                                            </button>

                                            <div className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${p.status === 'alive' ? 'bg-green-900 text-green-400' :
                                                p.status === 'knocked' ? 'bg-orange-900 text-orange-400' :
                                                    'bg-red-900 text-red-400'
                                                }`}>
                                                {p.status}
                                            </div>
                                        </div>

                                        <div className="text-xs font-bold uppercase mb-2 text-blue-400">
                                            Player {i + 1}
                                        </div>

                                        <div className="mb-3">
                                            <div className="text-xs text-gray-500 uppercase">IGN</div>
                                            <div className="font-bold text-lg text-white truncate" title={p.name}>{p.name}</div>
                                        </div>

                                        <div className="space-y-2 text-sm text-gray-300">
                                            <div>
                                                <span className="text-gray-600 block text-xs uppercase">Name</span>
                                                <span className="font-medium truncate block" title={p.realName}>{p.realName || '-'}</span>
                                            </div>
                                            <div>
                                                <span className="text-gray-600 block text-xs uppercase">Class</span>
                                                <span>{p.classRoom || '-'}</span>
                                            </div>
                                            <div>
                                                <span className="text-gray-600 block text-xs uppercase">UID</span>
                                                <span className="font-mono text-xs bg-black/30 px-1 rounded">{p.uid || '-'}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Reserve Player (Player 5) */}
                        {(selectedTeam.players || []).length > 4 && (() => {
                            const p = selectedTeam.players[4];
                            return (
                                <div className="mt-6">
                                    <h3 className="text-lg font-bold text-amber-400 mb-3 flex items-center gap-2">
                                        <span>🔄</span> Reserve (Sub)
                                    </h3>
                                    <div className="max-w-sm">
                                        <div className="bg-amber-950/30 p-4 rounded-lg border-2 border-dashed border-amber-600/50 hover:border-amber-500 transition-colors relative overflow-hidden">

                                            <div className="absolute top-0 right-0 p-2 flex gap-2">
                                                <button
                                                    onClick={() => handleSwapClick(4)}
                                                    className={`text-xs px-2 py-0.5 rounded font-bold uppercase transition-colors ${swapSourceIndex === 4
                                                        ? 'bg-yellow-500 text-black animate-pulse'
                                                        : swapSourceIndex !== null
                                                            ? 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                                                            : 'bg-amber-700 hover:bg-amber-600 text-amber-200'
                                                        }`}
                                                >
                                                    {swapSourceIndex === 4 ? 'Selected' : swapSourceIndex !== null ? 'Swap Here' : 'Swap'}
                                                </button>

                                                <div className="text-xs px-2 py-0.5 rounded font-bold uppercase bg-amber-900/60 text-amber-400">
                                                    reserve
                                                </div>
                                            </div>

                                            <div className="text-xs font-bold uppercase mb-2 text-amber-400">
                                                Player 5 — Reserve
                                            </div>

                                            <div className="mb-3">
                                                <div className="text-xs text-amber-600 uppercase">IGN</div>
                                                <div className="font-bold text-lg text-amber-200 truncate" title={p.name}>{p.name}</div>
                                            </div>

                                            <div className="space-y-2 text-sm text-amber-300/80">
                                                <div>
                                                    <span className="text-amber-600 block text-xs uppercase">Name</span>
                                                    <span className="font-medium truncate block" title={p.realName}>{p.realName || '-'}</span>
                                                </div>
                                                <div>
                                                    <span className="text-amber-600 block text-xs uppercase">Class</span>
                                                    <span>{p.classRoom || '-'}</span>
                                                </div>
                                                <div>
                                                    <span className="text-amber-600 block text-xs uppercase">UID</span>
                                                    <span className="font-mono text-xs bg-black/30 px-1 rounded">{p.uid || '-'}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}

                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-500">
                        <div className="text-6xl mb-4">👈</div>
                        <div className="text-xl">Select a team from the list to view details</div>
                    </div>
                )}
            </div>
        </div>
    );
}

function InfoRow({ label, value }) {
    return (
        <div className="flex flex-col">
            <span className="text-xs text-gray-500 uppercase font-bold">{label}</span>
            <span className="text-white font-medium">{value || '-'}</span>
        </div>
    );
}

function VMixControl({ vmix, teams, socket, serverConfig }) {
    // Local state for timer input (to avoid jitter if updating from server every sec)
    const [timerMin, setTimerMin] = useState(vmix.timer?.minutes || 10);
    const [timerSec, setTimerSec] = useState(vmix.timer?.seconds || 0);

    // Local state for Day/Week (Optimistic UI)
    const [localDay, setLocalDay] = useState(vmix.day || '');
    const [localWeek, setLocalWeek] = useState(vmix.week || '');

    // Sync state when server updates (unless we are just typing? For now simply sync)
    // To avoid overwriting user while typing, we can check if values differ significantly or rely on socket speed.
    // For simplicity, we sync if specific prop changes.
    useEffect(() => {
        if (vmix.timer) {
            setTimerMin(vmix.timer.minutes);
            setTimerSec(vmix.timer.seconds);
        }
    }, [vmix.timer?.minutes, vmix.timer?.seconds, vmix.timer?.isRunning]);

    useEffect(() => {
        setLocalDay(vmix.day || '');
    }, [vmix.day]);

    useEffect(() => {
        setLocalWeek(vmix.week || '');
    }, [vmix.week]);

    const updateInfo = (field, value) => {
        // Optimistic Update
        if (field === 'day') setLocalDay(value);
        if (field === 'week') setLocalWeek(value);

        console.log(`[VMIX] Sending updateInfo for ${field}:`, value);
        socket.emit('update_vmix_info', { [field]: value });
    };

    const updateMatch = (matchId, field, value) => {
        console.log(`[VMIX] Updating Match ${matchId}: ${field} =`, value);
        const currentMatch = vmix.matches ? vmix.matches[matchId] : {};
        const newMatch = { ...currentMatch, [field]: value };
        socket.emit('update_vmix_info', { matches: { [matchId]: newMatch } });
    };

    const timerAction = (command) => {
        console.log(`[VMIX] Timer Action: ${command}`);
        socket.emit('control_timer', { command, minutes: timerMin, seconds: timerSec });
    };

    const maps = serverConfig?.maps || ['Erangel', 'Miramar', 'Sanhok', 'Rondo'];
    const numMatches = serverConfig?.numMatches || 3;

    return (
        <div className="max-w-6xl mx-auto space-y-8">
            <h2 className="text-3xl font-bold mb-8">vMix Title Control (Socket ID: {socket ? socket.id : 'Disconnected'})</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                {/* Timer Control */}
                <div className="bg-[#111318] p-6 rounded-xl border border-white/10 shadow-lg">
                    <h3 className="text-xl font-bold text-indigo-400 mb-6 flex items-center gap-2">
                        <span>⏱️</span> Countdown Timer
                    </h3>

                    <div className="flex flex-col items-center">
                        <div className="font-mono text-6xl font-black text-white bg-black/50 px-8 py-4 rounded-lg mb-6 border-2 border-indigo-900 shadow-inner">
                            {String(timerMin).padStart(2, '0')}:{String(timerSec).padStart(2, '0')}
                        </div>

                        <div className="flex gap-4 mb-6">
                            <div className="flex flex-col">
                                <label className="text-xs uppercase text-gray-500 mb-1">Min</label>
                                <input
                                    type="number"
                                    value={timerMin}
                                    onChange={(e) => setTimerMin(Number(e.target.value))}
                                    className="bg-[#0a0c10] border border-white/10 rounded p-2 w-20 text-center font-bold text-lg focus:border-[#3182ce] outline-none transition-colors"
                                />
                            </div>
                            <div className="flex flex-col">
                                <label className="text-xs uppercase text-gray-500 mb-1">Sec</label>
                                <input
                                    type="number"
                                    value={timerSec}
                                    onChange={(e) => setTimerSec(Number(e.target.value))}
                                    className="bg-[#0a0c10] border border-white/10 rounded p-2 w-20 text-center font-bold text-lg focus:border-[#3182ce] outline-none transition-colors"
                                />
                            </div>
                        </div>

                        <div className="flex gap-2 w-full">
                            <button
                                onClick={() => timerAction('set')}
                                className="flex-1 bg-[#1a1d24] border border-white/10 hover:bg-white/10 py-3 rounded font-bold transition-all active:scale-95"
                            >
                                SET TIME
                            </button>
                            {vmix.timer?.isRunning ? (
                                <button
                                    onClick={() => timerAction('stop')}
                                    className="flex-1 bg-[#e53e3e] hover:bg-red-500 py-3 rounded font-bold animate-pulse shadow-[0_0_15px_rgba(229,62,62,0.4)] active:scale-95"
                                >
                                    STOP
                                </button>
                            ) : (
                                <button
                                    onClick={() => timerAction('start')}
                                    className="flex-1 bg-[#38a169] hover:bg-green-500 py-3 rounded font-bold active:scale-95 shadow-lg"
                                >
                                    START
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Day / Week Control */}
                <div className="bg-[#111318] p-6 rounded-xl border border-white/10 shadow-lg">
                    <h3 className="text-xl font-bold text-indigo-400 mb-6 flex items-center gap-2">
                        <span>📅</span> Day & Week
                    </h3>
                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm uppercase text-gray-400 mb-2 font-bold">Day</label>
                            <input
                                type="text"
                                value={localDay}
                                onChange={(e) => updateInfo('day', e.target.value)}
                                className="w-full bg-[#0a0c10] border border-white/10 rounded p-4 text-2xl font-bold focus:border-[#3182ce] outline-none transition-colors"
                            />
                        </div>
                        <div>
                            <label className="block text-sm uppercase text-gray-400 mb-2 font-bold">Week</label>
                            <input
                                type="text"
                                value={localWeek}
                                onChange={(e) => updateInfo('week', e.target.value)}
                                className="w-full bg-[#0a0c10] border border-white/10 rounded p-4 text-2xl font-bold focus:border-[#3182ce] outline-none transition-colors"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Match Controls */}
            <div className="bg-[#111318] p-6 rounded-xl border border-white/10 shadow-lg">
                <h3 className="text-xl font-bold text-yellow-500 mb-6 flex items-center gap-2">
                    <span>🏆</span> Match Winners & Maps
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {Array.from({ length: numMatches }, (_, i) => i + 1).map(m => {
                        const matchData = vmix.matches?.[m] || {};
                        return (
                            <div key={m} className="bg-[#0a0c10] p-4 rounded-lg border border-white/5 hover:border-white/10 transition-colors">
                                <h4 className="text-lg font-bold text-white mb-4 border-b border-white/10 pb-2">Match {m}</h4>

                                {/* Map Select */}
                                <div className="mb-4">
                                    <label className="text-xs uppercase text-gray-500 block mb-1">Map</label>
                                    <div className="flex flex-wrap gap-1">
                                        {maps.map(map => (
                                            <button
                                                key={map}
                                                onClick={() => updateMatch(m, 'map', map)}
                                                className={`text-[10px] px-2 py-1 rounded border border-white/5 transition-colors active:scale-95 ${matchData.map === map ? 'bg-[#3182ce] text-white font-bold' : 'bg-[#1a1d24] text-gray-400 hover:bg-white/5'}`}
                                            >
                                                {map}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="mt-2 text-sm font-bold text-yellow-500">{matchData.map}</div>
                                </div>

                                {/* Winner Select */}
                                <div>
                                    <label className="text-xs uppercase text-gray-500 block mb-1">Winner (WWCD)</label>
                                    <div className="flex gap-2">
                                        <select
                                            className="w-full bg-[#1a1d24] border border-white/10 rounded p-2 text-sm focus:border-[#3182ce] outline-none transition-colors"
                                            value={matchData.winner?.id || ''}
                                            onChange={(e) => {
                                                const tId = Number(e.target.value);
                                                const team = teams.find(t => t.id === tId);
                                                updateMatch(m, 'winner', team || null);
                                            }}
                                        >
                                            <option value="">-- Select Winner --</option>
                                            {(teams || []).map(t => (
                                                <option key={t.id} value={t.id}>[{t.tag}] {t.name}</option>
                                            ))}
                                        </select>
                                        <button
                                            onClick={() => updateMatch(m, 'showWinner', matchData.showWinner === false ? true : false)}
                                            className={`px-3 rounded font-bold transition-colors ${matchData.showWinner !== false ? 'bg-[#38a169]' : 'bg-[#e53e3e]'}`}
                                            title={matchData.showWinner !== false ? "Hide Winner Info" : "Show Winner Info"}
                                        >
                                            {matchData.showWinner !== false ? '👁️' : '🙈'}
                                        </button>
                                    </div>
                                    <div className={`mt-1 text-xs text-right font-bold ${matchData.showWinner !== false ? 'text-green-500' : 'text-red-500'}`}>
                                        {matchData.showWinner !== false ? 'VISIBLE' : 'HIDDEN (Map Only)'}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}


function ConfigControl({ serverConfig }) {
    const [cfg, setCfg] = React.useState({ ...serverConfig });
    const [saving, setSaving] = React.useState(false);
    const [message, setMessage] = React.useState(null);
    const [newMap, setNewMap] = React.useState('');
    const [resetting, setResetting] = React.useState(false);

    // Sync if serverConfig changes from server
    React.useEffect(() => { setCfg({ ...serverConfig }); }, [serverConfig]);

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cfg)
            });
            const data = await res.json();
            if (data.success) {
                setMessage({ type: 'success', text: '✅ Config saved successfully!' });
            } else {
                setMessage({ type: 'error', text: `❌ Error: ${data.error}` });
            }
        } catch (e) {
            setMessage({ type: 'error', text: `❌ Failed: ${e.message}` });
        } finally {
            setSaving(false);
        }
    };

    const handleResetState = async () => {
        if (!confirm('⚠️ Reset ALL match data (teams, scores, killfeed) to initial state? This cannot be undone.')) return;
        setResetting(true);
        try {
            await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/reset-state`, { method: 'POST' });
            setMessage({ type: 'success', text: '🔄 State reset successfully!' });
        } catch (e) {
            setMessage({ type: 'error', text: `❌ Reset failed: ${e.message}` });
        } finally {
            setResetting(false);
        }
    };

    const addMap = () => {
        const m = newMap.trim();
        if (!m || cfg.maps.includes(m)) return;
        setCfg(prev => ({ ...prev, maps: [...prev.maps, m] }));
        setNewMap('');
    };

    const removeMap = (idx) => {
        setCfg(prev => ({ ...prev, maps: prev.maps.filter((_, i) => i !== idx) }));
    };

    const updatePts = (rank, val) => {
        setCfg(prev => ({ ...prev, placementPoints: { ...prev.placementPoints, [String(rank)]: parseInt(val) || 0 } }));
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div className="flex justify-between items-center mb-8">
                <h2 className="text-3xl font-bold flex items-center gap-2">⚙️ System Config</h2>
                <div className="flex gap-3">
                    <button
                        onClick={handleResetState}
                        disabled={resetting}
                        className="bg-[#e53e3e] hover:bg-red-500 text-white px-5 py-2 rounded-lg font-bold transition-colors shadow-lg text-sm disabled:opacity-50"
                    >
                        {resetting ? 'Resetting…' : '🔄 Reset All State'}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="bg-[#38a169] hover:bg-green-500 shadow-[0_0_10px_rgba(56,161,105,0.4)] text-white px-6 py-2 rounded-lg font-bold transition-colors disabled:opacity-50"
                    >
                        {saving ? 'Saving…' : '💾 Save Config'}
                    </button>
                </div>
            </div>

            {message && (
                <div className={`p-4 rounded-lg border flex items-center gap-3 ${message.type === 'success' ? 'bg-green-900/30 border-green-500/50 text-green-400' : 'bg-red-900/30 border-red-500/50 text-red-400'}`}>
                    <span className="font-bold">{message.text}</span>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                {/* Match & Team Settings */}
                <div className="bg-[#111318] p-6 rounded-xl border border-white/10 shadow-lg">
                    <h3 className="text-xl font-bold text-yellow-500 mb-6">🎮 Match Settings</h3>
                    <div className="space-y-5">
                        <div>
                            <label className="block text-xs uppercase text-gray-400 mb-2 font-bold">Number of Matches</label>
                            <div className="flex items-center gap-3">
                                <button onClick={() => setCfg(p => ({ ...p, numMatches: Math.max(1, p.numMatches - 1) }))} className="w-9 h-9 bg-[#1a1d24] border border-white/10 hover:bg-white/5 rounded font-bold text-lg transition-colors">-</button>
                                <span className="text-3xl font-black w-12 text-center">{cfg.numMatches}</span>
                                <button onClick={() => setCfg(p => ({ ...p, numMatches: Math.min(10, p.numMatches + 1) }))} className="w-9 h-9 bg-[#1a1d24] border border-white/10 hover:bg-white/5 rounded font-bold text-lg transition-colors">+</button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs uppercase text-gray-400 mb-2 font-bold">Default Team Count (for new state)</label>
                            <div className="flex items-center gap-3">
                                <button onClick={() => setCfg(p => ({ ...p, numTeams: Math.max(2, p.numTeams - 1) }))} className="w-9 h-9 bg-[#1a1d24] border border-white/10 hover:bg-white/5 rounded font-bold text-lg transition-colors">-</button>
                                <span className="text-3xl font-black w-12 text-center">{cfg.numTeams}</span>
                                <button onClick={() => setCfg(p => ({ ...p, numTeams: Math.min(64, p.numTeams + 1) }))} className="w-9 h-9 bg-[#1a1d24] border border-white/10 hover:bg-white/5 rounded font-bold text-lg transition-colors">+</button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Map List */}
                <div className="bg-[#111318] p-6 rounded-xl border border-white/10 shadow-lg">
                    <h3 className="text-xl font-bold text-[#e53e3e] mb-6">🗺️ Map List</h3>
                    <div className="flex flex-wrap gap-2 mb-4">
                        {(cfg.maps || []).map((map, i) => (
                            <span key={i} className="flex items-center gap-1 bg-gray-700 px-3 py-1.5 rounded-full text-sm font-bold">
                                {map}
                                <button onClick={() => removeMap(i)} className="text-red-400 hover:text-red-300 ml-1 text-xs font-bold">✕</button>
                            </span>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Add new map..."
                            value={newMap}
                            onChange={e => setNewMap(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addMap()}
                            className="flex-1 bg-[#0a0c10] border border-white/10 rounded px-3 py-2 text-sm focus:border-[#3182ce] outline-none transition-colors"
                        />
                        <button onClick={addMap} className="bg-[#3182ce] hover:bg-blue-500 text-white font-bold px-4 py-2 rounded text-sm">Add</button>
                    </div>
                </div>

                {/* Placement Points */}
                <div className="bg-[#111318] p-6 rounded-xl border border-white/10 shadow-lg">
                    <h3 className="text-xl font-bold text-[#e53e3e] mb-6">🏆 Placement Points</h3>
                    <div className="grid grid-cols-2 gap-3">
                        {Object.entries(cfg.placementPoints || {}).sort((a, b) => Number(a[0]) - Number(b[0])).map(([rank, pts]) => (
                            <div key={rank} className="flex items-center gap-2">
                                <span className="text-gray-400 text-sm font-bold w-16">Rank {rank}:</span>
                                <input
                                    type="number"
                                    min="0"
                                    value={pts}
                                    onChange={e => updatePts(rank, e.target.value)}
                                    className="flex-1 bg-[#0a0c10] border border-white/10 rounded px-2 py-1 text-sm text-center font-bold focus:border-[#3182ce] outline-none transition-colors"
                                />
                                <span className="text-gray-500 text-xs">pts</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* File Paths */}
                <div className="bg-[#111318] p-6 rounded-xl border border-white/10 shadow-lg">
                    <h3 className="text-xl font-bold text-[#e53e3e] mb-6">📁 File Paths & Network</h3>
                    <div className="space-y-4">
                        {[
                            { key: 'mapBasePath1', label: 'Map Image Path 1' },
                            { key: 'mapBasePath2', label: 'Map Image Path 2' },
                            { key: 'logoBasePath', label: 'Team Logo Path' },
                            { key: 'vmixHost', label: 'vMix Host URL' },
                        ].map(({ key, label }) => (
                            <div key={key}>
                                <label className="block text-xs uppercase text-gray-400 mb-1 font-bold">{label}</label>
                                <input
                                    type="text"
                                    value={cfg[key] || ''}
                                    onChange={e => setCfg(prev => ({ ...prev, [key]: e.target.value }))}
                                    className="w-full bg-[#0a0c10] border border-white/10 rounded px-3 py-2 text-sm font-mono focus:border-[#3182ce] outline-none transition-colors"
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bg-[#1a1d24]/50 border border-white/10 rounded-xl p-4 text-xs text-gray-500">
                <strong className="text-gray-400">Note:</strong> Changing "Number of Matches" or "Team Count" only takes effect when you <strong>Reset All State</strong> (or restart the server). Saving config alone does NOT wipe existing match data.
            </div>
        </div>
    );
}

export default AdminDashboard;
