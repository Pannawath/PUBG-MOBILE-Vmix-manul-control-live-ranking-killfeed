import io from 'socket.io-client';

// Use VITE_API_URL from .env, fallback to localhost:3001 in dev mode, undefined in production
const URL = import.meta.env.MODE === 'production' ? undefined : (import.meta.env.VITE_API_URL || 'http://localhost:3001');

export const socket = io(URL);
