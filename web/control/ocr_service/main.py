import tkinter as tk
import os
import ctypes # Added for Short Path (Windows)
from tkinter import ttk, scrolledtext
import cv2
import pytesseract
import numpy as np
import socketio
import json
import time
import mss
import threading
from PIL import Image, ImageTk, ImageDraw

# --- CONFIG & GLOBALS ---
CONFIG_FILE = 'ocr_config.json'
DEFAULT_CONFIG = {
    "server_url": "http://localhost:3001",
    "tesseract_cmd": r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    "monitor_index": 1,
    "scan_region": {"top": 50, "left": 1400, "width": 500, "height": 300},
    "debug_mode": True
}

try:
    with open(CONFIG_FILE, 'r') as f:
        config = json.load(f)
except:
    config = DEFAULT_CONFIG

pytesseract.pytesseract.tesseract_cmd = config.get('tesseract_cmd', r"C:\Program Files\Tesseract-OCR\tesseract.exe")

sio = socketio.Client()
sent_cache = []
recent_reads = []  # Buffer for temporal smoothing - stores last N raw reads

from difflib import SequenceMatcher

# --- CORE LOGIC (Background Thread) ---
class OCRWorker(threading.Thread):
    def __init__(self, app):
        super().__init__()
        self.app = app
        self._stop_event = threading.Event()
        self.daemon = True

    def run(self):
        self.app.log("System: OCR Engine Started")
        
        self.connect_socket()

        with mss.mss() as sct:
            while not self._stop_event.is_set():
                try:
                    # 1. Capture
                    region = self.app.scan_region
                    monitor = {
                        "top": int(region['top']), 
                        "left": int(region['left']), 
                        "width": int(region['width']), 
                        "height": int(region['height'])
                    }
                    if monitor['width'] <= 0 or monitor['height'] <= 0:
                        time.sleep(1)
                        continue

                    screenshot = sct.grab(monitor)
                    img = Image.frombytes("RGB", screenshot.size, screenshot.bgra, "raw", "BGRX")
                    
                    # 3. Process & OCR
                    # Check Auto Threshold Mode
                    if self.app.auto_mode.get():
                        try:
                            # Calculate Otsu threshold on the fly
                            gray_temp = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2GRAY)
                            otsu_val, _ = cv2.threshold(gray_temp, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
                            
                            # --- SMART AUTO: Stabilize & Clamp ---
                            # 1. Clamp: Keep it within a reasonable range of the "Sweet Spot" (172)
                            # User reported 172 is good. We allow some variance (+/- 30) but prevent crazy outliers.
                            MIN_THRESH = 140
                            MAX_THRESH = 200
                            safe_val = max(MIN_THRESH, min(otsu_val, MAX_THRESH))
                            
                            # 2. Smooth: Use Weighted Moving Average to prevent jitter
                            # New = 10% New + 90% Old (Very smooth transition)
                            current_val = self.app.img_thresh.get()
                            smoothed_val = int((0.1 * safe_val) + (0.9 * current_val))
                            
                            # Update Config/UI periodically
                            if not hasattr(self, '_ui_update_counter'): self._ui_update_counter = 0
                            self._ui_update_counter += 1
                            if self._ui_update_counter > 5: # Update UI every 5 frames
                                self._ui_update_counter = 0
                                if abs(smoothed_val - current_val) > 1: # Only update if changed meaningful amount
                                    self.app.img_thresh.set(smoothed_val)
                                    # self.app.log(f"⚡ Auto: {otsu_val:.0f} -> Safe: {safe_val} -> Smooth: {smoothed_val}")
                        except Exception as e:
                            print(f"Auto-thresh error: {e}")
                    
                    # Use the new robust processing (using the current slider value, which is now auto-updated)
                    thresh = self.process_image(img)
                    
                    # 2. Update Preview in GUI (Show Orig vs Processed)
                    self.app.update_preview(img, thresh)
                    
                    # Read Text
                    # Config: Use generated dictionary
                    dict_path = "pubg.words"
                    
                    # Language: English Only (Requested to reduce noise and speed up)
                    lang_str = "eng"
                    
                    # Path Fix: Use Windows "Short Path" (8.3) to avoid Spaces
                    # Tesseract hates spaces in paths on Windows
                    try:
                        tessdata_path = os.path.abspath("tessdata")
                        if os.path.exists(tessdata_path):
                            # Get Short Path (requires ctypes)
                            buf = ctypes.create_unicode_buffer(500)
                            ctypes.windll.kernel32.GetShortPathNameW(tessdata_path, buf, 500)
                            short_path = buf.value
                            if short_path:
                                os.environ["TESSDATA_PREFIX"] = short_path
                            else:
                                # Fallback if short path fails (e.g. fs disable 8.3)
                                os.environ["TESSDATA_PREFIX"] = tessdata_path
                    except Exception as e:
                        print(f"Error setting TESSDATA_PREFIX: {e}")

                    # Config String
                    # Removed --tessdata-dir (using env var instead)
                    # --psm 7: Single line (Killfeed)
                    # --user-words: Use our learned dictionary
                    # Whitelist temporarily removed for debugging
                    custom_config = f'--psm 7 -l {lang_str} --user-words "{dict_path}"'
                    
                    text = pytesseract.image_to_string(thresh, config=custom_config)
                    
                    if text.strip():
                        # Log Raw Text for debugging
                        cleaned = text.replace('\n', ' ').strip()
                        
                        # --- DATA COLLECTION FOR TRAINING ---
                        if len(cleaned) > 2:
                             # Create folder if needed
                             if not os.path.exists('training_data'):
                                 os.makedirs('training_data')
                             
                             # Simple duplicate check to save space (don't save if same as last frame)
                             if not hasattr(self, 'last_raw_text') or self.last_raw_text != cleaned:
                                 self.last_raw_text = cleaned
                                 
                                 # Save Image & GT Text
                                 ts = int(time.time() * 1000)
                                 # Limit filename length, keep safe chars
                                 safe_text = "".join([c for c in cleaned if c.isalnum() or c in (' ', '-', '_')])[:30]
                                 filename_base = f"training_data/{ts}_{safe_text.replace(' ', '_')}"
                                 
                                 cv2.imwrite(f"{filename_base}.png", thresh)
                                 with open(f"{filename_base}.gt.txt", "w", encoding="utf-8") as f:
                                     f.write(cleaned)
                                     
                                 self.app.log(f"👀 RAW (Saved): {cleaned[:50]}...")
                                 self.app.log_raw_to_file(f"RAW [{ts}]: {cleaned}")
                        # ------------------------------------
                        
                        self.parse_and_send(text)

                except Exception as e:
                    print(f"Error: {e}")
                
                # Turbo Speed: Reduce sleep time
                # SLOWER but MORE ACCURATE: 250ms instead of 100ms
                time.sleep(0.25)
        
        if sio.connected:
            sio.disconnect()
        self.app.log("System: OCR Engine Stopped")

    def stop(self):
        self._stop_event.set()

    def connect_socket(self):
        try:
            if not sio.connected:
                sio.connect(config['server_url'])
                self.app.log(f"Socket: Connected to {config['server_url']}")
                
                # --- SYNC PLAYER NAMES ---
                @sio.on('init_state')
                def on_init(data):
                    if 'teams' in data:
                        self.update_known_players(data['teams'])
                
                @sio.on('state_update')
                def on_update(data):
                    if data.get('type') == 'teams':
                        self.update_known_players(data.get('data'))

        except Exception as e:
            self.app.log(f"Socket Error: {e}")

    def update_known_players(self, teams):
        """Helper to extract and store all valid IGNs for smarter matching"""
        player_names = set()
        for team in teams:
            for player in team.get('players', []):
                name = player.get('name', '').strip()
                if name and 'Player' not in name and 'Reserve' not in name:
                    player_names.add(name.lower())
        
        self.app.known_players = player_names
        # self.app.log(f"🧠 OCR Sync: Loaded {len(player_names)} players from server.")

    def process_image(self, img_pil):
        # 1. Convert to CV2
        img_np = np.array(img_pil)
        img_np = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
        gray = cv2.cvtColor(img_np, cv2.COLOR_BGR2GRAY)
        
        # 2. Enhanced Resize - CUBIC for better quality (slower but more accurate)
        scale = self.app.img_scale.get()
        if scale != 1.0:
            gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        
        # 2.5. Denoise to reduce OCR errors from compression artifacts
        gray = cv2.fastNlMeansDenoising(gray, None, h=10, templateWindowSize=7, searchWindowSize=21)
        
        # 2.6. Sharpen for better character edges
        kernel = np.array([[-1,-1,-1], [-1,9,-1], [-1,-1,-1]])
        gray = cv2.filter2D(gray, -1, kernel)
        
        # 3. Dynamic Thresholding
        thresh_val = self.app.img_thresh.get()
        
        # Invert if requested (White text on black background is standard for Tesseract)
        # But if user wants to force invert the other way:
        if self.app.img_invert.get():
             gray = cv2.bitwise_not(gray)
             
        # Apply Binary Threshold
        _, thresh = cv2.threshold(gray, thresh_val, 255, cv2.THRESH_BINARY)
        
        # 4. Auto-Crop
        thresh = self.auto_crop(thresh)
        
        return thresh
    
    def auto_crop(self, img):
        """Smart Crop: Focus on the main text line using morphological dilation to connect chars"""
        try:
            # 1. Dilate to connect text characters into a single blob
            # Kernel is wider to connect Killer + Icon + Victim (even if there are gaps)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (50, 3)) 
            dilated = cv2.dilate(img, kernel, iterations=1)
            
            # 2. Find contours on Dilated image
            contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            if not contours:
                return img
            
            # 3. Find valid text blocks
            # Filter by area to ignore small noise
            valid_contours = [c for c in contours if cv2.boundingRect(c)[2] > 20 and cv2.boundingRect(c)[3] > 8]
            
            if not valid_contours:
                return img
                
            # 4. Merge all valid contours on the same line (Killfeed is usually one line)
            # Instead of picking just one, we find the min/max x across ALL significant text
            x_min_all = img.shape[1]
            x_max_all = 0
            y_min_all = img.shape[0]
            y_max_all = 0
            
            found_any = False
            for cnt in valid_contours:
                x, y, w, h = cv2.boundingRect(cnt)
                x_min_all = min(x_min_all, x)
                y_min_all = min(y_min_all, y)
                x_max_all = max(x_max_all, x + w)
                y_max_all = max(y_max_all, y + h)
                found_any = True
                
            if not found_any: return img

            # 5. Crop with Padding
            padding = 10
            h_img, w_img = img.shape
            
            # Final Crop Coordinates
            fx_min = max(0, x_min_all - padding)
            fy_min = max(0, y_min_all - padding)
            fx_max = min(w_img, x_max_all + padding)
            fy_max = min(h_img, y_max_all + padding)
            
            # Ensure valid crop
            if fx_max > fx_min and fy_max > fy_min:
                return img[fy_min:fy_max, fx_min:fx_max]
            
            return img
        except Exception as e:
            print(f"Auto-crop error: {e}")
            return img

    def parse_and_send(self, text):
        global sent_cache, recent_reads
        import re
        lines = text.split('\n')
        
        current_batch = []
        
        # --- TEMPORAL SMOOTHING: Store recent reads for pattern matching ---
        for line in lines:
            line = line.strip()
            if len(line) > 5:
                recent_reads.append({'text': line, 'ts': time.time()})
        
        # Keep only last 2 seconds of reads
        recent_reads[:] = [r for r in recent_reads if time.time() - r['ts'] < 2.0]
        
        # Helper: Find similar recent reads (for consensus voting)
        def find_similar_reads(current_text, min_similarity=0.6):
            """Find recent reads that are similar to current text"""
            similar = []
            for r in recent_reads:
                if r['text'] == current_text:
                    continue
                ratio = SequenceMatcher(None, current_text.lower(), r['text'].lower()).ratio()
                if ratio > min_similarity:
                    similar.append(r['text'])
            return similar
        
        # STRICT REGEX: Only match clear kill/knock icons
        # Expanded based on actual raw log patterns + detailed analysis
        tokens_list = [
            # Icon patterns with symbols
            r"TI®", r"TH®", r"TIP", r"TBP", r"TB®", r"7TP", r"'7", r"\"7",
            r"PX", r"PY", r"PR", r"=P", r"P=", r"PPC", r"PPT", r"PP",
            # gX patterns (very common)
            r"gw", r"gu", r"gf", r"gr", r"gx", r"ge", r"go", r"gv", r"g%", r"g®",
            r"_g", r"og", r"of",
            # fX patterns
            r"f®", r"f%", r"ff", r"fw", r"fv", r"ft", r"f™",
            # Symbol combos
            r"®f", r"®\s*f", r"™f", r"©f",
            r"\|F", r"IF", r"1F", r"YF",
            # Bracket/special
            r"@", r"\[\]", r"\(\)", r"\{\}",
            # Single separators (NEW)
            r"\|", r"/", r"\\\\",
            # Noise prefixes that appear before names (NEW)
            r"Tews\s+", r"Tore\s+", r"Tern\s+", r"To\s+", r"\"oo\s+", r"ews\s+", r"\"ews\s+",
            r"Tor\s+", r"Tae\s+", r"Taxa\s+",
            # Noise patterns (NEW)
            r"od\s+", r"asi\s+", r"ieire\s+", r"aININGE\s+", r"WEININGE\s+",
            r"B\s+F", r"tA\s+\|=\s+/",
            # Suffix noise that sticks to names (NEW)
            r"\s+i\.", r"\s+,l\.", r"\s+1\.\.\.", r"\s+—", r"\s+~",
            # Actual words
            r"killed", r"knocked", r"headshot", r"bleeding",
        ]
        
        token_pattern = '|'.join(tokens_list)
        
        # Allow some flexibility - require at least 1 whitespace on one side
        icon_pattern = r'(?:\s+(?:' + token_pattern + r')|\b(?:' + token_pattern + r')\s+)'
        
        # PLAYZONE PATTERN: English + Thai
        # Thai: นอกโซน = outside zone, ตายนอกวง = died outside circle
        playzone_pattern = r'(Playzone|Bluezone|died\s+outside|killed\s+by\s+Playzone|นอกโซน|ตายนอกวง|นอกโซนการเล่น|โซนการเล่น)'
        
        # TEAM NAME CORRECTION
        # For School Tournament: Trust the OCR. Do not force Pro Team names.
        def fix_team_name(name):
            # If you want to fix specific school team names later, add them here.
            # Example: 'Grade6': 'G.6'
            corrections = {}
            
            for wrong, right in corrections.items():
                if name.startswith(wrong):
                    return name.replace(wrong, right, 1)
                    
            return name

        # GARBAGE PATTERNS: Common flag/noise patterns to reject
        garbage_patterns = [
            r'^[~\-_=\.\s]+$',  # Only symbols
            r'^\d+$',  # Only numbers
            r'.*\s{3,}.*',  # Too many spaces
            r'.*\(\s*knocked\s*\).*',  # Already processed
            r'.*[<>]{2,}.*',  # HTML-like garbage
            r'^[\'"]+.*',  # Starts with quotes
        ]
        
        def is_valid_name(n):
            if not n or len(n) < 3: return False  # STRICTER: Min 3 chars
            
            # FAST TRACK: If it's a known player from server, it's valid!
            if n.lower() in self.app.known_players:
                return True
                
            if len(n) > 35: return False
            
            # Reject names with purely flag/banner content chars
            bad_chars = ['@', '©', '™', '®', '°', '§', '¶', '†', '‡', '•', '…', '″', '′', '「', '」', '『', '』', '$', '%', '&']
            if any(c in n for c in bad_chars): return False
            
            # NEW: Reject if name ends with obvious garbage
            garbage_endings = ['[', ']', '(', ')', '{', '}', '|', '\\', '/', '<', '>', '.', ',', ';', ':', '!', '?']
            if n and n[-1] in garbage_endings: return False
            
            # Reject only if it matches specific garbage
            for pattern in garbage_patterns:
                if re.match(pattern, n, re.IGNORECASE):
                    return False
            
            # Must have at least one letter (English or Thai Unicode range)
            # Thai Unicode: \u0E00-\u0E7F
            has_letter = any(c.isalpha() or '\u0E00' <= c <= '\u0E7F' for c in n)
            if not has_letter:
                return False

            # STRICTER: Must have at least 3 consecutive letters (avoids "a b" noise like "Nol", "RN")
            if not re.search(r'[a-zA-Z\u0E00-\u0E7F]{3,}', n): 
                return False
            
            # NEW: Reject if too much garbage ratio (more symbols than letters)
            letters = sum(1 for c in n if c.isalpha())
            if letters < len(n) * 0.4:  # At least 40% must be letters
                return False
            
            return True

        def clean_name(raw):
            """Deep clean a name, removing flag/garbage artifacts + OCR noise"""
            if not raw: return ""
            
            # PHASE 1: Remove OCR noise prefixes (LESS aggressive now)
            # Only remove if followed by a SPACE and another word
            noise_prefixes = [
                r'^(Tews|Tore|Tern|"oo|"ews)\s+',  # Multi-char noise only
                # Removed single-letter removal - too aggressive
                # Removed UHR/UTHOR - might be part of valid names
            ]
            name = raw
            for pattern in noise_prefixes:
                name = re.sub(pattern, '', name)
            
            # PHASE 2: Remove OCR noise suffixes (LESS aggressive - no .* wildcards)
            # Only remove EXACT patterns, not everything after them
            noise_suffixes = [
                r'\s+i\.$',  # Dots at end only - exact pattern
                r'\s+,l\.$',
                r'\s+1\.\.\.$',
                # Removed —.* and ~.* - too greedy, removed valid content
                r'\s+(TI®|TIP|TBP|TB®)$',  # Icon at end ONLY, no .* wildcard
                r'\s+(gu|gf|go|gr|ge|gv|gw|g®|g%)$',  # g-series at end only
            ]
            for pattern in noise_suffixes:
                name = re.sub(pattern, '', name)
            
            # 1. Remove common OCR prefixes
            # "A _ ", "L _ ", "I ", leading quotes, decorative brackets, isolated symbols
            name = re.sub(r'^[ALIT]\s+[_]\s+', '', name) # A _ X
            # Remove copyright, reg, dots, ampersand, question marks, etc. at start
            # Added: — (em dash), _ (underscore), ~ (tilde)
            name = re.sub(r'^[©®\.\&,;:\?\!\|\<\>\[\]\(\)\{\}\-\=\+\*\^\~\`\s_—]+', '', name)
            name = re.sub(r'^["\'\u0022«»]+\s*', '', name)
            
            # Remove leading non-alphanumeric chars (e.g. "+ Name", "* Name")
            name = re.sub(r'^[^a-zA-Z0-9\u0E00-\u0E7F]+\s*', '', name)

            # 2. Strip edge garbage
            name = name.strip(""" .-_*[]"'<>=\\/,;:!?~^`|(){}©®&—""")
            
            # 3. Remove leading/trailing numbers with symbols (often flag remnants)
            # CAREFUL: Don't remove real name numbers (e.g. 4AM, 1S0ok)
            # Only remove if it looks like an index: "1. ", "5 - "
            name = re.sub(r'^\d+[\.\-\)]\s+', '', name) 
            
            # 4. Collapse multiple spaces
            name = re.sub(r'\s{2,}', ' ', name)
            
            # PHASE 3: Normalize typos for known players
            name_lower = name.lower()
            # notyourBadBoi variations: notyourBadBmi, notyourBadBei, etc.
            if 'notyourbad' in name_lower and 'boi' not in name_lower:
                if any(x in name_lower for x in ['bmi', 'bei', 'bai', 'bbi']):
                    return 'notyourBadBoi'
            
            # More typo fixes can be added here
            
            return name.strip()

        for line in lines:
            line = line.strip()
            # Clean common OCR artifacts
            line = line.replace('|', 'I').replace('™', '').replace('©', '').replace('®', '')
            
            if len(line) < 5: continue
            
            # 1. Check Playzone Death
            if re.search(playzone_pattern, line, re.IGNORECASE):
                # ... (Playzone logic unchanged) ...
                pass 

            # 2. Check Normal Kill/Knock
            
            # --- SMART MATCH PASS (Using Server Known Players) ---
            potential_pair = None
            # ... (Smart Match logic unchanged) ...

            if potential_pair:
                killer, victim = potential_pair
            else:
                # New Strategy: Use regex as a SPLITTER, not just a matcher.
                # This handles "Name [Garbage] [Garbage] Name" correctly.
                # Update tokens list with last minute findings
                # F9, ml, nl, nlu, JP, Ly, Eo
                current_tokens_pattern = icon_pattern # Use the one defined above
                
                parts = re.split(current_tokens_pattern, line, flags=re.IGNORECASE)
                
                # Filter out empty strings and None
                parts = [p.strip() for p in parts if p and p.strip()]
                
                killer = None
                victim = None
                
                if len(parts) >= 2:
                    # Heuristic: 
                    # Part 0 is usually Killer
                    # Part -1 is usually Victim
                    # Everything else in between is likely part of the "Kill Message" that got split weirdly
                    
                    raw_killer = parts[0]
                    raw_victim = parts[-1] 
                    
                    # Validation check
                    if len(raw_killer) < 2 or len(raw_victim) < 2:
                        continue
                        
                    killer = clean_name(raw_killer)
                    victim = clean_name(raw_victim)
                
            if killer and victim:
                # FIX: Strip specific icon residue that often sticks to victim name
                # These are fragments like "ge", "ff" that didn't get caught by the split pattern
                residue_words = ['gee', 'gw', 'ff', 'of', 'fw', 'ge', 'og', 'sr', 'sy', 'gn', 'gv']
                for word in residue_words:
                    if victim.lower().startswith(word + ' '):
                        victim = victim[len(word):].strip()
                    if victim.lower().startswith(word): # Check if it IS the word
                        if len(victim) == len(word):
                             victim = "" # Victim was just residue
                        elif victim[len(word)] == ' ':
                             victim = victim[len(word):].strip()
                
                # Apply team name corrections
                killer = fix_team_name(killer)
                victim = fix_team_name(victim)
                
                # Validate both names
                if not is_valid_name(killer):
                    # if self.app.debug_mode: print(f"❌ Reject Killer: '{killer}' (Raw: {raw_killer})")
                    continue
                if not is_valid_name(victim):
                    # if self.app.debug_mode: print(f"❌ Reject Victim: '{victim}' (Raw: {raw_victim})")
                    continue
                
                # --- TEMPORAL CONSENSUS CHECK (DISABLED for now) ---
                # If NOT from known_players, require similar patterns in recent reads
                # is_from_known = (killer.lower() in self.app.known_players or 
                #                  victim.lower() in self.app.known_players)
                # 
                # if not is_from_known:
                #     # Check if this line has similar reads (consensus)
                #     similar = find_similar_reads(line, min_similarity=0.5)
                #     if len(similar) < 1:  # Need at least 1 similar read to trust it
                #         # Skip this read - wait for more consensus
                #         continue
                
                action = 'knocked'
                
                # --- DEDUPLICATION LOGIC ---
                # Deduplicate (Fuzzy & 3 second window)
                # FIX: Normalized key for better deduplication
                def normalize_key(s):
                    return re.sub(r'[^a-zA-Z0-9]', '', s).lower()
                
                norm_killer = normalize_key(killer)
                norm_victim = normalize_key(victim)
                
                key = f"{norm_killer}->{norm_victim}"
                is_dup = False
                
                # Standardize cache access
                # Cache item format: {'key': str, 'ts': float}
                for old in sent_cache:
                    # Handle both string and dict cache items (migration safety)
                    old_key = old if isinstance(old, str) else old.get('key', '')
                    old_ts = 0 if isinstance(old, str) else old.get('ts', 0)
                    
                    if time.time() - old_ts > 3: continue 
                    
                    # 1. Exact Match on Normalized Key
                    if old_key == key:
                        is_dup = True
                        break
                        
                    # 2. Fuzzy Match (If killer same, victim very similar)
                    if '->' in old_key and '->' in key:
                         try:
                             parts_old = old_key.split('->')
                             parts_new = key.split('->')
                             if len(parts_old) == 2 and len(parts_new) == 2:
                                 ok, ov = parts_old
                                 nk, nv = parts_new
                                 
                                 if ok == nk: # Killer matches exactly
                                     similarity = SequenceMatcher(None, ov, nv).ratio()
                                     if similarity > 0.75: # 75% similar victim
                                         is_dup = True
                                         break
                         except:
                             pass
                
                if not is_dup:
                    log_msg = f"🔫 {killer} -> {victim} ({action})"
                    self.app.log(log_msg)
                    self.app.log_to_file(log_msg)
                    
                    if hasattr(self.app, 'sio') and self.app.sio.connected:
                        # Use new_kill_data/push_killfeed consistent event name
                        self.app.sio.emit('new_kill_data', {
                            'killer': killer, 
                            'victim': victim, 
                            'action': action,
                            'timestamp': time.time()
                        })
                        
                    current_batch.append({'key': key, 'ts': time.time()})

        if current_batch:
            sent_cache.extend(current_batch)
            # Prune old cache (> 8 seconds)
            sent_cache[:] = [x for x in sent_cache if isinstance(x, dict) and (time.time() - x.get('ts', 0) < 8)]



# --- REGION SELECTOR (2-Click Mode: Top-Left, then Bottom-Right) ---
class RegionSelector(tk.Toplevel):
    def __init__(self, master, callback):
        super().__init__(master)
        self.callback = callback
        self.attributes('-fullscreen', True)
        self.attributes('-alpha', 0.3)
        self.configure(bg='black')
        self.config(cursor="cross")

        self.point1 = None  # Top-Left
        self.point2 = None  # Bottom-Right
        self.rect = None

        self.canvas = tk.Canvas(self, cursor="cross", bg="grey11")
        self.canvas.pack(fill="both", expand=True)
        
        # Instructions
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
            # First click = Top-Left
            self.point1 = (event.x, event.y)
            
            # Draw marker
            self.canvas.create_oval(event.x-5, event.y-5, event.x+5, event.y+5, fill="red", outline="yellow", width=2)
            
            # Update instruction
            self.canvas.itemconfig(self.instruction_text, text="🎯 คลิกจุดที่ 2: มุมล่างขวาของ Killfeed")
        else:
            # Second click = Bottom-Right
            self.point2 = (event.x, event.y)
            
            # Calculate region
            left = min(self.point1[0], self.point2[0])
            top = min(self.point1[1], self.point2[1])
            width = abs(self.point2[0] - self.point1[0])
            height = abs(self.point2[1] - self.point1[1])
            
            if width > 10 and height > 10:
                region = {
                    'left': left,
                    'top': top,
                    'width': width,
                    'height': height
                }
                self.callback(region)
            
            self.destroy()


# --- MAIN APP GUI ---
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("PUBG Killfeed OCR")
        self.geometry("450x750")
        self.configure(bg="#1e1e1e")
        
        # Load Config
        self.scan_region = config['scan_region']
        
        # Image Processing Settings (Load defaults or from config if exists)
        self.img_thresh = tk.IntVar(value=config.get('img_thresh', 150))
        self.img_scale = tk.DoubleVar(value=config.get('img_scale', 2.0))
        self.img_invert = tk.BooleanVar(value=config.get('img_invert', False))
        
        self.known_players = set() # Store synced IGNs from server
        
        self.setup_ui()
        self.ocr_thread = None
        self.is_running = False

    def setup_ui(self):
        style = ttk.Style()
        style.theme_use('clam')
        style.configure("TButton", padding=6, relief="flat", background="#333", foreground="white")
        style.configure("TScale", background="#1e1e1e", troughcolor="#333", sliderrelief="flat")
        style.configure("TCheckbutton", background="#1e1e1e", foreground="white")
        
        # Header
        header = tk.Label(self, text="PUBG OCR CONTROLLER", bg="#1e1e1e", fg="#eab308", font=("Arial", 16, "bold"))
        header.pack(pady=10)

        # Region Frame
        region_frame = tk.Frame(self, bg="#1e1e1e")
        region_frame.pack(pady=5)
        
        btn_select = tk.Button(region_frame, text="[ + ] Select Screen Region", command=self.select_region, 
                               bg="#3b82f6", fg="white", font=("Arial", 10, "bold"), bd=0, padx=15, pady=5)
        btn_select.pack()
        
        self.lbl_region = tk.Label(region_frame, text=self.get_region_text(), bg="#1e1e1e", fg="#888", font=("Consolas", 9))
        self.lbl_region.pack(pady=2)

        # --- IMAGE SETTINGS PANEL ---
        settings_frame = tk.LabelFrame(self, text=" Image Settings (Fine Tune) ", bg="#1e1e1e", fg="#00e5ff", bd=1)
        settings_frame.pack(padx=20, pady=5, fill="x")
        
        # Threshold Slider
        tk.Label(settings_frame, text="Threshold (Black/White cut-off):", bg="#1e1e1e", fg="#ccc").pack(anchor="w", padx=10)
        self.scale_thresh = tk.Scale(settings_frame, from_=0, to=255, orient="horizontal", variable=self.img_thresh, 
                                     bg="#1e1e1e", fg="white", highlightthickness=0, command=self.save_settings_delay)
        self.scale_thresh.pack(fill="x", padx=10)
        
        # Auto Threshold Button
        btn_auto_thresh = tk.Button(settings_frame, text="✨ Auto Detect Threshold", command=self.auto_threshold,
                                    bg="#0ea5e9", fg="white", font=("Arial", 8), bd=0, pady=2)
        btn_auto_thresh.pack(fill="x", padx=10, pady=2)
        
        # Scale Slider
        tk.Label(settings_frame, text="Scale Factor (Zoom):", bg="#1e1e1e", fg="#ccc").pack(anchor="w", padx=10, pady=(5,0))
        self.scale_zoom = tk.Scale(settings_frame, from_=1.0, to=4.0, resolution=0.1, orient="horizontal", variable=self.img_scale, 
                                   bg="#1e1e1e", fg="white", highlightthickness=0, command=self.save_settings_delay)
        self.scale_zoom.pack(fill="x", padx=10)
        
        # Invert Checkbox
        chk_invert = tk.Checkbutton(settings_frame, text="Invert Colors (White Background)", variable=self.img_invert, 
                                    bg="#1e1e1e", fg="#ccc", selectcolor="#333", activebackground="#1e1e1e", activeforeground="white", command=self.save_settings)
        chk_invert.pack(anchor="w", padx=10, pady=5)
        
        # Auto-Threshold Checkbox (Full Auto Mode)
        self.auto_mode = tk.BooleanVar(value=False)
        chk_auto = tk.Checkbutton(settings_frame, text="⚡ Real-time Auto Threshold (Beta)", variable=self.auto_mode,
                                  bg="#1e1e1e", fg="#0ea5e9", selectcolor="#333", activebackground="#1e1e1e", activeforeground="#0ea5e9")
        chk_auto.pack(anchor="w", padx=10)

        # Preview Area (Split View) - LARGER SIZE
        self.preview_frame = tk.LabelFrame(self, text=" Live Preview (Original / Processed) ", bg="#1e1e1e", fg="white", bd=1)
        self.preview_frame.pack(padx=20, pady=10, fill="x", expand=False)
        
        preview_container = tk.Frame(self.preview_frame, bg="#1e1e1e")
        preview_container.pack(fill="x")
        
        self.lbl_preview_orig = tk.Label(preview_container, text="Original", bg="black", fg="#444")
        self.lbl_preview_orig.pack(side="top", padx=5, pady=5, fill="x")
        
        self.lbl_preview_proc = tk.Label(preview_container, text="Processed", bg="black", fg="#444")
        self.lbl_preview_proc.pack(side="top", padx=5, pady=5, fill="x")

        # Controls
        self.btn_toggle = tk.Button(self, text="START OCR", command=self.toggle_ocr, 
                                    bg="#22c55e", fg="white", font=("Arial", 12, "bold"), bd=0, padx=30, pady=10)
        self.btn_toggle.pack(pady=5)

        # Log Area
        log_frame = tk.Frame(self, bg="#1e1e1e")
        log_frame.pack(fill="both", expand=True, padx=20, pady=(5, 15))
        
        tk.Label(log_frame, text="Activity Log", bg="#1e1e1e", fg="#aaa", anchor="w").pack(fill="x")
        self.log_box = scrolledtext.ScrolledText(log_frame, height=8, bg="#111", fg="#0f0", font=("Consolas", 8), bd=0)
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
        
        self.log(f"Region updated: {region}")
    
    def save_settings_delay(self, _=None):
        if hasattr(self, '_save_timer'):
            self.after_cancel(self._save_timer)
        self._save_timer = self.after(500, self.save_settings)

    def save_settings(self):
        config['img_thresh'] = self.img_thresh.get()
        config['img_scale'] = self.img_scale.get()
        config['img_invert'] = self.img_invert.get()
        self.save_config()
        # self.log("Settings saved.")

    def save_config(self):
        with open(CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=4)

    def auto_threshold(self):
        """Automatically detect optimal threshold using Otsu's method from the last captured frame"""
        if not hasattr(self, 'last_img_cv') or self.last_img_cv is None:
            self.log("⚠️ Start OCR first to capture an image!")
            return
            
        try:
            # Convert to grayscale
            gray = cv2.cvtColor(self.last_img_cv, cv2.COLOR_BGR2GRAY)
            
            # Apply Otsu's binarization
            # Otsu returns (optimal_threshold, thresholded_image)
            otsu_thresh, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            
            # Update UI
            self.img_thresh.set(int(otsu_thresh))
            self.log(f"✨ Auto Threshold set to: {int(otsu_thresh)}")
            
            # Save
            self.save_settings()
            
        except Exception as e:
            self.log(f"Error auto-thresh: {e}")

    def toggle_ocr(self):
        if self.is_running:
            self.is_running = False
            self.btn_toggle.config(text="START OCR", bg="#22c55e")
            if self.ocr_thread:
                self.ocr_thread.stop()
                self.ocr_thread = None
        else:
            self.is_running = True
            self.btn_toggle.config(text="STOP OCR", bg="#ef4444")
            self.ocr_thread = OCRWorker(self)
            self.ocr_thread.start()

    def update_preview(self, img_pil, img_cv_processed):
        # Store for Auto-Thresh
        self.last_img_cv = np.array(img_pil) # Store original RGB as array
        if self.last_img_cv.ndim == 3:
             self.last_img_cv = self.last_img_cv[:, :, ::-1] # Convert RGB to BGR for OpenCV

        # Preview size - make it larger and maintain aspect ratio
        region = self.scan_region
        aspect = region['width'] / max(region['height'], 1)
        preview_width = min(400, region['width'] * 2)  # Max 400px wide
        preview_height = int(preview_width / aspect)
        preview_height = max(40, min(preview_height, 120))  # Between 40-120px tall
        
        img_orig = img_pil.resize((preview_width, preview_height))
        img_tk_orig = ImageTk.PhotoImage(img_orig)
        self.lbl_preview_orig.config(image=img_tk_orig)
        self.lbl_preview_orig.image = img_tk_orig
        
        # 2. Update Processed (Convert CV2 back to PIL)
        img_proc = Image.fromarray(img_cv_processed)
        img_proc = img_proc.resize((preview_width, preview_height))
        img_tk_proc = ImageTk.PhotoImage(img_proc)
        self.lbl_preview_proc.config(image=img_tk_proc)
        self.lbl_preview_proc.image = img_tk_proc

    def log(self, msg):
        self.log_box.insert(tk.END, f"{msg}\n")
        self.log_box.see(tk.END)
    
    def log_to_file(self, msg):
        try:
            with open('ocr_log.txt', 'a', encoding='utf-8') as f:
                ts = time.strftime("[%H:%M:%S]", time.localtime())
                f.write(f"{ts} {msg}\n")
        except: pass

    def log_raw_to_file(self, msg):
        try:
            with open('ocr_raw_log.txt', 'a', encoding='utf-8') as f:
                ts = int(time.time() * 1000)
                f.write(f"[{ts}] {msg}\n")
        except: pass
        # Also log raw to valid file if important
        
    def log_to_file(self, msg):
        try:
            with open("ocr_log.txt", "a", encoding="utf-8") as f:
                f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")
        except:
            pass
    
    def log_raw_to_file(self, raw_text):
        """Save RAW OCR text to a separate file for analysis"""
        try:
            with open("ocr_raw_log.txt", "a", encoding="utf-8") as f:
                f.write(f"[{time.strftime('%H:%M:%S')}] {raw_text}\n")
        except:
            pass

if __name__ == "__main__":
    app = App()
    app.mainloop()
