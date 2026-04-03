import os
import hashlib
from PIL import Image

DATA_DIR = "training_data"

def get_file_hash(filepath):
    """Calculate MD5 hash of a file to detect exact duplicates."""
    hasher = hashlib.md5()
    with open(filepath, 'rb') as f:
        buf = f.read(65536)
        while len(buf) > 0:
            hasher.update(buf)
            buf = f.read(65536)
    return hasher.hexdigest()

def clean_data():
    if not os.path.exists(DATA_DIR):
        print("Folder not found.")
        return

    print("🧹 Cleaning Training Data...")
    
    files = sorted(os.listdir(DATA_DIR))
    images = [f for f in files if f.endswith(".png") or f.endswith(".jpg")]
    
    seen_hashes = set()
    seen_texts = set()
    deleted_count = 0
    
    # 1. Remove Strict Image Duplicates/Garbage
    for img_file in images:
        full_path = os.path.join(DATA_DIR, img_file)
        base_name = os.path.splitext(img_file)[0]
        
        # Check Image Hash
        try:
            img_hash = get_file_hash(full_path)
            
            # Check Text Content (from filename or gt.txt)
            # If text is exactly same as previous kept text, likely just a consecutive frame
            # We want SOME variety.
            gt_path = os.path.join(DATA_DIR, f"{base_name}.gt.txt")
            box_path = os.path.join(DATA_DIR, f"{base_name}.box")
            
            text_content = ""
            if os.path.exists(gt_path):
                with open(gt_path, 'r', encoding='utf-8') as f:
                    text_content = f.read().strip()
            
            # CRITERIA TO DELETE:
            # 1. Image is exact binary duplicate
            # 2. Text is garbage (length < 3 or only symbols)
            # 3. Consecutive Duplicate Text (Optional: keep 1-2 instances max)
            
            is_garbage_text = len(text_content) < 3 or not any(c.isalnum() for c in text_content)
            
            if img_hash in seen_hashes:
                # print(f"🗑️ Deleting Duplicate Image: {img_file}")
                os.remove(full_path)
                if os.path.exists(gt_path): os.remove(gt_path)
                if os.path.exists(box_path): os.remove(box_path)
                deleted_count += 1
                continue
                
            if is_garbage_text:
                # print(f"🗑️ Deleting Garbage Text: {img_file} ({text_content})")
                os.remove(full_path)
                if os.path.exists(gt_path): os.remove(gt_path)
                if os.path.exists(box_path): os.remove(box_path)
                deleted_count += 1
                continue

            # Keep it
            seen_hashes.add(img_hash)
            
        except Exception as e:
            print(f"Error checking {img_file}: {e}")

    # 2. Cleanup Orphan Files (files without their partner)
    all_files = os.listdir(DATA_DIR)
    for f in all_files:
        name, ext = os.path.splitext(f)
        if ext in ['.gt.txt', '.box']:
            # Check if corresponding image exists
            # Image can be .png or .jpg
            has_img = os.path.exists(os.path.join(DATA_DIR, name + ".png")) or \
                      os.path.exists(os.path.join(DATA_DIR, name + ".jpg"))
            
            # Special case for .gt.txt.txt double extension if any
            if not has_img:
                # print(f"🗑️ Deleting Orphan File: {f}")
                os.remove(os.path.join(DATA_DIR, f))
                deleted_count += 1

    print(f"✅ Cleanup Complete. Removed {deleted_count} junk/duplicate files.")

if __name__ == "__main__":
    clean_data()
