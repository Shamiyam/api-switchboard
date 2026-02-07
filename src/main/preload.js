const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld('switchboard', {
  // Layer 2: Execute API request
  executeRequest: (config) => ipcRenderer.invoke('execute-request', config),

  // Layer 3A: Send to n8n
  sendToN8n: (webhookUrl, data) => ipcRenderer.invoke('send-to-n8n', { webhookUrl, data }),

  // Layer 3B: Google OAuth
  googleAuthStart: () => ipcRenderer.invoke('google-auth-start'),
  googleAuthCheck: () => ipcRenderer.invoke('google-auth-check'),

  // Layer 3B: Send to Google Apps Script
  sendToAppScript: (scriptId, data) => ipcRenderer.invoke('send-to-appscript', { scriptId, data }),

  // Settings store
  getConfig: (key) => ipcRenderer.invoke('store-get', key),
  setConfig: (key, value) => ipcRenderer.invoke('store-set', key, value),
  deleteConfig: (key) => ipcRenderer.invoke('store-delete', key)
});
