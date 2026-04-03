# vMix Title & Timer Setup Guide

This system generates text files that vMix can use as Data Sources to display dynamic information.

## 1. File Locations
All files are generated in:  
`c:\Users\mapay\Desktop\PUBG LIVE\web\control\server\vmix\`

## 2. Timer Setup (Countdown)
1. In vMix, add a **Title** input that has a text field for the time.
2. In vMix, go to **Data Manager** (Hamburger Menu -> Data Manager).
3. Add a new Data Source:
   - Type: **Text**
   - File: `...server\vmix\timer.txt`
   - Name: `PUBG Timer`
4. Go to your Title Input settings -> **Title Editor**.
5. Select the Time text field.
6. Click **Data Source**:
   - Source: `PUBG Timer`
   - Column: `Column1` (or whatever the text file content is mapped to)

*Note: The system writes "MM:SS" (e.g., 10:00) to `timer.txt`.*

## 3. Map & Winner Setup (Text & Images)
The system now generates both **Text** (Names) and **Image Paths** (File Links).

| Content | File Name | Description |
| :--- | :--- | :--- |
| **Map Name** | `map_1.txt` | Text: "Erangel", "Miramar" |
| **Map Image** | `map_img_1.txt` | Path: `C:\...\pic\map\map1\ERANGEL.png` |
| **Winner Name** | `winner_1.txt` | Text: "Team Name" |
| **Winner Tag** | `winner_team_1.txt`| Text: "TAG" |
| **Winner Logo** | `winner_logo_1.txt`| Path: `C:\...\team_logos\TAG.png` |

### How to use Image Paths in vMix:
1. Add an **Image** Input or a Title with an Image element.
2. Go to **Data Manager** and add sources for the Image Text Files (e.g., `MapImg1`).
3. In the Input Settings (Title Editor or Image logic):
   - You can verify if vMix supports direct "Image Source" binding from a Text Data Source (which contains the path).
   - **Alternative**: Use vMix scripting or "Dynamic Image" feature if Data Source direct binding doesn't update the image automatically.
   
   *Tip: Most modern vMix versions allow binding an Image Element's "Source" to a Data Source that contains a file path.*

## 4. Using the Dashboard
1. Go to **vMix Control** tab.
2. **Timer**: Set Minutes/Seconds -> SET -> START.
3. **Matches**: Select Map and Winner. The files will update immediately.
