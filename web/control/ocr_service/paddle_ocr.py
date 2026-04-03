"""
PUBG Kill Feed OCR - PaddleOCR Version
=======================================
More accurate than Tesseract, uses deep learning models.
No training required!
"""

import tkinter as tk
from tkinter import ttk, scrolledtext
import cv2
import numpy as np
import socketio
import json
import time
import mss
import threading
import re
from PIL import Image, ImageTk
from difflib import SequenceMatcher

# --- CONFIG ---
CONFIG_FILE = 'ocr_config.json'
DEFAULT_CONFIG = {
    "server_url": "http://localhost:3001",
    "monitor_index": 1,
    "scan_region": {"top": 50, "left": 1400, "width": 500, "height": 300},
    "debug_mode": True
}

try:
    with open(CONFIG_FILE, 'r') as f:
        config = json.load(f)
except:
    config = DEFAULT_CONFIG

# Socket.IO Client
sio = socketio.Client()
sent_cache = []

# PaddleOCR - Lazy load to speed up startup
paddle_ocr = None

def get_paddle_ocr():
    global paddle_ocr
    if paddle_ocr is None:
        from paddleocr import PaddleOCR
        # use_angle_cls: Detect text angle
        # lang: 'en' for English, 'ch' includes English too
        # use_gpu: Set to True if you have CUDA GPU
        paddle_ocr = PaddleOCR(
            use_angle_cls=False,  # Kill feed is always horizontal
            lang='en',
            show_log=False,
            use_gpu=False  # Set True if you have NVIDIA GPU + CUDA
        )
        print("✅ PaddleOCR loaded!")
    return paddle_ocr


# --- KILL PATTERNS ---
KILL_WORDS = {'killed', 'knocked', 'down', 'knocked out', 'finally', 'eliminated', 'headshot'}
PLAYZONE_WORDS = {'playzone', 'bluezone', 'died outside', 'zone'}

# Icon/Noise patterns commonly seen between killer and victim
NOISE_PATTERNS = [
    r'[⚔️💀🔫🎯☠️✕✗×]',  # Unicode icons
    r'\[[^\]]*\]',  # [anything in brackets]
    r'[^a-zA-Z0-9\s\u0E00-\u0E7F]{2,}',  # 2+ consecutive symbols
]


class OCRWorker(threading.Thread):
    def __init__(self, app):
        super().__init__()
        self.app = app
        self._stop_event = threading.Event()
        self.daemon = True
        self.last_text = ""
        self.known_players = set()

    def run(self):
        self.app.log("🚀 PaddleOCR Engine Starting...")
        
        # Pre-load OCR model
        try:
            get_paddle_ocr()
            self.app.log("✅ PaddleOCR Ready!")
        except Exception as e:
            self.app.log(f"❌ Failed to load PaddleOCR: {e}")
            self.app.log("💡 Try: pip install paddlepaddle paddleocr")
            return
        
        self.connect_socket()

        with mss.mss() as sct:
            while not self._stop_event.is_set():
                try:
                    # 1. Capture Screen Region
                    region = self.app.scan_region
                    monitor = {
                        "top": int(region['top']),
                        "left": int(region['left']),
                        "width": int(region['width']),
                        "height": int(region['height'])
                    }
                    
                    if monitor['width'] <= 0 or monitor['height'] <= 0:
                        time.sleep(0.5)
                        continue

                    screenshot = sct.grab(monitor)
                    img = Image.frombytes("RGB", screenshot.size, screenshot.bgra, "raw", "BGRX")
                    img_np = np.array(img)
                    
                    # 2. Preprocess for better OCR
                    processed = self.preprocess(img_np)
                    
                    # 3. Update Preview
                    self.app.update_preview(img, processed)
                    
                    # 4. Run PaddleOCR
                    result = get_paddle_ocr().ocr(processed, cls=False)
                    
                    if result and result[0]:
                        # Extract all text from result
                        texts = []
                        for line in result[0]:
                            if line[1]:  # (text, confidence)
                                text = line[1][0]
                                conf = line[1][1]
                                if conf > 0.5:  # Confidence threshold
                                    texts.append(text)
                        
                        if texts:
                            full_text = ' '.join(texts)
                            
                            # Dedupe check
                            if full_text != self.last_text:
                                self.last_text = full_text
                                self.app.log(f"👀 OCR: {full_text[:60]}...")
                                self.parse_and_send(full_text)

                except Exception as e:
                    print(f"OCR Error: {e}")
                
                # Scan every 150ms
                time.sleep(0.15)

        if sio.connected:
            sio.disconnect()
        self.app.log("🛑 OCR Engine Stopped")

    def stop(self):
        self._stop_event.set()

    def connect_socket(self):
        try:
            if not sio.connected:
                sio.connect(config['server_url'])
                self.app.log(f"🔌 Connected to {config['server_url']}")
                
                @sio.on('init_state')
                def on_init(data):
                    if 'teams' in data:
                        self.sync_players(data['teams'])
                
                @sio.on('state_update')
                def on_update(data):
                    if data.get('type') == 'teams':
                        self.sync_players(data.get('data'))

        except Exception as e:
            self.app.log(f"❌ Socket Error: {e}")

    def sync_players(self, teams):
        """Sync player names from server for smart matching"""
        names = set()
        for team in teams:
            for player in team.get('players', []):
                name = player.get('name', '').strip()
                if name and 'Player' not in name and 'Reserve' not in name:
                    names.add(name.lower())
        self.known_players = names
        # self.app.log(f"🧠 Synced {len(names)} players")

    def preprocess(self, img):
        """Preprocess image for better OCR accuracy"""
        # Convert to grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        
        # Scale up for better recognition
        scale = self.app.img_scale.get()
        if scale > 1.0:
            gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        
        # Threshold
        thresh_val = self.app.img_thresh.get()
        if self.app.img_invert.get():
            gray = cv2.bitwise_not(gray)
        
        _, binary = cv2.threshold(gray, thresh_val, 255, cv2.THRESH_BINARY)
        
        # Convert back to 3-channel for PaddleOCR
        return cv2.cvtColor(binary, cv2.COLOR_GRAY2RGB)

    def parse_and_send(self, text):
        """Parse OCR text and extract killer/victim"""
        global sent_cache
        
        # Clean text
        text = text.replace('|', 'I').replace('™', '').replace('©', '').replace('®', '')
        
        # Method 1: Smart Match using known players
        killer, victim = self.smart_match(text)
        
        # Method 2: Fallback to pattern matching
        if not killer or not victim:
            killer, victim = self.pattern_match(text)
        
        if killer and victim and killer != victim:
            # Normalize for dedup
            key = f"{killer.lower()}->{victim.lower()}"
            
            # Check cache (prevent duplicates within 5 seconds)
            now = time.time()
            is_dup = False
            for item in sent_cache:
                if now - item['ts'] < 5:
                    if item['key'] == key:
                        is_dup = True
                        break
                    # Fuzzy match
                    if SequenceMatcher(None, item['key'], key).ratio() > 0.85:
                        is_dup = True
                        break
            
            if not is_dup:
                self.app.log(f"🔫 {killer} → {victim}")
                
                if sio.connected:
                    sio.emit('new_kill_data', {
                        'killer': killer,
                        'victim': victim,
                        'action': 'knocked',
                        'timestamp': now
                    })
                
                sent_cache.append({'key': key, 'ts': now})
                
                # Cleanup old cache
                sent_cache = [x for x in sent_cache if now - x['ts'] < 10]

    def smart_match(self, text):
        """Find two known players in the text"""
        if not self.known_players:
            return None, None
        
        text_lower = text.lower()
        found = []
        
        for name in self.known_players:
            idx = text_lower.find(name.lower())
            if idx != -1:
                found.append((idx, name))
        
        # Sort by position
        found.sort()
        
        # Need at least 2 different players
        if len(found) >= 2:
            # Get unique names
            unique = []
            seen = set()
            for pos, name in found:
                if name not in seen:
                    unique.append(name)
                    seen.add(name)
            
            if len(unique) >= 2:
                return unique[0], unique[1]
        
        return None, None

    def pattern_match(self, text):
        """Fallback: Use regex patterns to find killer/victim"""
        # Split by common kill indicators
        patterns = [
            r'(.+?)\s+(?:knocked|killed|finally|eliminated)\s+(.+)',
            r'(.+?)\s+[💀☠️⚔️🔫]\s+(.+)',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                killer = self.clean_name(match.group(1))
                victim = self.clean_name(match.group(2))
                if killer and victim:
                    return killer, victim
        
        return None, None

    def clean_name(self, raw):
        """Clean extracted name"""
        if not raw:
            return ""
        
        # Remove common garbage
        name = re.sub(r'^[^a-zA-Z0-9\u0E00-\u0E7F]+', '', raw)  # Leading symbols
        name = re.sub(r'[^a-zA-Z0-9\u0E00-\u0E7F]+$', '', name)  # Trailing symbols
        name = re.sub(r'\s{2,}', ' ', name)  # Multiple spaces
        
        # Length check
        if len(name) < 2 or len(name) > 25:
            return ""
        
        return name.strip()


# --- REGION SELECTOR ---
class RegionSelector(tk.Toplevel):
    def __init__(self, master, callback):
        super().__init__(master)
        self.callback = callback
        self.attributes('-fullscreen', True)
        self.attributes('-alpha', 0.3)
        self.configure(bg='black')
        self.config(cursor="cross")

        self.point1 = None
        self.point2 = None

        self.canvas = tk.Canvas(self, cursor="cross", bg="grey11")
        self.canvas.pack(fill="both", expand=True)
        
        self.instruction_text = self.canvas.create_text(
            self.winfo_screenwidth() // 2, 
            50, 
            text="🎯 คลิกจุดที่ 1: มุมบนซ้ายของ Killfeed", 
            fill="yellow", 
            font=("Arial", 16, "bold")
        )
        
        self.canvas.bind("<ButtonPress-1>", self.on_click)
        self.canvas.bind("<Escape>", lambda e: self.destroy())
    
    def on_click(self, event):
        if self.point1 is None:
            self.point1 = (event.x, event.y)
            self.canvas.create_oval(event.x-5, event.y-5, event.x+5, event.y+5, fill="red", outline="yellow", width=2)
            self.canvas.itemconfig(self.instruction_text, text="🎯 คลิกจุดที่ 2: มุมล่างขวาของ Killfeed")
        else:
            self.point2 = (event.x, event.y)
            
            left = min(self.point1[0], self.point2[0])
            top = min(self.point1[1], self.point2[1])
            width = abs(self.point2[0] - self.point1[0])
            height = abs(self.point2[1] - self.point1[1])
            
            if width > 10 and height > 10:
                region = {'left': left, 'top': top, 'width': width, 'height': height}
                self.callback(region)
            
            self.destroy()


# --- MAIN APP GUI ---
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("PUBG Kill Feed OCR (PaddleOCR)")
        self.geometry("500x700")
        self.configure(bg="#1a1a2e")
        
        self.scan_region = config.get('scan_region', DEFAULT_CONFIG['scan_region'])
        
        # Settings
        self.img_thresh = tk.IntVar(value=config.get('img_thresh', 150))
        self.img_scale = tk.DoubleVar(value=config.get('img_scale', 2.0))
        self.img_invert = tk.BooleanVar(value=config.get('img_invert', False))
        
        self.setup_ui()
        self.ocr_thread = None
        self.is_running = False

    def setup_ui(self):
        # Header
        header = tk.Label(self, text="🎮 PUBG OCR (PaddleOCR)", bg="#1a1a2e", fg="#e94560", font=("Arial", 18, "bold"))
        header.pack(pady=15)
        
        status_label = tk.Label(self, text="✨ Powered by Deep Learning - No Training Required", bg="#1a1a2e", fg="#888", font=("Arial", 9))
        status_label.pack()

        # Region Button
        region_frame = tk.Frame(self, bg="#1a1a2e")
        region_frame.pack(pady=15)
        
        btn_select = tk.Button(region_frame, text="📐 Select Screen Region", command=self.select_region,
                               bg="#0f3460", fg="white", font=("Arial", 11, "bold"), bd=0, padx=20, pady=8)
        btn_select.pack()
        
        self.lbl_region = tk.Label(region_frame, text=self.get_region_text(), bg="#1a1a2e", fg="#666", font=("Consolas", 9))
        self.lbl_region.pack(pady=5)

        # Settings Panel
        settings_frame = tk.LabelFrame(self, text=" Image Settings ", bg="#1a1a2e", fg="#00d9ff", bd=1, font=("Arial", 10, "bold"))
        settings_frame.pack(padx=25, pady=10, fill="x")
        
        # Threshold
        tk.Label(settings_frame, text="Threshold:", bg="#1a1a2e", fg="#ccc", font=("Arial", 9)).pack(anchor="w", padx=10, pady=(5,0))
        self.scale_thresh = tk.Scale(settings_frame, from_=0, to=255, orient="horizontal", variable=self.img_thresh,
                                     bg="#1a1a2e", fg="white", highlightthickness=0, command=self.save_settings_delay)
        self.scale_thresh.pack(fill="x", padx=10)
        
        # Scale
        tk.Label(settings_frame, text="Scale:", bg="#1a1a2e", fg="#ccc", font=("Arial", 9)).pack(anchor="w", padx=10, pady=(5,0))
        self.scale_zoom = tk.Scale(settings_frame, from_=1.0, to=4.0, resolution=0.1, orient="horizontal", variable=self.img_scale,
                                   bg="#1a1a2e", fg="white", highlightthickness=0, command=self.save_settings_delay)
        self.scale_zoom.pack(fill="x", padx=10)
        
        # Invert
        chk_invert = tk.Checkbutton(settings_frame, text="Invert Colors", variable=self.img_invert,
                                    bg="#1a1a2e", fg="#ccc", selectcolor="#333", command=self.save_settings)
        chk_invert.pack(anchor="w", padx=10, pady=5)

        # Preview
        preview_frame = tk.LabelFrame(self, text=" Live Preview ", bg="#1a1a2e", fg="white", bd=1)
        preview_frame.pack(padx=25, pady=10, fill="x")
        
        preview_container = tk.Frame(preview_frame, bg="#1a1a2e")
        preview_container.pack(pady=5)
        
        self.lbl_preview_orig = tk.Label(preview_container, text="Original", bg="black", fg="#444", width=28, height=3)
        self.lbl_preview_orig.pack(side="left", padx=3)
        
        self.lbl_preview_proc = tk.Label(preview_container, text="Processed", bg="black", fg="#444", width=28, height=3)
        self.lbl_preview_proc.pack(side="left", padx=3)

        # Start Button
        self.btn_toggle = tk.Button(self, text="▶ START OCR", command=self.toggle_ocr,
                                    bg="#e94560", fg="white", font=("Arial", 14, "bold"), bd=0, padx=40, pady=12)
        self.btn_toggle.pack(pady=15)

        # Log Area
        log_frame = tk.Frame(self, bg="#1a1a2e")
        log_frame.pack(fill="both", expand=True, padx=25, pady=(5, 20))
        
        tk.Label(log_frame, text="Activity Log", bg="#1a1a2e", fg="#aaa", anchor="w", font=("Arial", 9, "bold")).pack(fill="x")
        self.log_box = scrolledtext.ScrolledText(log_frame, height=10, bg="#0f0f1a", fg="#0f0", font=("Consolas", 9), bd=0)
        self.log_box.pack(fill="both", expand=True)

    def get_region_text(self):
        r = self.scan_region
        return f"X:{r['left']} Y:{r['top']} W:{r['width']} H:{r['height']}"

    def select_region(self):
        self.withdraw()
        self.after(200, lambda: RegionSelector(self, self.on_region_selected))

    def on_region_selected(self, region):
        self.deiconify()
        self.scan_region = region
        self.lbl_region.config(text=self.get_region_text())
        config['scan_region'] = region
        self.save_config()
        self.log(f"📐 Region updated: {region}")

    def save_settings_delay(self, _=None):
        if hasattr(self, '_save_timer'):
            self.after_cancel(self._save_timer)
        self._save_timer = self.after(500, self.save_settings)

    def save_settings(self):
        config['img_thresh'] = self.img_thresh.get()
        config['img_scale'] = self.img_scale.get()
        config['img_invert'] = self.img_invert.get()
        self.save_config()

    def save_config(self):
        with open(CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=4)

    def toggle_ocr(self):
        if self.is_running:
            self.is_running = False
            self.btn_toggle.config(text="▶ START OCR", bg="#e94560")
            if self.ocr_thread:
                self.ocr_thread.stop()
                self.ocr_thread = None
        else:
            self.is_running = True
            self.btn_toggle.config(text="⏹ STOP OCR", bg="#16c79a")
            self.ocr_thread = OCRWorker(self)
            self.ocr_thread.start()

    def update_preview(self, img_pil, img_cv_processed):
        # Original
        img_orig = img_pil.resize((180, 40))
        img_tk_orig = ImageTk.PhotoImage(img_orig)
        self.lbl_preview_orig.config(image=img_tk_orig, width=180, height=40)
        self.lbl_preview_orig.image = img_tk_orig
        
        # Processed
        img_proc = Image.fromarray(img_cv_processed)
        img_proc = img_proc.resize((180, 40))
        img_tk_proc = ImageTk.PhotoImage(img_proc)
        self.lbl_preview_proc.config(image=img_tk_proc, width=180, height=40)
        self.lbl_preview_proc.image = img_tk_proc

    def log(self, msg):
        self.log_box.insert(tk.END, f"{msg}\n")
        self.log_box.see(tk.END)


if __name__ == "__main__":
    app = App()
    app.mainloop()
