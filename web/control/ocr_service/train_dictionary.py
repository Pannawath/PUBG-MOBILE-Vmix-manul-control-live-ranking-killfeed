
import os
import re
from collections import Counter

# Configuration
LOG_FILE = 'ocr_log.txt'
RAW_LOG_FILE = 'ocr_raw_log.txt'
DICT_FILE = 'pubg.words'
MIN_WORD_LEN = 3
MIN_CONFIDENCE_COUNT = 2  # Words must appear at least this many times to be added (removes random noise)

def clean_word(word):
    """Deep cleaning of a word."""
    # Remove surrounding non-alphanumeric chars
    word = re.sub(r'^[^a-zA-Z0-9]+', '', word)
    word = re.sub(r'[^a-zA-Z0-9]+$', '', word)
    return word

def is_valid_candidate(word):
    """Check if word looks like a valid player/team name."""
    if len(word) < MIN_WORD_LEN:
        return False
    
    # Must contain at least one alphanumeric
    if not re.search(r'[a-zA-Z0-9]', word):
        return False
    
    # NEW: Reject single-letter + symbol combos (e.g. "p-", "x_")
    if len(word) < 4 and not word.isalnum():
        return False

    # NEW: Must have at least 2 consecutive letters
    if not re.search(r'[a-zA-Z]{2,}', word):
        return False
        
    # Ignore purely numeric words usually (unless specifically wanted, but often they are noise like '100')
    # Let's allow mixed or pure letters. Pure numbers might be score/time misreads.
    if word.isdigit() and len(word) < 4: 
        return False
        
    # Ignore common OCR noise patterns
    if re.fullmatch(r'[.|,;:\-_=+!@#$%^&*()\[\]{}]+', word):
        return False
    
    # Reject known icon residue words
    if word.lower() in ['gee', 'gw', 'ff', 'of', 'fw', 'ge', 'og', 'sr', 'sy', 'gn', 'gv']:
        return False
        
    return True

def train_dictionary():
    print("READING LOGS to extract Player/Team names...")
    
    word_counter = Counter()
    
    # 1. Process High Confidence Log (ocr_log.txt) & Backup
    # Format: [Time] 🔫 Killer -> Victim (Action)
    log_files = [LOG_FILE, f'backup_legacy_ocr/{LOG_FILE}']
    
    for log_path in log_files:
        if os.path.exists(log_path):
            print(f"Processing {log_path}...")
            try:
                with open(log_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        # Extract Killer and Victim
                        match = re.search(r'🔫\s+(.*?)\s+->\s+(.*?)\s+\(', line)
                        if match:
                            k, v = match.groups()
                            if is_valid_candidate(k): word_counter[k] += 10 # High weight for verified logs
                            if is_valid_candidate(v): word_counter[v] += 10
            except Exception as e:
                print(f"Error reading {log_path}: {e}")

    # 2. Process Raw Log (ocr_raw_log.txt) & Backup
    # Format: [Time] RAW [Timestamp]: Text Content
    raw_files = [RAW_LOG_FILE, f'backup_legacy_ocr/{RAW_LOG_FILE}']
    
    for raw_path in raw_files:
        if os.path.exists(raw_path):
            print(f"Processing {raw_path}...")
            try:
                with open(raw_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        if "RAW" not in line: continue
                        
                        # Extract the text part (after the timestamp bracket)
                        parts = line.split(']: ', 1)
                        if len(parts) < 2: continue
                        
                        text_content = parts[1].strip()
                        
                        # Split into potential words
                        words = re.split(r'\s+', text_content)
                        
                        for raw_word in words:
                            clean = clean_word(raw_word)
                            if is_valid_candidate(clean):
                                word_counter[clean] += 1
            except Exception as e:
                print(f"Error reading {raw_path}: {e}")

    # Filter Dictionary
    final_words = []
    print(f"Total unique candidates found: {len(word_counter)}")
    
    for word, count in word_counter.most_common():
        # Keep words that appear frequently enough or come from high-confidence logs (count >= 10)
        if count >= MIN_CONFIDENCE_COUNT:
            final_words.append(word)

    final_words.sort()
    
    # Write to file
    with open(DICT_FILE, 'w', encoding='utf-8') as f:
        f.write('\n'.join(final_words))
        
    print(f"✅ Generated Dictionary: {len(final_words)} words saved to {DICT_FILE}")
    
    # Optional: Preview top words
    print("Top detected words:")
    for w, c in word_counter.most_common(10):
        print(f" - {w}: {c}")

if __name__ == "__main__":
    train_dictionary()
