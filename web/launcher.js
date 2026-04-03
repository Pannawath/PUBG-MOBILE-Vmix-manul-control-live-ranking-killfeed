const { spawn } = require('child_process');
const path = require('path');

const batPath = path.join(process.cwd(), 'run_system.bat');
console.log('Starting PUBG LIVE SYSTEM...');
console.log('Target: ' + batPath);

// Spawn the batch file in a new detached console
const child = spawn('cmd.exe', ['/c', 'start', '""', batPath], { 
    detached: true, 
    stdio: 'ignore',
    windowsHide: false
});

child.unref();
console.log('Launcher finished. System is starting in the background...');
process.exit(0);
