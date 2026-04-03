import cv2
import pytesseract
import numpy as np
import json
import re
import sys
import os
import glob

# Set Tesseract Path
try:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(script_dir, 'ocr_config.json')
    with open(config_path, 'r') as f:
        config = json.load(f)
        pytesseract.pytesseract.tesseract_cmd = config.get('tesseract_cmd', r"C:\Program Files\Tesseract-OCR\tesseract.exe")
except:
    pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


def sum_kills_from_text(text):
    """Extract and sum all kill numbers from text"""
    total = 0
    
    # Pattern: "X elimination(s)" 
    matches = re.findall(r'(\d+)\s*elimination', text, re.IGNORECASE)
    for m in matches:
        total += int(m)
    
    # Pattern: "X elim" (OCR might misread)
    if total == 0:
        matches = re.findall(r'(\d+)\s*elim', text, re.IGNORECASE)
        for m in matches:
            total += int(m)
    
    return total


def extract_rank_number(text):
    """Extract rank number from text"""
    # Clean text and extract digits
    nums = re.findall(r'\d+', text)
    if nums:
        return int(nums[0])
    return None


def extract_from_image(image_path, mode='all'):
    """Extract Rank and Total Kills from PUBG scoreboard image."""
    try:
        if not os.path.exists(image_path):
            print(f"Error: File not found: {image_path}", file=sys.stderr)
            return []

        img = cv2.imread(image_path)
        if img is None:
            print(f"Error: Could not read image: {image_path}", file=sys.stderr)
            return []

        h, w = img.shape[:2]
        print(f"Processing: {image_path} ({w}x{h}) [mode: {mode}]", file=sys.stderr)
        
        results = []
        
        # Layout: Left side = 52%, Right side = 48%
        mid_x = int(w * 0.52)
        
        # === LEFT SIDE: Rank 1 & 2 ===
        if mode in ['top', 'all']:
            # Rank 1: Top half of left side
            r1_roi = img[int(h*0.08):int(h*0.42), int(w*0.05):mid_x]
            kills1 = extract_kills_from_roi(r1_roi, "Rank 1")
            results.append({"Rank": 1, "TotalKills": kills1})
            
            # Rank 2: Bottom half of left side
            r2_roi = img[int(h*0.45):int(h*0.85), int(w*0.05):mid_x]
            kills2 = extract_kills_from_roi(r2_roi, "Rank 2")
            results.append({"Rank": 2, "TotalKills": kills2})
        
        # === RIGHT SIDE: Multiple team rows ===
        if mode in ['list', 'all']:
            right_roi = img[int(h*0.05):int(h*0.90), mid_x:w]
            right_results = extract_right_side_fixed(right_roi)
            results.extend(right_results)

        return results
        
    except Exception as e:
        print(f"Error processing {image_path}: {e}", file=sys.stderr)
        return []


def extract_kills_from_roi(roi, label=""):
    """Extract total kills from a ROI"""
    try:
        if roi.size == 0:
            return 0
        
        # Convert to grayscale
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        
        # Binary threshold for white text
        _, thresh = cv2.threshold(gray, 140, 255, cv2.THRESH_BINARY)
        
        # OCR
        text = pytesseract.image_to_string(thresh, config='--psm 6')
        kills = sum_kills_from_text(text)
        
        print(f"[{label}] Kills: {kills}", file=sys.stderr)
        return kills
        
    except Exception as e:
        print(f"Error extracting kills: {e}", file=sys.stderr)
        return 0


def extract_right_side_fixed(roi):
    """
    Extract ranks and kills from right side using fixed grid positions.
    Assumes 3 team rows visible at a time.
    """
    try:
        if roi.size == 0:
            return []
        
        h, w = roi.shape[:2]
        results = []
        
        # The right side typically shows 3 teams
        # Each team row is roughly 1/3 of the height
        row_height = h // 3
        
        for i in range(3):
            y_start = i * row_height
            y_end = (i + 1) * row_height
            
            # Team row ROI
            row_roi = roi[y_start:y_end, :]
            
            if row_roi.size == 0:
                continue
            
            row_h, row_w = row_roi.shape[:2]
            
            # === Extract Rank from left side (gold block area) ===
            # Gold block is roughly the first 15% of the row width
            rank_block_roi = row_roi[:, :int(row_w * 0.15)]
            gray_rank = cv2.cvtColor(rank_block_roi, cv2.COLOR_BGR2GRAY)
            _, thresh_rank = cv2.threshold(gray_rank, 200, 255, cv2.THRESH_BINARY)
            
            rank_text = pytesseract.image_to_string(thresh_rank, config='--psm 7 digits')
            rank = extract_rank_number(rank_text)
            
            if rank is None:
                # Fallback: estimate from position
                rank = 3 + i  # Default starting rank
            
            # === Extract Kills from right side (eliminations column) ===
            # Eliminations are on the right ~25% of the row
            text_roi = row_roi[:, int(row_w * 0.15):]
            gray_text = cv2.cvtColor(text_roi, cv2.COLOR_BGR2GRAY)
            _, thresh_text = cv2.threshold(gray_text, 140, 255, cv2.THRESH_BINARY)
            
            text = pytesseract.image_to_string(thresh_text, config='--psm 6')
            kills = sum_kills_from_text(text)
            
            print(f"[Row {i+1}] Rank: {rank}, Kills: {kills}", file=sys.stderr)
            
            results.append({"Rank": rank, "TotalKills": kills})
        
        return results
        
    except Exception as e:
        print(f"Error in extract_right_side: {e}", file=sys.stderr)
        return []


def main():
    try:
        if len(sys.argv) < 2:
            print("[]")
            return

        path = sys.argv[1]
        mode = sys.argv[2] if len(sys.argv) > 2 else 'all'
        
        all_results = []

        if os.path.isdir(path):
            exts = ['*.png', '*.jpg', '*.jpeg', '*.PNG', '*.JPG', '*.JPEG']
            files = []
            for ext in exts:
                files.extend(glob.glob(os.path.join(path, ext)))
            
            print(f"Found {len(files)} images to process", file=sys.stderr)
            
            for f in sorted(files):
                res = extract_from_image(f, mode)
                all_results.extend(res)
        else:
            all_results = extract_from_image(path, mode)
        
        # Remove duplicates (keep higher kills for same rank)
        unique = {}
        for t in all_results:
            rank = t['Rank']
            if rank not in unique or t['TotalKills'] > unique[rank]['TotalKills']:
                unique[rank] = t
        
        final_results = sorted(unique.values(), key=lambda x: x['Rank'])
        
        print(f"Total unique ranks found: {len(final_results)}", file=sys.stderr)
        
        # Output JSON to stdout
        print(json.dumps(final_results, ensure_ascii=False))
        
    except Exception as e:
        print(f"Fatal error: {e}", file=sys.stderr)
        print("[]")


if __name__ == "__main__":
    main()
