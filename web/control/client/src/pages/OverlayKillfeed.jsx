import { useEffect, useState } from 'react';
import { socket } from '../socket';

function OverlayKillfeed() {
    const [feed, setFeed] = useState([]);
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        const onNewKillfeed = (item) => {
            const id = Date.now() + Math.random();
            const newItem = { ...item, _id: id };
            setFeed(prev => [...prev, newItem]);

            // Auto remove after 6 seconds
            setTimeout(() => {
                setFeed(prev => prev.filter(i => i._id !== id));
            }, 6000);
        };

        socket.on('new_killfeed', onNewKillfeed);
        return () => socket.off('new_killfeed', onNewKillfeed);
    }, []);

    useEffect(() => {
        socket.on('init_state', (state) => {
            if (state.killfeed) setFeed(state.killfeed);
            if (state.overlayState) setVisible(state.overlayState.killfeed);
        });

        socket.on('state_update', (update) => {
            if (update.type === 'killfeed') setFeed(update.data);
        });

        socket.on('overlay_state_update', (state) => {
            if (state.killfeed !== undefined) setVisible(state.killfeed);
        });

        return () => {
            socket.off('init_state');
            socket.off('state_update');
            socket.off('overlay_state_update');
        };
    }, []);

    // Animation handled by CSS class instead of returning null

    return (
        <div className={`w-full h-screen overflow-hidden bg-transparent flex flex-col justify-start items-end p-12 pt-20 transition-all duration-300 ${visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-10 pointer-events-none'}`}>
            <div className="flex flex-col space-y-2 items-end">
                {feed.map(item => (
                    <div
                        key={item._id}
                        className="animate-in slide-in-from-right fade-in duration-300 flex items-center gap-3 bg-gradient-to-l from-black/90 to-black/40 backdrop-blur-sm px-6 py-2 rounded-l-md border-r-4 border-yellow-500"
                    >
                        <div className="font-black italic text-white text-shadow-sm tracking-wider uppercase text-lg">
                            {item.killer}
                        </div>
                        <div className="text-red-500 font-bold text-2xl">→</div>
                        <div className="font-black italic text-gray-300 text-shadow-sm tracking-wider uppercase text-lg">
                            {item.victim}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default OverlayKillfeed;
