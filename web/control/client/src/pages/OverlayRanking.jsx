import { useEffect, useState, useRef } from 'react';
import { socket } from '../socket';
import './OverlayRanking.css';

const OverlayRanking = () => {
    const [teams, setTeams] = useState([]);
    const [visible, setVisible] = useState(true);
    const prevPositions = useRef(new Map());

    useEffect(() => {
        // Set body background to transparent for overlay
        const originalBg = document.body.style.background;
        document.body.style.background = 'transparent';

        socket.on('init_state', (state) => {
            if (state.teams) setTeams(state.teams);
            if (state.overlayState) setVisible(state.overlayState.ranking);
        });

        socket.on('state_update', (update) => {
            if (update.type === 'teams') setTeams(update.data);
        });

        socket.on('overlay_state_update', (state) => {
            if (state.ranking !== undefined) setVisible(state.ranking);
        });

        return () => {
            document.body.style.background = originalBg;
            socket.off('init_state');
            socket.off('state_update');
            socket.off('overlay_state_update');
        };
    }, []);

    // Animation handled by CSS class instead of returning null

    // Sort by total points (placement + elims), then by elims if tied
    const sortedTeams = [...teams].sort((a, b) => {
        const totalA = (a.placement || 0) + (a.elims || 0);
        const totalB = (b.placement || 0) + (b.elims || 0);
        if (totalB !== totalA) return totalB - totalA;
        return (b.elims || 0) - (a.elims || 0);
    });

    return (
        <div className={`overlay-container ${visible ? 'overlay-visible' : 'overlay-hidden'}`}>
            <div className="ranking-table">
                {/* Header */}
                <div className="header">
                    <div></div>
                    <div>TEAM</div>
                    <div>ALIVE</div>
                    <div>PTS</div>
                    <div>ELIMS</div>
                </div>

                {/* Team List */}
                <div className="team-list" style={{ height: sortedTeams.length * 48 }}>
                    {sortedTeams.map((team, index) => {
                        const totalPts = (team.placement || 0) + (team.elims || 0);

                        // Check if team is alive (at least one player alive or knocked)
                        // Filter out Reserve players for calculating aliveness and rendering bars
                        const allPlayers = team.players || [];
                        // Take first 4 or filter by status != reserve? 
                        // User said "Take 4 people as before", implying strict 4 slots.
                        // Since reserves are P5 usually, slicing 0-4 covers it.
                        // Or we can filter out p.status === 'reserve' just to be safe if they are mixed? 
                        // Slicing is safer against layout breaking if there are 5.
                        const players = allPlayers.slice(0, 4);

                        const isTeamAlive = players.some(p => p.status === 'alive' || p.status === 'knocked');

                        let rankClass = '';
                        if (index === 0) rankClass = 'rank-1';
                        else if (index === 1) rankClass = 'rank-2';
                        else if (index === 2) rankClass = 'rank-3';

                        return (
                            <div
                                key={team.id}
                                className={`team-row ${!isTeamAlive ? 'dead' : ''}`}
                                style={{ top: `${index * 48}px`, zIndex: sortedTeams.length - index }}
                            >
                                <div className={`pos ${rankClass}`}>{index + 1}</div>
                                <div className="team-name">
                                    <span>{team.tag}</span>
                                </div>
                                <div className="alive-bars">
                                    {/* 4 bars for 4 players */}
                                    {players.map((player, i) => {
                                        let barClass = 'dead-bar'; // Default: gray (dead)
                                        if (player.status === 'alive') barClass = 'alive'; // Yellow
                                        else if (player.status === 'knocked') barClass = 'knocked'; // Red

                                        return (
                                            <div
                                                key={i}
                                                className={`bar ${barClass}`}
                                            />
                                        );
                                    })}
                                </div>
                                <div className="pts">{totalPts}</div>
                                <div className="elims">{team.elims || 0}</div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export default OverlayRanking;
