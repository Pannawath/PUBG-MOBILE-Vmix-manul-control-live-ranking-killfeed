const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the current directory
app.use(express.static(__dirname));

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('A user connected');

    // Listen for 'start_randomizer' event from controller
    socket.on('start_randomizer', () => {
        console.log('Randomizer triggered');
        // Broadcast to all clients (including the display) to start
        io.emit('start_randomizer');
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    // Get local IP for convenience
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    let localIP = 'localhost';

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            if (net.family === 'IPv4' && !net.internal) {
                localIP = net.address;
            }
        }
    }

    console.log(`Server running on port ${PORT}`);
    console.log(`Open Control Panel at: http://${localIP}:${PORT}/control.html`);
    console.log(`Open Overlay Display at: http://${localIP}:${PORT}/index.html`);
});
