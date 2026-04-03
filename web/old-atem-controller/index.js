const { Atem } = require('atem-connection');
const axios = require('axios');

// ==========================================
// 0. ตั้งค่า Web Dashboard (UI)
// ==========================================
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

// ให้เซิร์ฟเวอร์อ่านไฟล์จากโฟลเดอร์ public (ที่มี index.html)
app.use(express.static(path.join(__dirname, 'public')));

// เปิดพอร์ต 3000 ให้หน้าเว็บ
server.listen(3000, () => {
    console.log(`\n================================`);
    console.log(`💻 ดูหน้าจอ UI ได้ที่: http://localhost:3000`);
    console.log(`================================\n`);

    // เปิดเบราว์เซอร์อัตโนมัติ (สำหรับระบบ Windows)
    require('child_process').exec('start http://localhost:3000');
});


// ==========================================
// 1. ตั้งค่าการเชื่อมต่อ ATEM (Configuration)
// ==========================================

// IP Address ของเครื่อง ATEM Mini ของคุณ
const ATEM_IP = "192.168.1.240"; // <-- เปลี่ยนเป็น IP ของตัวเครื่อง ATEM Mini
// IP Address ของคอมพิวเตอร์ที่เปิด vMix ตัวโปรแกรมอยู่
const VMIX_URL = "http://127.0.0.1:8088/api";

// สร้างวัตถุ ATEM
const myAtem = new Atem();


// ==========================================
// 2. ฟังก์ชันส่งคำสั่งไปให้ vMix
// ==========================================
async function sendVmixCommand(functionName, input = "") {
    try {
        const queryParams = new URLSearchParams({ Function: functionName });
        if (input) {
            queryParams.append("Input", input);
        }

        const url = `${VMIX_URL}/?${queryParams.toString()}`;
        await axios.get(url);

        console.log(`[vMix] ส่งคำสั่งสำเร็จ: ${url}`);

        // ส่งข้อความไปโชว์ในหน้า Web UI ว่ายิงคำสั่ง vMix สำเร็จ
        io.emit('vmix-action', { command: functionName, input: input });

    } catch (error) {
        console.error(`[vMix Error] ไม่สามารถส่งคำสั่งหา vMix ได้:`, error.message);
        io.emit('vmix-error', error.message);
    }
}


// ==========================================
// 3. เริ่มการเชื่อมต่อกับ ATEM
// ==========================================
myAtem.connect(ATEM_IP);

myAtem.on('connected', () => {
    console.log(`✅ เชื่อมต่อกับ ATEM Mini สำเร็จ! (IP: ${ATEM_IP})`);
    // บอกหน้าเว็บว่า ATEM ต่อติดแล้ว
    io.emit('atem-status', { status: 'connected' });
});

myAtem.on('disconnected', () => {
    console.log(`❌ ATEM ขาดการเชื่อมต่อ... กำลังพยายามเชื่อมต่อใหม่...`);
    // บอกหน้าเว็บว่า ATEM ขาดการเชื่อมต่อ 
    io.emit('atem-status', { status: 'disconnected' });
});

// เมื่อมีคนเปิดหน้าเว็บขึ้นมาครั้งแรก ให้ส่งสถานะปัจจุบันไปบอก
io.on('connection', (socket) => {
    console.log(`[UI] มีคนเปิดหน้าต่าง Dashboard ขึ้นมาดู`);
    // ถ้า ATEM ต่ออยู่แล้ว ให้ส่งไปบอกทันที
    if (myAtem.state) {
        // ขอเช็ค input ปัจจุบัน
        const currentProg = myAtem.state.video.mixEffects[0]?.programInput;
        if (currentProg) {
            socket.emit('program-changed', currentProg);
        }
    }
});


// ==========================================
// 4. ดักจับเหตุการณ์เมื่อมีการกดปุ่มสลับกล้องบน ATEM
// ==========================================
// event 'stateChanged' จะทำงานเมื่อมีอะไรก็ตามเปี่ยนแปลงบนตัว ATEM
myAtem.on('stateChanged', (state, pathToChange) => {
    // path ที่เก็บข้อมูลการสลับกล้องหลัก (Program) สีแดง บน ATEM
    if (pathToChange.includes('video.mixEffects.0.programInput')) {
        const currentInput = state.video.mixEffects[0].programInput;

        console.log(`👉 มีการสลับกล้องไปที่กล้องเบอร์: ${currentInput}`);

        // --- 1. ยิงอีเวนต์ไปหา Web UI ให้ไฟปุ่มเปลี่ยนเป็นสีแดงพร้อมเก็บ Log ---
        io.emit('program-changed', currentInput);

        // --- 2. ส่วนที่ปรับแก้เงื่อนไขได้ตามต้องการ (Logic สั่ง vMix) ---
        switch (currentInput) {
            case 1:
                sendVmixCommand("Cut", "1");
                break;
            case 2:
                sendVmixCommand("Cut", "2");
                break;
            case 3:
                sendVmixCommand("OverlayInput1In", "3");
                break;
            case 4:
                sendVmixCommand("Play", "4");
                break;
            default:
                break;
        }
    }
});

