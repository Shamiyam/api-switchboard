import React, { useState } from 'react';
import useAppStore from '../store/appStore';

function Settings() {
  const {
    config, setConfigValue, setShowSettings,
    googleAuth, setGoogleAuth
  } = useAppStore();

  const [saving, setSaving] = useState(false);
  const [authStatus, setAuthStatus] = useState(null);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (window.switchboard) {
        await window.switchboard.setConfig('n8nWebhookUrl', config.n8nWebhookUrl);
        await window.switchboard.setConfig('googleClientId', config.googleClientId);
        await window.switchboard.setConfig('googleClientSecret', config.googleClientSecret);
        await window.switchboard.setConfig('googleScriptId', config.googleScriptId);
      }
      setSaving(false);
    } catch {
      setSaving(false);
    }
  };

  const handleGoogleAuth = async () => {
    if (!window.switchboard) {
      setAuthStatus('Electron required for OAuth');
      return;
    }

    // Save credentials first
    await window.switchboard.setConfig('googleClientId', config.googleClientId);
    await window.switchboard.setConfig('googleClientSecret', config.googleClientSecret);

    setAuthStatus('Opening browser for Google sign-in...');
    const result = await window.switchboard.googleAuthStart();

    if (result.success) {
      setGoogleAuth({ authenticated: true, tokens: result.tokens });
      setAuthStatus('Authenticated successfully!');
    } else {
      setAuthStatus(`Auth failed: ${result.error}`);
    }
  };

  const handleDisconnect = async () => {
    if (window.switchboard) {
      await window.switchboard.deleteConfig('googleTokens');
    }
    setGoogleAuth({ authenticated: false, tokens: null });
    setAuthStatus('Disconnected from Google');
  };

  return (
    <div className="modal-overlay" onClick={() => setShowSettings(false)}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="btn btn-ghost modal-close" onClick={() => setShowSettings(false)}>
            X
          </button>
        </div>

        <div className="modal-body settings-body">
          {/* n8n Section */}
          <section className="settings-section">
            <h3>n8n Configuration</h3>
            <label className="form-label">
              Default Webhook URL
              <input
                className="form-input"
                type="url"
                value={config.n8nWebhookUrl}
                onChange={(e) => setConfigValue('n8nWebhookUrl', e.target.value)}
                placeholder="https://your-n8n.com/webhook/..."
              />
            </label>
          </section>

          {/* Google Section */}
          <section className="settings-section">
            <h3>Google Cloud / Apps Script</h3>
            <p className="settings-hint">
              Create a GCP project, enable Apps Script API, and generate OAuth 2.0 credentials
              (Desktop app type). Set the redirect URI to <code>http://localhost:8234/callback</code>.
            </p>

            <label className="form-label">
              Client ID
              <input
                className="form-input"
                type="text"
                value={config.googleClientId}
                onChange={(e) => setConfigValue('googleClientId', e.target.value)}
                placeholder="xxxx.apps.googleusercontent.com"
              />
            </label>

            <label className="form-label">
              Client Secret
              <input
                className="form-input"
                type="password"
                value={config.googleClientSecret}
                onChange={(e) => setConfigValue('googleClientSecret', e.target.value)}
                placeholder="GOCSPX-..."
              />
            </label>

            <label className="form-label">
              Script ID
              <input
                className="form-input"
                type="text"
                value={config.googleScriptId}
                onChange={(e) => setConfigValue('googleScriptId', e.target.value)}
                placeholder="Script ID from Apps Script project"
              />
            </label>

            <div className="auth-actions">
              <div className="auth-status">
                {googleAuth.authenticated
                  ? <span className="status-badge success">Connected to Google</span>
                  : <span className="status-badge neutral">Not connected</span>
                }
              </div>

              {!googleAuth.authenticated ? (
                <button
                  className="btn btn-primary"
                  onClick={handleGoogleAuth}
                  disabled={!config.googleClientId || !config.googleClientSecret}
                >
                  Authenticate with Google
                </button>
              ) : (
                <button className="btn btn-danger" onClick={handleDisconnect}>
                  Disconnect
                </button>
              )}
            </div>

            {authStatus && <p className="auth-message">{authStatus}</p>}
          </section>

          {/* Save */}
          <div className="settings-footer">
            <button className="btn btn-primary btn-full" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save All Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
