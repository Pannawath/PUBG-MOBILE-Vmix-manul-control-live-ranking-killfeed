import os
import urllib.request
import ssl

# Bypass SSL errors just in case
ssl._create_default_https_context = ssl._create_unverified_context

# Languages to download (using tessdata_best for accuracy)
LANGS = {
    'tha': 'https://github.com/tesseract-ocr/tessdata_best/raw/main/tha.traineddata',
    'eng': 'https://github.com/tesseract-ocr/tessdata_best/raw/main/eng.traineddata',
    'ind': 'https://github.com/tesseract-ocr/tessdata_best/raw/main/ind.traineddata',
    'vie': 'https://github.com/tesseract-ocr/tessdata_best/raw/main/vie.traineddata',
    'chi_sim': 'https://github.com/tesseract-ocr/tessdata_best/raw/main/chi_sim.traineddata',
    'kor': 'https://github.com/tesseract-ocr/tessdata_best/raw/main/kor.traineddata',
    'jpn': 'https://github.com/tesseract-ocr/tessdata_best/raw/main/jpn.traineddata'
}

DEST_DIR = "tessdata"

def download_langs():
    if not os.path.exists(DEST_DIR):
        try:
            os.makedirs(DEST_DIR)
        except:
            pass
        
    print(f"📥 Starting download of {len(LANGS)} languages to '{os.path.abspath(DEST_DIR)}'...")
    
    for lang, url in LANGS.items():
        dest_file = os.path.join(DEST_DIR, f"{lang}.traineddata")
        
        # Check size if exists (to avoid partials)
        if os.path.exists(dest_file) and os.path.getsize(dest_file) > 1000000:
            print(f"✅ {lang} already exists. Skipping.")
            continue
            
        print(f"⬇️ Downloading {lang}...")
        try:
            urllib.request.urlretrieve(url, dest_file)
            print(f"✅ Downloaded {lang}")
        except Exception as e:
            print(f"❌ Failed to download {lang}: {e}")

    print("\n🎉 All downloads processed.")

if __name__ == "__main__":
    download_langs()
