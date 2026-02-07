import React, { useState } from 'react';
import useAppStore from '../store/appStore';

function ResponseViewer() {
  const {
    apiResponse, executeError, setShowExportModal, setActiveTab,
    pagination, setPagination, _fetchPageFn, isExecuting,
    rateLimit
  } = useAppStore();

  const [viewMode, setViewMode] = useState('pretty'); // 'pretty' | 'raw' | 'headers'
  const [searchTerm, setSearchTerm] = useState('');

  if (executeError) {
    return (
      <div className="panel response-panel full-width">
        <div className="panel-header">
          <h2>Response</h2>
          <button className="btn btn-small btn-ghost" onClick={() => setActiveTab('input')}>
            Back to Input
          </button>
        </div>
        <div className="error-display">
          <span className="error-icon">!</span>
          <p>Request failed: {executeError}</p>
        </div>
      </div>
    );
  }

  if (!apiResponse) {
    return (
      <div className="panel response-panel full-width">
        <div className="panel-header"><h2>Response</h2></div>
        <div className="empty-state">
          <p>No response yet. Go back to Input and fetch data first.</p>
        </div>
      </div>
    );
  }

  const { success, status, statusText, headers, data, error, timing } = apiResponse;
  const statusColor = status >= 200 && status < 300 ? '#49cc90' : status >= 400 ? '#f93e3e' : '#fca130';

  const dataString = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const dataSize = new Blob([dataString]).size;

  // Count items - check both top-level array and nested data arrays
  let itemCount = null;
  if (Array.isArray(data)) {
    itemCount = data.length;
  } else if (data && typeof data === 'object') {
    // Look for the main data array in common patterns
    const arrayKeys = ['candidates', 'data', 'results', 'items', 'records', 'entries', 'users', 'list', 'rows'];
    for (const key of arrayKeys) {
      if (Array.isArray(data[key])) {
        itemCount = data[key].length;
        break;
      }
    }
  }

  // Simple JSON path search
  const filteredData = searchTerm
    ? filterJSON(data, searchTerm)
    : data;

  // Pagination handlers
  const isCursorMode = pagination.mode === 'cursor';

  const goToNext = () => {
    if (_fetchPageFn) {
      if (isCursorMode) {
        _fetchPageFn('next');
      } else {
        _fetchPageFn(pagination.currentPage + 1);
      }
    }
  };

  const goToPrev = () => {
    if (_fetchPageFn) {
      if (isCursorMode) {
        _fetchPageFn('prev');
      } else {
        _fetchPageFn(pagination.currentPage - 1);
      }
    }
  };

  const goToPage = (page) => {
    if (_fetchPageFn && page >= 1) {
      _fetchPageFn(page);
    }
  };

  const handlePerPageChange = (newPerPage) => {
    setPagination({ perPage: newPerPage, currentPage: 1, nextCursor: null, nextPageUrl: null, prevCursors: [] });
    if (_fetchPageFn) {
      // For cursor mode, just refetch first page. For page mode, refetch page 1.
      setTimeout(() => {
        if (isCursorMode) {
          _fetchPageFn(undefined); // refetch first page
        } else {
          _fetchPageFn(1);
        }
      }, 50);
    }
  };

  // Can we go to the next page?
  const hasNextPage = isCursorMode
    ? !!(pagination.nextPageUrl || pagination.nextCursor)
    : (itemCount === null || itemCount >= pagination.perPage);

  // Can we go to the previous page?
  const hasPrevPage = isCursorMode
    ? pagination.prevCursors.length > 0
    : pagination.currentPage > 1;

  return (
    <div className="panel response-panel full-width">
      <div className="panel-header">
        <h2>Response</h2>
        <div className="response-meta">
          {success && (
            <>
              <span className="status-badge" style={{ backgroundColor: statusColor }}>
                {status} {statusText}
              </span>
              <span className="meta-item">{formatBytes(dataSize)}</span>
              {itemCount !== null && (
                <span className="meta-item">{itemCount} items</span>
              )}
              {timing && (
                <span className="meta-item">{timing}ms</span>
              )}
            </>
          )}
          {!success && (
            <span className="status-badge error">Error: {error}</span>
          )}
        </div>
        <div className="response-actions">
          <button className="btn btn-small btn-ghost" onClick={() => setActiveTab('input')}>
            Back
          </button>
          <button
            className="btn btn-small btn-ghost"
            onClick={() => navigator.clipboard.writeText(dataString)}
          >
            Copy JSON
          </button>
          <button
            className="btn btn-small btn-accent"
            onClick={() => setShowExportModal(true)}
            disabled={!success}
          >
            Export / Save to Cloud
          </button>
        </div>
      </div>

      {/* Rate Limit Info Bar */}
      {(rateLimit.rateLimitInfo || rateLimit.isWaiting) && (
        <div className="rate-limit-info-bar">
          {rateLimit.isWaiting && (
            <span className="rate-limit-waiting pulse">
              Rate limited - waiting {rateLimit.retryCount > 0 ? `(retry ${rateLimit.retryCount})` : ''}...
            </span>
          )}
          {rateLimit.rateLimitInfo && (
            <div className="rate-limit-stats">
              {rateLimit.rateLimitInfo.remaining !== undefined && (
                <span className={`rate-limit-stat ${rateLimit.rateLimitInfo.remaining <= 5 ? 'warning' : ''}`}>
                  Remaining: {rateLimit.rateLimitInfo.remaining}
                  {rateLimit.rateLimitInfo.limit ? `/${rateLimit.rateLimitInfo.limit}` : ''}
                </span>
              )}
              {rateLimit.rateLimitInfo.reset && (
                <span className="rate-limit-stat">
                  Resets: {formatResetTime(rateLimit.rateLimitInfo.reset)}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Pagination Bar */}
      {pagination.hasDetected && success && (
        <div className="pagination-bar">
          <div className="pagination-info">
            <span className="pagination-label">Page {pagination.currentPage}</span>
            <button
              className="pagination-btn"
              onClick={goToPrev}
              disabled={!hasPrevPage || isExecuting}
              title="Previous page"
            >
              &larr; Prev
            </button>

            {/* Only show page input for page-based mode */}
            {!isCursorMode && (
              <input
                className="pagination-page-input"
                type="number"
                min="1"
                value={pagination.currentPage}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (val >= 1) setPagination({ currentPage: val });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    goToPage(pagination.currentPage);
                  }
                }}
              />
            )}

            <button
              className="pagination-btn"
              onClick={goToNext}
              disabled={!hasNextPage || isExecuting}
              title="Next page"
            >
              Next &rarr;
            </button>
          </div>

          <div className="pagination-per-page">
            <span className="pagination-label">Per page:</span>
            {[5, 10, 20, 50, 100].map(size => (
              <button
                key={size}
                className={`pagination-size-btn ${pagination.perPage === size ? 'active' : ''}`}
                onClick={() => handlePerPageChange(size)}
                disabled={isExecuting}
              >
                {size}
              </button>
            ))}
          </div>

          <div className="pagination-params-hint">
            {isCursorMode ? (
              <span className="pagination-detected cursor-mode">
                Mode: <code>cursor</code>
                {pagination.nextPageUrl && <span className="pagination-has-next"> (has next)</span>}
                {!pagination.nextPageUrl && !pagination.nextCursor && pagination.currentPage > 1 && (
                  <span className="pagination-last-page"> (last page)</span>
                )}
              </span>
            ) : (
              <span className="pagination-detected">
                Detected: <code>{pagination.pageParamName}</code> + <code>{pagination.perPageParamName}</code>
              </span>
            )}
          </div>
        </div>
      )}

      {/* View Mode Tabs */}
      <div className="view-mode-bar">
        <button
          className={`view-tab ${viewMode === 'pretty' ? 'active' : ''}`}
          onClick={() => setViewMode('pretty')}
        >
          Pretty
        </button>
        <button
          className={`view-tab ${viewMode === 'raw' ? 'active' : ''}`}
          onClick={() => setViewMode('raw')}
        >
          Raw
        </button>
        <button
          className={`view-tab ${viewMode === 'headers' ? 'active' : ''}`}
          onClick={() => setViewMode('headers')}
        >
          Headers
        </button>

        {viewMode === 'pretty' && (
          <input
            className="search-input"
            type="text"
            placeholder="Search keys/values..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        )}
      </div>

      {/* Loading overlay */}
      {isExecuting && (
        <div className="loading-overlay">
          <span className="pulse">
            {rateLimit.isWaiting
              ? `Rate limited - waiting...`
              : `Loading page ${pagination.currentPage}...`
            }
          </span>
        </div>
      )}

      {/* Content */}
      <div className="response-content">
        {viewMode === 'pretty' && (
          <pre className="code-block json-pretty">
            {JSON.stringify(filteredData, null, 2)}
          </pre>
        )}
        {viewMode === 'raw' && (
          <pre className="code-block">{dataString}</pre>
        )}
        {viewMode === 'headers' && headers && (
          <table className="kv-table">
            <tbody>
              {Object.entries(headers).map(([key, value]) => (
                <tr key={key}>
                  <td className="kv-key">{key}</td>
                  <td className="kv-value">{String(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function filterJSON(data, term) {
  if (!data || typeof data !== 'object') return data;
  const lower = term.toLowerCase();

  if (Array.isArray(data)) {
    return data.filter(item => JSON.stringify(item).toLowerCase().includes(lower));
  }

  const filtered = {};
  for (const [key, value] of Object.entries(data)) {
    if (
      key.toLowerCase().includes(lower) ||
      JSON.stringify(value).toLowerCase().includes(lower)
    ) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatResetTime(resetTimestamp) {
  // Could be epoch seconds or relative seconds
  if (resetTimestamp > 1e9) {
    // Epoch timestamp
    const date = new Date(resetTimestamp * 1000);
    const diff = Math.max(0, Math.round((date - Date.now()) / 1000));
    return diff > 0 ? `${diff}s` : 'now';
  }
  return `${resetTimestamp}s`;
}

export default ResponseViewer;
