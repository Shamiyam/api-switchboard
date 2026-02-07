# API Switchboard

A desktop app (Electron + React) that parses cURL commands, executes API calls, handles pagination automatically, and transports data to **Google Sheets** or **n8n** workflows.

Built for developers and data teams who need to pull paginated API data and route it somewhere useful.

---

## Features

- **cURL Parser** - Paste any cURL command, auto-detects method, headers, params, body
- **API Executor** - Fetch data through Electron (no CORS) or browser dev proxy
- **Auto Pagination** - Detects page-based (`page`, `offset`) and cursor-based (`paging.next`, `since_id`, `nextPageToken`) pagination from 12+ API patterns
- **Rate Limiting** - Configurable delay between requests, auto-retry on 429 with exponential backoff
- **Bulk Transport** - Automatically fetch ALL pages and send each batch to Google Sheets or n8n
- **Export** - Single-page export to n8n webhook or Google Apps Script
- **Dark Theme** - n8n-inspired dark UI

---

## Quick Start

```bash
# Clone the repo
git clone https://github.com/Shamiyam/api-switchboard.git
cd api-switchboard

# Install dependencies
npm install

# Run in browser dev mode (no Electron needed)
npm run dev
# Opens at http://localhost:5173

# Or run as Electron desktop app
npm start
```

---

## How to Use

### 1. Paste a cURL Command

Copy a cURL command from your browser DevTools, Postman, or API docs. Paste it into the input area.

**Example:**
```bash
curl -X GET "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=10&page=1" \
  -H "accept: application/json"
```

Click **"Parse cURL"** - the app auto-detects the method, URL, headers, query params, and pagination parameters.

### 2. Fetch Data

Click **"Fetch Data"** to execute the API call. The response view shows:
- Status code, response size, item count, timing
- Pretty / Raw / Headers view tabs
- Search/filter within the JSON response

### 3. Navigate Pages

If pagination is detected, you'll see a pagination bar with:
- **Prev / Next** buttons
- **Per page** selector (5, 10, 20, 50, 100)
- **Mode indicator**: `page` (number-based) or `cursor` (token/URL-based)

### 4. Export a Single Page

Click **"Export Page"** to send the current page's data to:
- **n8n Webhook** - POST data to any n8n workflow trigger
- **Google Apps Script** - Execute a script to write data to Google Sheets

### 5. Bulk Transport (All Pages)

Click **"Bulk Transport All"** to automatically fetch every page and send data to your destination.

**Transport modes:**
- **All Pages** - Fetches from first page to last, sends everything
- **Specific Number of Pages** - Set a limit (e.g. fetch and send 5 pages)
- **Date Range** - Only transport items where a date field falls within your specified range

The progress view shows real-time stats: current page, pages sent, items sent, errors, and a scrolling transport log.

---

## Connecting to Google Sheets (3-Step Setup)

No GCP project, no OAuth credentials, no API keys needed. Just deploy a Web App.

### Step 1: Create a Google Sheet with the Receiver Script

1. Create a new Google Sheet (or open an existing one)
2. Go to **Extensions > Apps Script**
3. Delete any existing code and paste the contents of [`scripts/google-apps-script-receiver.js`](scripts/google-apps-script-receiver.js) from this repo
4. Click **Save** (Ctrl+S)

### Step 2: Deploy as a Web App

1. In the Apps Script editor, click **Deploy > New Deployment**
2. Click the gear icon next to "Select type" and choose **"Web app"**
3. Set **"Execute as"**: Me
4. Set **"Who has access"**: Anyone
5. Click **Deploy**
6. If prompted to authorize, click **Review Permissions** and grant access
7. Copy the **Web App URL** (looks like `https://script.google.com/macros/s/AKfycb.../exec`)

### Step 3: Transport Data

1. Paste your cURL command into API Switchboard and click **"Fetch Data"**
2. Click **"Bulk Transport All"** in the response view
3. Choose **"Google Sheets"** as the destination
4. Paste your **Web App URL** from Step 2
5. Select your transport mode:
   - **All Pages** - fetch and send everything
   - **Specific Number of Pages** - set a page limit
   - **Date Range** - filter items by a date field
6. Click **"Start Bulk Transport"**
7. Watch the live progress log as each page is fetched and sent
8. Open your Google Sheet - you'll see an **"API_Data"** tab with all your data

> **How it works:** The app POSTs each page of API data directly to your deployed Apps Script Web App. The script auto-creates an "API_Data" sheet, generates headers from the JSON keys, and batch-writes all rows with timestamps. No OAuth flow, no GCP setup - the Web App URL is all you need.

---

## Connecting to n8n (Step-by-Step)

### Step 1: Create an n8n Webhook Workflow

1. Open your n8n instance
2. Create a new workflow
3. Add a **Webhook** trigger node
4. Set the method to **POST**
5. Copy the **Test URL** or **Production URL**

### Step 2: Use in API Switchboard

1. Paste your cURL and fetch data
2. Click **"Bulk Transport All"** (or **"Export Page"** for single page)
3. Choose **"n8n Webhook"**
4. Paste the webhook URL
5. Click **"Start Bulk Transport"**

Each page of data is sent as a POST request to your n8n webhook, where you can process, transform, or route it further.

---

## Rate Limiting

Configure rate limiting in the input panel:

- **Delay between requests**: 0ms to 5 seconds (default: 500ms)
- **Auto-retry on 429**: When an API returns HTTP 429 (Too Many Requests), the app waits and retries with exponential backoff (up to 3 retries)
- **Rate limit display**: The response view shows remaining quota and reset time from API headers

---

## Supported Pagination Patterns

The app auto-detects these pagination styles:

| Style | Parameters | APIs |
|-------|-----------|------|
| Page-number | `page`, `per_page` | CoinGecko, GitHub, most REST APIs |
| Offset | `offset`, `limit` | Stripe, Elasticsearch |
| Cursor URL | `paging.next` (full URL) | Workable, Facebook Graph |
| Cursor token | `next_cursor`, `since_id` | Twitter, Slack |
| Page token | `nextPageToken` | Google APIs |
| HAL links | `_links.next.href` | HAL-style APIs |

---

## Project Structure

```
api-switchboard/
  src/
    main/
      main.js          # Electron main process, IPC handlers
      preload.js       # Context bridge (window.switchboard)
    renderer/
      App.jsx          # Root component
      components/
        Header.jsx     # App header with tabs
        CurlInput.jsx  # cURL input + parser + fetch engine
        RequestPreview.jsx   # Parsed request display
        ResponseViewer.jsx   # Response viewer + pagination
        ExportModal.jsx      # Single-page export modal
        BulkTransportModal.jsx  # Bulk transport modal + engine
        Settings.jsx   # Google/n8n configuration
        StatusBar.jsx  # Bottom status bar
      store/
        appStore.js    # Zustand state management
      utils/
        curlParser.js  # cURL command parser
      styles/
        global.css     # Full dark theme styles
  scripts/
    google-apps-script-receiver.js  # Apps Script for Google Sheets
  vite.config.js       # Vite config with CORS proxy plugin
  package.json
```

---

## Tech Stack

- **Electron** - Desktop shell
- **React** - UI framework
- **Vite** - Build tool with custom CORS proxy plugin
- **Zustand** - State management
- **Axios** - HTTP client (Electron main process)
- **electron-store v8** - Encrypted config storage
- **google-auth-library** - Google OAuth2

---

## Development

```bash
# Browser dev mode (no Electron, uses Vite CORS proxy)
npm run dev

# Electron dev mode
npm start

# Build for production
npm run build
```

**Browser dev mode** routes API calls through a Vite proxy at `/api-proxy/{url}` to bypass CORS. No Electron needed for development.

---

## License

MIT
