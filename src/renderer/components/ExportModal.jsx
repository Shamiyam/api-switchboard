import React, { useState } from 'react';
import useAppStore from '../store/appStore';

function ExportModal() {
  const {
    apiResponse, config, setShowExportModal,
    isExporting, setIsExporting, setExportResult, setExportError,
    exportResult, exportError, googleAuth
  } = useAppStore();

  const [target, setTarget] = useState(null); // 'n8n' | 'appscript'
  const [localWebhook, setLocalWebhook] = useState(config.n8nWebhookUrl || '');
  const [localScriptId, setLocalScriptId] = useState(config.googleScriptId || '');

  const handleExport = async () => {
    setIsExporting(true);
    setExportResult(null);
    setExportError(null);

    try {
      if (target === 'n8n') {
        if (!localWebhook) {
          setExportError('Please enter an n8n Webhook URL');
          setIsExporting(false);
          return;
        }

        // Save the webhook URL
        if (window.switchboard) {
          await window.switchboard.setConfig('n8nWebhookUrl', localWebhook);
        }

        const result = window.switchboard
          ? await window.switchboard.sendToN8n(localWebhook, apiResponse.data)
          : { success: true, status: 200, data: 'Dev mode - simulated' };

        if (result.success) {
          setExportResult(`Sent to n8n successfully! Status: ${result.status}`);
        } else {
          setExportError(`n8n error: ${result.error}`);
        }

      } else if (target === 'appscript') {
        if (!localScriptId) {
          setExportError('Please enter a Google Script ID');
          setIsExporting(false);
          return;
        }

        if (!googleAuth.authenticated) {
          setExportError('Not authenticated with Google. Go to Settings and authenticate first.');
          setIsExporting(false);
          return;
        }

        // Save the script ID
        if (window.switchboard) {
          await window.switchboard.setConfig('googleScriptId', localScriptId);
        }

        const result = window.switchboard
          ? await window.switchboard.sendToAppScript(localScriptId, apiResponse.data)
          : { success: true, result: 'Dev mode - simulated' };

        if (result.success) {
          setExportResult(`Google Script executed! Result: ${result.result}`);
        } else {
          setExportError(`Script error: ${result.error}`);
        }
      }
    } catch (err) {
      setExportError(err.message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Export Data</h2>
          <button className="btn btn-ghost modal-close" onClick={() => setShowExportModal(false)}>
            X
          </button>
        </div>

        {!target && (
          <div className="modal-body">
            <p className="modal-subtitle">Select your export pipeline:</p>

            <div className="export-options">
              <button className="export-card" onClick={() => setTarget('n8n')}>
                <div className="export-card-icon">n8n</div>
                <h3>n8n Webhook</h3>
                <p>Send data to an n8n workflow via webhook trigger</p>
              </button>

              <button className="export-card" onClick={() => setTarget('appscript')}>
                <div className="export-card-icon">GAS</div>
                <h3>Google Apps Script</h3>
                <p>Execute a Google Script to write data to Google Sheets</p>
                {!googleAuth.authenticated && (
                  <span className="badge-warning">Not authenticated</span>
                )}
              </button>
            </div>
          </div>
        )}

        {target === 'n8n' && (
          <div className="modal-body">
            <button className="btn btn-ghost btn-small back-btn" onClick={() => setTarget(null)}>
              Back
            </button>
            <h3>n8n Webhook</h3>
            <p>Enter the webhook URL from your n8n workflow trigger node.</p>

            <label className="form-label">
              Webhook URL
              <input
                className="form-input"
                type="url"
                value={localWebhook}
                onChange={(e) => setLocalWebhook(e.target.value)}
                placeholder="https://your-n8n.com/webhook/abc-123"
              />
            </label>

            <div className="modal-preview">
              <h4>Payload Preview</h4>
              <pre className="code-block code-small">
                {JSON.stringify({
                  source: 'API Switchboard',
                  timestamp: new Date().toISOString(),
                  data: '{ ... your API response ... }'
                }, null, 2)}
              </pre>
            </div>

            <button
              className="btn btn-primary btn-full"
              onClick={handleExport}
              disabled={isExporting || !localWebhook}
            >
              {isExporting ? 'Sending...' : 'Send to n8n'}
            </button>
          </div>
        )}

        {target === 'appscript' && (
          <div className="modal-body">
            <button className="btn btn-ghost btn-small back-btn" onClick={() => setTarget(null)}>
              Back
            </button>
            <h3>Google Apps Script</h3>
            <p>Enter the Script ID of the Google Apps Script attached to your Sheet.</p>

            <label className="form-label">
              Script ID
              <input
                className="form-input"
                type="text"
                value={localScriptId}
                onChange={(e) => setLocalScriptId(e.target.value)}
                placeholder="1AbCdEf..."
              />
            </label>

            <div className="auth-status">
              {googleAuth.authenticated
                ? <span className="status-badge success">Google Authenticated</span>
                : <span className="status-badge error">Not Authenticated - Go to Settings</span>
              }
            </div>

            <button
              className="btn btn-primary btn-full"
              onClick={handleExport}
              disabled={isExporting || !localScriptId || !googleAuth.authenticated}
            >
              {isExporting ? 'Executing Script...' : 'Send to Google Sheet'}
            </button>
          </div>
        )}

        {/* Result / Error */}
        {exportResult && (
          <div className="modal-footer">
            <div className="result-banner success">{exportResult}</div>
          </div>
        )}
        {exportError && (
          <div className="modal-footer">
            <div className="result-banner error">{exportError}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ExportModal;
