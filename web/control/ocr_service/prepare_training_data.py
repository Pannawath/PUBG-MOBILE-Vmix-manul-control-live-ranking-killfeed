import os
import subprocess
import pathlib

# CONFIG
TESS_CMD = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
DATA_DIR = "training_data"

def prepare_data():
    if not os.path.exists(DATA_DIR):
        print(f"❌ Error: Directory '{DATA_DIR}' not found.")
        return

    print(f"📂 Scanning {DATA_DIR}...")
    
    files = [f for f in os.listdir(DATA_DIR) if f.endswith(".png") or f.endswith(".jpg")]
    count = 0
    
    for file in files:
        base_name = os.path.splitext(file)[0]
        full_path = os.path.join(DATA_DIR, file)
        
        # 1. Extract Ground Truth from Filename
        # Format: 173..._SomeText.png
        # We need "SomeText"
        parts = base_name.split('_', 1)
        if len(parts) > 1:
            gt_text = parts[1].replace('_', ' ') # Retrieve original text
        else:
            gt_text = parts[0]
            
        # 2. Create .gt.txt file (The "Answer Key")
        gt_path = os.path.join(DATA_DIR, f"{base_name}.gt.txt")
        with open(gt_path, 'w', encoding='utf-8') as f:
            f.write(gt_text)
            
        # 3. Generate .box file (The "Coordinates") using Tesseract
        # Command: tesseract image.png base_name -l eng --psm 7 batch.nochop makebox
        output_base = os.path.join(DATA_DIR, base_name)
        cmd = [
            TESS_CMD,
            full_path,
            output_base,
            "-l", "eng",
            "--psm", "7",
            "batch.nochop",
            "makebox"
        ]
        
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            count += 1
            print(f"✅ Prepared: {gt_text}")
        except Exception as e:
            print(f"❌ Failed to box {file}: {e}")

    print(f"\n🎉 Processed {count} images.")
    print("⚠️  NEXT STEPS FOR FULL TRAINING:")
    print("1.  Download 'jTessBoxEditor' to verify the .box files match the images.")
    print("2.  Use a tool like 'tesstrain' (requires Linux/WSL) to create the .traineddata file.")
    print("   (Unfortunately, full Tesseract training on Windows CMD is extremely difficult and error-prone without WSL)")

if __name__ == "__main__":
    prepare_data()
