# vMix Google Sheet Controller

Web application to fetch data from Google Sheets, preview it, and export it for vMix.

## Features
- Fetch sheet names from a Google Spreadsheet.
- Preview data from a selected sheet.
- Export selected data to a CSV file (`data/vmix_data.csv`) that vMix can read as a Data Source.

## Setup Instructions

### 1. Prerequisites
- Node.js installed.

### 2. Google Sheets API Setup
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project.
3. Enable the **Google Sheets API**.
4. Go to **Credentials** > **Create Credentials** > **Service Account**.
5. Fill in details and click **Create**.
6. Under **Keys**, add a new key > **JSON**. This will download a file.
7. Rename the downloaded file to **`credentials.json`** and place it in this project folder (`c:\Users\mapay\Documents\project\test\รับบบเปลี่ยน ranking\`).
8. **Important:** Open your Google Sheet in browser, click **Share**, and share it with the `client_email` found inside your `credentials.json` file.

### 3. Installation
Open a terminal in this folder and run:
```sh
npm install
```

### 4. Running the App
Start the server:
```sh
node server.js
```
The app will be available at [http://localhost:3000](http://localhost:3000).

### 5. vMix Configuration
1. Open vMix.
2. Go to **Data Sources Manager**.
3. Click **Add** > **CSV/Text**.
4. Browse to `data/vmix_data.csv` (this file is created after you click "Send to vMix" in the web app).
5. Use the data in your titles/overlays!

## Usage
1. Enter your **Spreadsheet ID** (from the URL of your Google Sheet).
2. Click **Fetch Sheets**.
3. Select the sheet you want to use.
4. Verify the data in the preview table.
5. Click **Send to vMix** to update the CSV file.
