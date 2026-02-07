import React from 'react';
import useAppStore from '../store/appStore';
import { toCurl } from '../utils/curlParser';

function RequestPreview() {
  const { parsedRequest, parseError } = useAppStore();

  if (parseError) {
    return (
      <div className="panel request-preview-panel">
        <div className="panel-header">
          <h2>Request Preview</h2>
        </div>
        <div className="error-display">
          <span className="error-icon">!</span>
          <p>{parseError}</p>
        </div>
      </div>
    );
  }

  if (!parsedRequest) {
    return (
      <div className="panel request-preview-panel">
        <div className="panel-header">
          <h2>Request Preview</h2>
        </div>
        <div className="empty-state">
          <p>Paste a cURL command and click "Parse" to see the request details here.</p>
        </div>
      </div>
    );
  }

  const { method, url, headers, data, params } = parsedRequest;

  const methodColors = {
    GET: '#61affe',
    POST: '#49cc90',
    PUT: '#fca130',
    PATCH: '#e5c07b',
    DELETE: '#f93e3e',
    HEAD: '#9012fe',
    OPTIONS: '#0d5aa7'
  };

  return (
    <div className="panel request-preview-panel">
      <div className="panel-header">
        <h2>Request Preview</h2>
        <button
          className="btn btn-small btn-ghost"
          onClick={() => navigator.clipboard.writeText(toCurl(parsedRequest))}
          title="Copy as cURL"
        >
          Copy cURL
        </button>
      </div>

      <div className="request-preview">
        {/* Method + URL */}
        <div className="request-line">
          <span
            className="method-badge"
            style={{ backgroundColor: methodColors[method] || '#666' }}
          >
            {method}
          </span>
          <span className="request-url">{url}</span>
        </div>

        {/* Query Params */}
        {params && Object.keys(params).length > 0 && (
          <div className="request-section">
            <h3>Query Parameters</h3>
            <table className="kv-table">
              <tbody>
                {Object.entries(params).map(([key, value]) => (
                  <tr key={key}>
                    <td className="kv-key">{key}</td>
                    <td className="kv-value">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Headers */}
        {headers && Object.keys(headers).length > 0 && (
          <div className="request-section">
            <h3>Headers</h3>
            <table className="kv-table">
              <tbody>
                {Object.entries(headers).map(([key, value]) => (
                  <tr key={key}>
                    <td className="kv-key">{key}</td>
                    <td className="kv-value">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Body */}
        {data && (
          <div className="request-section">
            <h3>Body</h3>
            <pre className="code-block">
              {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default RequestPreview;
