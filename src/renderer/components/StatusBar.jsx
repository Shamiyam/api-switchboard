import React from 'react';
import useAppStore from '../store/appStore';

function StatusBar() {
  const { parsedRequest, apiResponse, googleAuth, isExecuting, isExporting } = useAppStore();

  return (
    <footer className="status-bar">
      <div className="status-left">
        {parsedRequest && (
          <span className="status-item">
            {parsedRequest.method} {parsedRequest.url.substring(0, 60)}
            {parsedRequest.url.length > 60 ? '...' : ''}
          </span>
        )}
      </div>
      <div className="status-right">
        {isExecuting && <span className="status-item pulse">Fetching...</span>}
        {isExporting && <span className="status-item pulse">Exporting...</span>}
        {apiResponse?.success && (
          <span className="status-item">
            Response: {apiResponse.status}
          </span>
        )}
        <span className={`status-item ${googleAuth.authenticated ? 'google-ok' : ''}`}>
          Google: {googleAuth.authenticated ? 'Connected' : 'Not connected'}
        </span>
      </div>
    </footer>
  );
}

export default StatusBar;
