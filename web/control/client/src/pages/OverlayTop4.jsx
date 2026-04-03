import React, { useState, useEffect } from 'react';
import { socket } from '../socket';
import './OverlayTop4.css';

const HELMET_SVG = (
    <svg viewBox="0 0 512 512" style={{ width: '100%', height: '100%' }}>
        <path d="M256,48C141.1,48,48,141.1,48,256v48c0,13.3,10.7,24,24,24h24v64c0,13.3,10.7,24,24,24h64v-64h144v64h64 c13.3,0,24-10.7,24-24v-64h24c13.3,0,24-10.7,24-24v-48C464,141.1,370.9,48,256,48z M120,304H96v-24h24V304z M416,304h-24v-24h24 V304z" fill="currentColor" />
        <path d="M256 32 C132.3 32, 32 132.3, 32 256 V 320 H 80 V 416 H 176 V 320 H 336 V 416 H 432 V 320 H 480 V 256 C 480 132.3, 379.7 32, 256 32 Z" fill="currentColor" transform="scale(0.9) translate(28,28)" />
    </svg>
); // Simply using a circle/helmet shape CSS might be cleaner, but let's try a shape.
// Actually, for "Exact match", the icon in the image is a side-profile helmet/head.
// Let's use a simple CSS shape representing that profile or just a styled block if SVG is too complex to guess. 
// The image shows a "Pubg Level 3 Helmet" style side profile.
// I will use a simplified path or just a circle if I can't make it perfect. Use a "Head/Helmet" shape.

const HelmetIcon = ({ status }) => (
    <div className={`player-icon-wrapper ${status}`}>
        <svg viewBox="0 0 24 24" className="helmet-svg">
            <path fill="currentColor" d="M12 2a10 10 0 0 0-10 10v4a2 2 0 0 0 2 2h2v4h4v-4h4v4h4v-4h2a2 2 0 0 0 2-2v-4a10 10 0 0 0-10-10z" />
        </svg>
    </div>
);

const OverlayTop4 = () => {
    const [teams, setTeams] = useState([]);
    const [visible, setVisible] = useState(true);
    const [lockedIds, setLockedIds] = useState([]);

    const [isConnected, setIsConnected] = useState(socket.connected);

    useEffect(() => {
        // Force transparent background for Overlay
        const originalBodyBg = document.body.style.backgroundColor;
        document.body.style.backgroundColor = 'transparent';

        function onConnect() { setIsConnected(true); }
        function onDisconnect() { setIsConnected(false); }

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);

        socket.on('init_state', (state) => {
            if (state && state.teams) setTeams(state.teams);
            if (state.overlayState) setVisible(state.overlayState.top4);
            if (state.top4Ids) setLockedIds(state.top4Ids);
        });

        socket.on('state_update', (update) => {
            if (update.type === 'teams') setTeams(update.data);
            if (update.type === 'top4Ids') setLockedIds(update.data);
        });

        socket.on('overlay_state_update', (state) => {
            if (state.top4 !== undefined) setVisible(state.top4);
        });

        return () => {
            document.body.style.backgroundColor = originalBodyBg; // Restore
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('init_state');
            socket.off('state_update');
            socket.off('overlay_state_update');
        };
    }, []);

    let displayTeams = [];
    if (lockedIds.length > 0) {
        // Use locked teams and KEEP FIXED ORDER (Do not re-sort by score)
        displayTeams = lockedIds.map(id => teams.find(t => t.id === id)).filter(Boolean);
    } else {
        // Fallback: Calculate Top 4 Alive/Highest Score
        displayTeams = [...teams]
            .sort((a, b) => {
                const aAlive = a.players.some(p => p.status !== 'dead');
                const bAlive = b.players.some(p => p.status !== 'dead');
                if (aAlive !== bAlive) return aAlive ? -1 : 1;
                const scoreA = (a.placement || 0) + (a.elims || 0);
                const scoreB = (b.placement || 0) + (b.elims || 0);
                if (scoreB !== scoreA) return scoreB - scoreA;
                return (b.elims || 0) - (a.elims || 0);
            })
            .slice(0, 4);
    }

    if (!isConnected) {
        return (
            <div className="top4-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
                <h2 style={{ color: 'red', background: 'black', padding: '10px' }}>DISCONNECTED</h2>
            </div>
        );
    }

    if (!teams.length) {
        return (
            <div className="top4-container" style={{ alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)' }}>
                <h2 style={{ color: 'white', opacity: 0.5 }}>Waiting for Match Data...</h2>
            </div>
        );
    }

    return (
        <div className={`top4-container ${visible ? 'overlay-visible' : 'overlay-hidden'}`}>
            <div className="top4-grid">
                {displayTeams.map((team) => {
                    const isDead = !team.players.some(p => p.status !== 'dead');

                    // Count alive players for icon rendering logic if needed, 
                    // but we map individual players.
                    // IMPORTANT: The reference image sorts icons Alive (Left) -> Dead (Right) ?? 
                    // Actually looks like fixed slots. Let's stick to P1-P4 for now or Sort them 'Alive first' for better visuals?
                    // Reference image: "Solid icons = alive/knocked", "Dark icons = dead".

                    return (
                        <div key={team.id} className={`top4-card-wrapper ${isDead ? 'team-dead' : ''}`}>
                            {/* TOP SECTION: INFO & PLAYERS */}
                            <div className="top4-header-row">
                                <div className="team-brand-area">
                                    <div className="team-logo-tag">
                                        <span className="team-tag-text">{team.tag}</span>
                                    </div>
                                </div>
                                <div className="alive-bars">
                                    {(team.players || []).slice(0, 4).map((p, idx) => {
                                        let statusClass = 'alive';
                                        if (p.status === 'knocked') statusClass = 'knocked';
                                        if (p.status === 'dead') statusClass = 'dead-bar';

                                        return (
                                            <div key={idx} className={`bar ${statusClass}`} />
                                        );
                                    })}
                                </div>
                            </div>

                            {/* BOTTOM SECTION: WWCD */}
                            <div className="top4-stats-row">
                                <span className="label-wwcd">WWCD</span>
                                <div className="vertical-divider small"></div>
                                <span className="value-wwcd">{team.wwcd || 0}%</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default OverlayTop4;
