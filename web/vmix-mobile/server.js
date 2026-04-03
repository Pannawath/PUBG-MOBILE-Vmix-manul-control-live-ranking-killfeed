require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { Server } = require("socket.io");
const { XMLParser } = require("fast-xml-parser");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 8000;

// โฟลเดอร์เก็บรูปภาพ
const THUMBNAILS_DIR = path.join(__dirname, 'public', 'thumbnails');
if (!fs.existsSync(THUMBNAILS_DIR)) {
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
}

// URL ของ vMix API ภายในเครื่องคอมพิวเตอร์นี้
const VMIX_URL = process.env.VMIX_URL || "http://127.0.0.1:8088/api";

// ตัวช่วยอ่านและเขียนไฟล์ config ของปุ่ม
const BUTTONS_FILE = path.join(__dirname, 'buttons.json');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ===================================
// API จัดการปุ่ม (อ่าน/บันทึกปุ่มใหม่)
// ===================================
app.get('/api/buttons', (req, res) => {
    try {
        if (!fs.existsSync(BUTTONS_FILE)) {
            // ค่าเริ่มต้นถ้ายังไม่มีไฟล์
            fs.writeFileSync(BUTTONS_FILE, JSON.stringify({
                activePreset: "Default Preset",
                presets: {
                    "Default Preset": [
                        { id: "b1", label: "Scene 1", input: "1" },
                        { id: "b2", label: "Scene 2", input: "2" }
                    ]
                }
            }, null, 2));
        }

        let data = JSON.parse(fs.readFileSync(BUTTONS_FILE, 'utf8'));

        // Migrate โครงสร้างเก่า (ที่เป็น Array ธรรมดา) ให้รองรับพรีเซ็ต
        if (Array.isArray(data)) {
            data = {
                activePreset: "Default Preset",
                presets: {
                    "Default Preset": data
                }
            };
            fs.writeFileSync(BUTTONS_FILE, JSON.stringify(data, null, 2));
        }

        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/buttons', (req, res) => {
    try {
        const fullData = req.body;
        fs.writeFileSync(BUTTONS_FILE, JSON.stringify(fullData, null, 2));
        io.emit('buttons-updated', fullData); // บอกทุกคนที่ต่อหน้าเว็บอยู่ให้อัปเดต
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// ===================================
// สร้าง API Endpoint สำหรับส่งคำสั่งไป vMix
// ===================================
app.post('/api/vmix', async (req, res) => {
    try {
        const { func, input } = req.body;
        if (!func) return res.status(400).json({ error: "No function provided" });

        const queryParams = new URLSearchParams({ Function: func });
        if (input) queryParams.append("Input", input);

        const url = `${VMIX_URL}/?${queryParams.toString()}`;
        await axios.get(url);
        res.json({ success: true, message: `Command ${func} executed successfully` });
    } catch (error) {
        console.error(`[!!] ไม่สามารถติดต่อ vMix ได้:`, error.message);
        res.status(500).json({ error: "Failed to connect to vMix. Is vMix running?" });
    }
});


// ===================================
// Socket.io สำหรับดึงข้อมูล Preview/Program สดๆ
// ===================================
const parser = new XMLParser();

let lastActive = null;
let lastPreview = null;

// ตั้งเวลากระซิบถาม vMix ทุกๆ 0.5 วินาที
setInterval(async () => {
    try {
        const response = await axios.get(VMIX_URL);
        const jsonObj = parser.parse(response.data);

        if (jsonObj && jsonObj.vmix) {
            const currentActive = String(jsonObj.vmix.active);
            const currentPreview = String(jsonObj.vmix.preview);

            // ถ้าค่าเปลี่ยน ให้ส่งบอกทุกคนที่หน้าเว็บ
            if (currentActive !== lastActive || currentPreview !== lastPreview) {
                lastActive = currentActive;
                lastPreview = currentPreview;

                io.emit('vmix-state', {
                    active: currentActive,
                    preview: currentPreview
                });
            }
        }
    } catch (e) {
        // vMix อาจจะยังไม่ได้เปิด
    }
}, 500);

// ===================================
// สร้าง Loop ในการดูดภาพ Thumbnail อัตโนมัติ (1 ครั้งต่อวินาที)
// ===================================
// ให้มันวนลูปผ่านปุ่มที่มีอยู่ใน activePreset ปัจจุบัน แล้วดูดรูปลงเซิร์ฟเวอร์
setInterval(async () => {
    try {
        if (!fs.existsSync(BUTTONS_FILE)) return;
        const data = JSON.parse(fs.readFileSync(BUTTONS_FILE, 'utf8'));
        const activePreset = data.activePreset;
        if (!activePreset || !data.presets || !data.presets[activePreset]) return;

        const currentButtons = data.presets[activePreset];

        for (const btn of currentButtons) {
            const inputNameOrId = btn.input;
            if (!inputNameOrId) continue;

            const imagePath = path.join(THUMBNAILS_DIR, `thumb_${inputNameOrId}.jpg`);

            try {
                // สั่งให้ vMix snapshot ตัวเองลงฮาร์ดดิสก์ของเรา
                const snapshotUrl = `${VMIX_URL}/?Function=SnapshotInput&Input=${inputNameOrId}&Value=${encodeURIComponent(imagePath)}`;
                await axios.get(snapshotUrl);
            } catch (err) {
                // ข้ามไปถ้าดูดไม่ติด (vMix อาจจะไม่ได้เสียบกล้อง หรือเปิดอยู่)
            }
        }

        // บอกหน้าเว็บทุกคนว่า "รูปอัปเดตแล้ว ไปรีเฟรชภาพซะ"
        io.emit('thumbnails-updated', Date.now());

    } catch (error) {
        // ไม่ต้อง log เพื่อไม่ให้รก
    }
}, 1000); // อัปเดตภาพทุกๆ 1 วินาที 


io.on('connection', (socket) => {
    // ส่งข้อมูลล่าสุดให้ทันทีที่เปิดหน้าเว็บ
    socket.emit('vmix-state', { active: lastActive, preview: lastPreview });
});


// ===================================
// ฟังก์ชันเริ่มการทำงาน
// ===================================
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

server.listen(PORT, () => {
    const localIP = getLocalIP();
    console.log(`\n======================================================`);
    console.log(`🚀 vMix Mobile Controller (Dynamic Version) เปิดแล้ว!`);
    console.log(`======================================================`);
    console.log(`\n📱 หยิบโทรศัพท์มือถือของคุณขึ้นมา (ต้องต่อ WiFi เดียวกันกับคอม)`);
    console.log(`🌐 เปิดเบราว์เซอร์ในมือถือ แล้วพิมพ์ที่อยู่เว็บไซต์นี้ ↓`);
    console.log(`\n   >>>  http://${localIP}:${PORT}  <<< \n`);
    console.log(`======================================================\n`);

    // เปิดหน้าเว็บในคอมให้ด้วย
    const exec = require('child_process').exec;
    exec(`start http://localhost:${PORT}`);
});
