const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');

// Encrypted store for tokens and config (electron-store v8 - CJS compatible)
const store = new Store({
  name: 'api-switchboard-config',
  encryptionKey: 'api-switchboard-v1-secure',
  defaults: {
    n8nWebhookUrl: '',
    googleClientId: '',
    googleClientSecret: '',
    googleScriptId: '',
    googleTokens: {},
    savedRequests: []
  }
});

let mainWindow;
let oauthClient;

const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'API Switchboard',
    backgroundColor: '#0f0f23',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

// ──────────────────────────────────────────────
// IPC: Execute API Request (Layer 2 - Fetcher)
// ──────────────────────────────────────────────
ipcMain.handle('execute-request', async (event, requestConfig) => {
  try {
    const { method, url, headers, data, params } = requestConfig;

    const response = await axios({
      method: method || 'GET',
      url,
      headers: headers || {},
      data: data || undefined,
      params: params || undefined,
      timeout: 30000,
      validateStatus: () => true // Accept all status codes
    });

    return {
      success: true,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.data,
      timing: Date.now()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      code: error.code || 'UNKNOWN'
    };
  }
});

// ──────────────────────────────────────────────
// IPC: Send to n8n Webhook (Layer 3 - Route A)
// ──────────────────────────────────────────────
ipcMain.handle('send-to-n8n', async (event, { webhookUrl, data }) => {
  try {
    const payload = {
      source: 'API Switchboard',
      timestamp: new Date().toISOString(),
      data
    };

    const response = await axios.post(webhookUrl, payload, {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' }
    });

    return { success: true, status: response.status, data: response.data };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ──────────────────────────────────────────────
// IPC: Google OAuth Flow (Layer 3 - Route B)
// ──────────────────────────────────────────────
ipcMain.handle('google-auth-start', async () => {
  const clientId = store.get('googleClientId');
  const clientSecret = store.get('googleClientSecret');

  if (!clientId || !clientSecret) {
    return { success: false, error: 'Google Client ID and Secret not configured. Go to Settings.' };
  }

  oauthClient = new OAuth2Client(clientId, clientSecret, 'http://localhost:8234/callback');

  const authUrl = oauthClient.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/script.projects'
    ],
    prompt: 'consent'
  });

  // Open auth URL in system browser
  shell.openExternal(authUrl);

  // Start local callback server
  return new Promise((resolve) => {
    const http = require('http');
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost:8234');
      const code = url.searchParams.get('code');

      if (code) {
        try {
          const { tokens } = await oauthClient.getToken(code);
          oauthClient.setCredentials(tokens);
          store.set('googleTokens', tokens);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html><body style="font-family:sans-serif;background:#0f0f23;color:#0ff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
              <div style="text-align:center">
                <h1>Authenticated!</h1>
                <p>You can close this tab and return to API Switchboard.</p>
              </div>
            </body></html>
          `);
          server.close();
          resolve({ success: true, tokens });
        } catch (err) {
          res.writeHead(400);
          res.end('Auth failed');
          server.close();
          resolve({ success: false, error: err.message });
        }
      }
    });

    server.listen(8234, () => {
      console.log('OAuth callback server listening on :8234');
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      resolve({ success: false, error: 'OAuth timed out (2 min)' });
    }, 120000);
  });
});

ipcMain.handle('google-auth-check', async () => {
  const tokens = store.get('googleTokens');
  if (!tokens || !tokens.access_token) {
    return { authenticated: false };
  }

  // Check if token is expired
  if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
    // Try to refresh
    const clientId = store.get('googleClientId');
    const clientSecret = store.get('googleClientSecret');
    if (tokens.refresh_token && clientId && clientSecret) {
      try {
        const client = new OAuth2Client(clientId, clientSecret, 'http://localhost:8234/callback');
        client.setCredentials(tokens);
        const { credentials } = await client.refreshAccessToken();
        store.set('googleTokens', credentials);
        return { authenticated: true, tokens: credentials };
      } catch {
        return { authenticated: false };
      }
    }
    return { authenticated: false };
  }

  return { authenticated: true, tokens };
});

// ──────────────────────────────────────────────
// IPC: Send to Google Apps Script (Layer 3 - Route B)
// ──────────────────────────────────────────────
ipcMain.handle('send-to-appscript', async (event, { scriptId, data }) => {
  try {
    let tokens = store.get('googleTokens');

    if (!tokens || !tokens.access_token) {
      return { success: false, error: 'Not authenticated with Google. Please authenticate first.' };
    }

    // Refresh if expired
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      const clientId = store.get('googleClientId');
      const clientSecret = store.get('googleClientSecret');
      const client = new OAuth2Client(clientId, clientSecret, 'http://localhost:8234/callback');
      client.setCredentials(tokens);
      const { credentials } = await client.refreshAccessToken();
      tokens = credentials;
      store.set('googleTokens', tokens);
    }

    const response = await axios.post(
      `https://script.googleapis.com/v1/scripts/${scriptId}:run`,
      {
        function: 'receiveData',
        parameters: [JSON.stringify(data)]
      },
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    if (response.data.error) {
      return { success: false, error: response.data.error.message || 'Script execution failed' };
    }

    return { success: true, result: response.data.response?.result || 'Data sent successfully' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ──────────────────────────────────────────────
// IPC: Settings/Store Operations
// ──────────────────────────────────────────────
ipcMain.handle('store-get', (event, key) => store.get(key));
ipcMain.handle('store-set', (event, key, value) => store.set(key, value));
ipcMain.handle('store-delete', (event, key) => store.delete(key));

// ──────────────────────────────────────────────
// App Lifecycle
// ──────────────────────────────────────────────
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
