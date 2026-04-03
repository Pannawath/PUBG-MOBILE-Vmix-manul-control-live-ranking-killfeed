const { spawn, execSync } = require('child_process');
const path = require('path');

console.log("Cleaning up previous instances...");
try { 
    execSync(`taskkill /F /IM node.exe /FI "PID ne ${process.pid}" /T 2>nul`); 
    execSync(`taskkill /F /IM python.exe /T 2>nul`);
} catch(e){}

const cmds = [
    { dir: 'control/server', args: ['start'] },
    { dir: 'control/client', args: ['run', 'dev'] },
    { dir: 'รับบบเปลี่ยน ranking', args: ['start'] },
    { dir: 'random map', args: ['start'], env: { PORT: '3002' } },
];

console.log("Starting backend and frontend services...");
const procs = [];
for (let c of cmds) {
    procs.push(spawn('npm', c.args, { 
        cwd: path.join(__dirname, c.dir), 
        shell: true, 
        env: c.env ? { ...process.env, ...c.env } : process.env 
    }));
}
procs.push(spawn('node', ['server.js'], { cwd: path.join(__dirname, 'vmix-mobile'), shell: true }));

// Start OCR
const ocrPath = path.join(__dirname, 'control/ocr_service');
const pythonExec = require('fs').existsSync(path.join(ocrPath, 'venv/Scripts/python.exe')) 
    ? 'venv\\Scripts\\python.exe' : 'python';
procs.push(spawn(pythonExec, ['main.py'], { cwd: ocrPath, shell: true }));

console.log("Waiting 15 seconds for services to fully start...");
setTimeout(() => {
    console.log("All services started. Running Playwright test suite...");
    const test = spawn('npx', ['playwright', 'test'], { 
        cwd: __dirname, 
        shell: true, 
        stdio: 'inherit' 
    });
    
    test.on('close', (code) => {
        console.log(`\nPlaywright exited with code ${code}. Cleaning up background processes...`);
        try { 
            execSync(`taskkill /F /IM node.exe /FI "PID ne ${process.pid}" /T 2>nul`); 
            execSync(`taskkill /F /IM python.exe /T 2>nul`);
        } catch(e){}
        console.log("Testing complete!");
        process.exit(code);
    });
}, 15000);
