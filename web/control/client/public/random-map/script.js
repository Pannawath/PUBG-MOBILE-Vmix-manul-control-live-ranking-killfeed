const maps = [
    {
        name: "ERANGEL", // Erangel
        image: "erangel.jpg",
        id: "erangel"
    },
    {
        name: "MIRAMAR", // Miramar
        image: "miramar.jpg",
        id: "miramar"
    },
    {
        name: "SANHOK", // Sanhok
        image: "sanhok.jpg",
        id: "sanhok"
    },
    {
        name: "RONDO", // Rondo
        image: "rondo.jpg",
        id: "rondo"
    }
];

// DOM Elements (Safely selected)
const mapImage = document.getElementById('map-image');
const mapName = document.getElementById('map-name');
const mapDisplay = document.querySelector('.map-display');
const randomBtn = document.getElementById('random-btn');
const statusText = document.getElementById('status-text');

// Communication Channel
let socket;
try {
    // Determine socket URL based on hostname to avoid hardcoded localhost
    const socketUrl = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '/';
    socket = io(socketUrl);
} catch (e) {
    console.warn("Socket.io not found. Remote features invalid if not running via server.");
}

let isAnimating = false;

// Preload
function preloadImages() {
    maps.forEach(map => {
        const img = new Image();
        img.src = map.image;
    });
}

function getRandomMap() {
    return maps[Math.floor(Math.random() * maps.length)];
}

// ---------------------------
// Animation Logic (Receiver)
// ---------------------------
function startRandomizer() {
    if (isAnimating) return;
    isAnimating = true;

    // Visual resets
    if (mapDisplay) {
        mapDisplay.classList.remove('revealed');
        mapDisplay.classList.add('active');
    }

    // Slot Machine Effect Variables
    let currentSpeed = 50; // Start fast (ms)
    let steps = 0;
    const minSteps = 30; // Run fast for at least 30 frames
    const maxSpeed = 800; // Stop when the interval reaches 800ms
    const decay = 1.15; // Multiply speed by 1.15 each step after minSteps

    // Recursive loop
    function loop() {
        // Update Image
        const randomMap = getRandomMap();
        if (mapImage) {
            mapImage.src = randomMap.image;
            mapImage.classList.add('show');
        }

        steps++;

        // Calculate next speed
        if (steps > minSteps) {
            currentSpeed = Math.floor(currentSpeed * decay);
        }

        // Check continue condition
        if (currentSpeed < maxSpeed) {
            setTimeout(loop, currentSpeed);
        } else {
            // Stop
            finishRandomizer();
        }
    }

    // specific override to make sure it doesn't get stuck if numbers are weird, but logic seems sound.
    // Start!
    setTimeout(loop, currentSpeed);
}

function finishRandomizer() {
    const winner = getRandomMap();
    if (mapImage) mapImage.src = winner.image;

    // Add a slight final pause before revealing name to create suspense
    setTimeout(() => {
        if (mapName) mapName.textContent = winner.name;
        if (mapDisplay) {
            mapDisplay.classList.add('revealed');
            mapDisplay.classList.remove('active');
        }

        isAnimating = false;

        // Notify others if needed (optional)
        // if(socket) socket.emit('finished', winner);
    }, 400);
}

// ---------------------------
// Controller Logic (Sender)
// ---------------------------
function triggerRemoteRandomizer() {
    if (randomBtn) randomBtn.disabled = true;
    if (statusText) statusText.textContent = "ROLLING...";

    // Send signal via Socket.io
    if (socket) {
        socket.emit('start_randomizer');
    } else {
        // Fallback for local testing
        startRandomizer();
    }

    // Re-enable button after estimated time (slightly longer than animation)
    setTimeout(() => {
        if (randomBtn) randomBtn.disabled = false;
        if (statusText) statusText.textContent = "READY";
    }, 8000);
}

// ---------------------------
// Initialization
// ---------------------------
window.onload = () => {
    preloadImages();

    // -- Socket Event Listeners --
    if (socket) {
        socket.on('start_randomizer', () => {
            // Both display and control might see this, so we check if we are the display
            // OR we just run the animation on both so they sync visually!
            startRandomizer();
        });
    }

    // -- If we are on the Display Page (Overlay) --
    if (mapImage) {
        // Set default
        mapImage.src = maps[0].image;
        mapImage.classList.add('show');
    }

    // -- If we are on the Control Page --
    if (randomBtn) {
        randomBtn.addEventListener('click', triggerRemoteRandomizer);
    }
};
