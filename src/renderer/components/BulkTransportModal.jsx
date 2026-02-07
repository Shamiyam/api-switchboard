import React, { useState, useRef, useEffect } from 'react';
import useAppStore from '../store/appStore';

/**
 * Known response patterns for cursor-based pagination (mirrored from CurlInput)
 */
const CURSOR_RESPONSE_PATHS = [
  { path: ['paging', 'next'], urlField: true },
  { path: ['next'], urlField: true },
  { path: ['next_page'], urlField: true },
  { path: ['links', 'next'], urlField: true },
  { path: ['_links', 'next', 'href'], urlField: true },
  { path: ['meta', 'next_cursor'], urlField: false },
  { path: ['cursor', 'next'], urlField: false },
  { path: ['next_cursor'], urlField: false },
  { path: ['has_more'], urlField: false },
  { path: ['nextPageToken'], urlField: false },
  { path: ['pagination', 'next_url'], urlField: true },
  { path: ['pagination', 'next_cursor'], urlField: false },
];

function detectCursorFromResponse(data) {
  if (!data || typeof data !== 'object') return null;
  for (const pattern of CURSOR_RESPONSE_PATHS) {
    let value = data;
    let found = true;
    for (const key of pattern.path) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else { found = false; break; }
    }
    if (found && value) {
      if (pattern.path[pattern.path.length - 1] === 'has_more') {
        if (value === true) {
          const lastId = data.data?.[data.data.length - 1]?.id;
          if (lastId) return { type: 'cursor', value: lastId, isUrl: false };
        }
        continue;
      }
      if (typeof value === 'string' && value.length > 0) {
        return { type: pattern.urlField ? 'url' : 'cursor', value, isUrl: pattern.urlField };
      }
    }
  }
  return null;
}

function extractDataArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const arrayKeys = ['candidates', 'data', 'results', 'items', 'records', 'entries', 'users', 'list', 'rows', 'members', 'jobs'];
    for (const key of arrayKeys) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Browser-mode fetch using Vite dev server proxy to bypass CORS.
 */
async function browserFetch(requestConfig) {
  const { method, url, headers, data, params } = requestConfig;
  const startTime = Date.now();
  try {
    let fullUrl = url;
    if (params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams(params).toString();
      fullUrl += (fullUrl.includes('?') ? '&' : '?') + qs;
    }
    const isDev = window.location.hostname === 'localhost';
    const fetchUrl = isDev ? `/api-proxy/${fullUrl}` : fullUrl;
    const fetchHeaders = { ...(headers || {}) };
    delete fetchHeaders['Host'];
    delete fetchHeaders['host'];
    const fetchOptions = { method: method || 'GET', headers: fetchHeaders };
    if (data && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = typeof data === 'string' ? data : JSON.stringify(data);
    }
    const response = await fetch(fetchUrl, fetchOptions);
    const responseHeaders = {};
    response.headers.forEach((value, key) => { responseHeaders[key] = value; });
    let responseData;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }
    return {
      success: true, status: response.status, statusText: response.statusText,
      headers: responseHeaders, data: responseData, timing: Date.now() - startTime
    };
  } catch (error) {
    return { success: false, error: error.message, code: 'BROWSER_FETCH_ERROR' };
  }
}

/**
 * Send data to Google Sheets via deployed Web App URL.
 * The Apps Script must be deployed as a Web App with doPost().
 * This works from both browser and Electron — no OAuth needed.
 */
async function sendToGoogleSheet(webAppUrl, dataArray, sheetName) {
  try {
    // Route through Vite CORS proxy in dev mode
    const isDev = window.location.hostname === 'localhost';
    const fetchUrl = isDev ? `/api-proxy/${webAppUrl}` : webAppUrl;

    // Wrap in envelope with sheet name
    const payload = {
      sheetName: sheetName || 'API_Data',
      data: dataArray
    };

    const response = await fetch(fetchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });

    // Google Apps Script Web Apps return redirects; follow them
    let responseData;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      const text = await response.text();
      // Try to parse as JSON in case content-type is wrong
      try { responseData = JSON.parse(text); } catch { responseData = { result: text }; }
    }

    if (response.ok || responseData?.success) {
      return { success: true, result: responseData?.result || `${dataArray.length} items sent` };
    } else {
      return { success: false, error: responseData?.error || `HTTP ${response.status}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Send data to n8n webhook
 */
async function sendToN8n(webhookUrl, dataArray) {
  try {
    const isDev = window.location.hostname === 'localhost';
    const fetchUrl = isDev ? `/api-proxy/${webhookUrl}` : webhookUrl;

    const payload = {
      source: 'API Switchboard',
      timestamp: new Date().toISOString(),
      data: dataArray
    };

    if (window.switchboard) {
      return await window.switchboard.sendToN8n(webhookUrl, dataArray);
    }

    const response = await fetch(fetchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      return { success: true, status: response.status };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}


function BulkTransportModal() {
  const {
    setShowBulkTransport, bulkTransport, setBulkTransport, resetBulkTransport,
    parsedRequest, pagination, config, rateLimit
  } = useAppStore();

  const [target, setTarget] = useState(null); // null | 'gsheet' | 'n8n'
  const [localWebAppUrl, setLocalWebAppUrl] = useState(config.googleWebAppUrl || '');
  const [localWebhook, setLocalWebhook] = useState(config.n8nWebhookUrl || '');
  const [localSheetName, setLocalSheetName] = useState('API_Data');
  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const logEndRef = useRef(null);

  // Auto-scroll log
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [bulkTransport.log]);

  const handleClose = () => {
    if (bulkTransport.isRunning) {
      cancelRef.current = true;
      setBulkTransport({ isCancelled: true });
    }
    setTimeout(() => {
      setShowBulkTransport(false);
      resetBulkTransport();
    }, bulkTransport.isRunning ? 500 : 0);
  };

  const handlePause = () => {
    pauseRef.current = !pauseRef.current;
    setBulkTransport({ isPaused: pauseRef.current });
  };

  const handleCancel = () => {
    cancelRef.current = true;
    setBulkTransport({ isCancelled: true });
  };

  const addLog = (entry) => {
    const state = useAppStore.getState();
    setBulkTransport({
      log: [...state.bulkTransport.log, { ...entry, timestamp: new Date().toISOString() }]
    });
  };

  /**
   * Core bulk transport engine.
   * Fetches pages one by one, sends each page's data to the destination.
   */
  const startTransport = async () => {
    const state = useAppStore.getState();
    const { parsedRequest, pagination, rateLimit } = state;
    const bt = state.bulkTransport;

    if (!parsedRequest) return;

    cancelRef.current = false;
    pauseRef.current = false;

    setBulkTransport({
      isRunning: true, isPaused: false, isCancelled: false,
      currentPage: 0, totalPagesSent: 0, totalItemsSent: 0,
      errors: [], log: [], startedAt: new Date().toISOString(), completedAt: null,
    });

    // Save config
    if (target === 'gsheet' && window.switchboard) {
      await window.switchboard.setConfig('googleWebAppUrl', localWebAppUrl);
    }
    if (target === 'n8n' && window.switchboard) {
      await window.switchboard.setConfig('n8nWebhookUrl', localWebhook);
    }

    let pageNum = 0;
    let totalItems = 0;
    let totalPages = 0;
    let nextPageUrl = null;
    let nextCursor = null;
    let isFirstPage = true;
    let reachedEnd = false;
    let errors = [];

    const maxPages = bt.mode === 'pages' ? bt.maxPages : 9999;

    while (!reachedEnd && pageNum < maxPages) {
      // Check cancel
      if (cancelRef.current) {
        addLog({ page: pageNum + 1, items: 0, status: 'cancelled' });
        break;
      }

      // Check pause
      while (pauseRef.current && !cancelRef.current) {
        await sleep(500);
      }
      if (cancelRef.current) {
        addLog({ page: pageNum + 1, items: 0, status: 'cancelled' });
        break;
      }

      pageNum++;
      setBulkTransport({ currentPage: pageNum });

      // Build request config for this page
      let requestConfig;

      if (pagination.mode === 'cursor') {
        if (isFirstPage) {
          // First page: use original URL
          requestConfig = {
            ...parsedRequest,
            params: {
              ...(parsedRequest.params || {}),
              [pagination.perPageParamName]: String(pagination.perPage)
            }
          };
        } else if (nextPageUrl) {
          // Full URL cursor (Workable, Facebook style)
          requestConfig = {
            ...parsedRequest,
            url: nextPageUrl,
            params: {}
          };
        } else if (nextCursor && pagination.cursorParamName) {
          // Token cursor
          requestConfig = {
            ...parsedRequest,
            params: {
              ...(parsedRequest.params || {}),
              [pagination.cursorParamName]: nextCursor,
              [pagination.perPageParamName]: String(pagination.perPage)
            }
          };
        } else if (!isFirstPage) {
          // No more pages
          reachedEnd = true;
          break;
        }
      } else if (pagination.mode === 'page') {
        requestConfig = {
          ...parsedRequest,
          params: {
            ...(parsedRequest.params || {}),
            [pagination.pageParamName]: String(pageNum),
            [pagination.perPageParamName]: String(pagination.perPage)
          }
        };
      } else {
        // No pagination mode - just fetch once
        requestConfig = { ...parsedRequest };
        reachedEnd = true;
      }

      isFirstPage = false;

      // Rate limit delay
      if (pageNum > 1 && rateLimit.delayMs > 0) {
        setBulkTransport({ currentPage: pageNum });
        await sleep(rateLimit.delayMs);
      }

      // Fetch page with retry
      let result = null;
      let retries = 0;
      const maxRetries = rateLimit.retryOn429 ? rateLimit.maxRetries : 0;

      while (true) {
        if (cancelRef.current) break;

        try {
          if (window.switchboard) {
            result = await window.switchboard.executeRequest(requestConfig);
          } else {
            result = await browserFetch(requestConfig);
          }

          if (result.status === 429 && retries < maxRetries) {
            retries++;
            const retryAfter = result.headers?.['retry-after'];
            let waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.min(2000 * Math.pow(2, retries - 1), 30000);
            if (isNaN(waitMs)) waitMs = 2000 * retries;
            addLog({ page: pageNum, items: 0, status: `rate-limited (retry ${retries}, waiting ${Math.round(waitMs/1000)}s)` });
            await sleep(waitMs);
            continue;
          }
          break;
        } catch (err) {
          if (retries < maxRetries) {
            retries++;
            await sleep(2000 * retries);
            continue;
          }
          result = { success: false, error: err.message };
          break;
        }
      }

      if (cancelRef.current) break;

      if (!result || !result.success) {
        const errMsg = result?.error || 'Unknown fetch error';
        errors.push({ page: pageNum, error: errMsg });
        addLog({ page: pageNum, items: 0, status: `fetch error: ${errMsg}` });
        setBulkTransport({ errors: [...errors] });
        // Continue to next page for non-fatal errors, but stop on network errors
        if (errMsg.includes('Network error') || errMsg.includes('BROWSER_FETCH_ERROR')) {
          reachedEnd = true;
        }
        continue;
      }

      // Extract the data array from response
      let dataArray = extractDataArray(result.data);

      if (!dataArray || dataArray.length === 0) {
        addLog({ page: pageNum, items: 0, status: 'empty page - stopping' });
        reachedEnd = true;
        break;
      }

      // Date range filtering
      const btState = useAppStore.getState().bulkTransport;
      if (btState.mode === 'dateRange' && btState.dateField && (btState.dateFrom || btState.dateTo)) {
        const fromDate = btState.dateFrom ? new Date(btState.dateFrom) : null;
        const toDate = btState.dateTo ? new Date(btState.dateTo) : null;

        const originalCount = dataArray.length;
        dataArray = dataArray.filter(item => {
          const fieldVal = item[btState.dateField];
          if (!fieldVal) return false;
          const itemDate = new Date(fieldVal);
          if (isNaN(itemDate.getTime())) return false;
          if (fromDate && itemDate < fromDate) return false;
          if (toDate && itemDate > toDate) return false;
          return true;
        });

        // If all items on this page are before the from-date, we might be done
        // (assuming API returns newest first)
        if (dataArray.length === 0 && fromDate) {
          // Check if any items were before the range entirely
          const anyBefore = extractDataArray(result.data)?.some(item => {
            const d = new Date(item[btState.dateField]);
            return !isNaN(d.getTime()) && d < fromDate;
          });
          if (anyBefore) {
            addLog({ page: pageNum, items: 0, status: 'all items outside date range - stopping' });
            reachedEnd = true;
            break;
          }
        }

        if (dataArray.length === 0) {
          addLog({ page: pageNum, items: 0, status: `0/${originalCount} items matched date range - skipping` });
          // Continue to next page, items might match later
        }
      }

      // Send data to destination
      if (dataArray.length > 0) {
        let sendResult;
        try {
          if (target === 'gsheet') {
            sendResult = await sendToGoogleSheet(localWebAppUrl, dataArray, localSheetName);
          } else if (target === 'n8n') {
            sendResult = await sendToN8n(localWebhook, dataArray);
          }

          if (sendResult && sendResult.success) {
            totalItems += dataArray.length;
            totalPages++;
            addLog({ page: pageNum, items: dataArray.length, status: 'sent' });
            setBulkTransport({ totalPagesSent: totalPages, totalItemsSent: totalItems });
          } else {
            const errMsg = sendResult?.error || 'Send failed';
            errors.push({ page: pageNum, error: errMsg });
            addLog({ page: pageNum, items: dataArray.length, status: `send error: ${errMsg}` });
            setBulkTransport({ errors: [...errors] });
          }
        } catch (err) {
          errors.push({ page: pageNum, error: err.message });
          addLog({ page: pageNum, items: dataArray.length, status: `send error: ${err.message}` });
          setBulkTransport({ errors: [...errors] });
        }
      }

      // Detect next page cursor from response
      if (pagination.mode === 'cursor') {
        const cursorInfo = detectCursorFromResponse(result.data);
        if (cursorInfo) {
          if (cursorInfo.isUrl) {
            nextPageUrl = cursorInfo.value;
            nextCursor = null;
          } else {
            nextCursor = cursorInfo.value;
            nextPageUrl = null;
          }
        } else {
          // No more pages
          reachedEnd = true;
        }
      } else if (pagination.mode === 'page') {
        // For page-based, check if we got fewer items than perPage
        if (dataArray.length < pagination.perPage) {
          reachedEnd = true;
        }
      } else {
        // No pagination
        reachedEnd = true;
      }
    }

    const finalState = useAppStore.getState().bulkTransport;
    const status = cancelRef.current ? 'Cancelled' :
      errors.length > 0 ? `Completed with ${errors.length} error(s)` : 'Completed';

    addLog({ page: '-', items: totalItems, status: `DONE: ${status}. ${totalPages} pages, ${totalItems} items total.` });
    setBulkTransport({
      isRunning: false,
      completedAt: new Date().toISOString()
    });
  };

  const { isRunning, isPaused, log, totalPagesSent, totalItemsSent, currentPage, errors } = bulkTransport;
  const isComplete = !isRunning && bulkTransport.completedAt;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal modal-wide bulk-transport-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Bulk Transport to Cloud</h2>
          <button className="btn btn-ghost modal-close" onClick={handleClose}>X</button>
        </div>

        {/* Step 1: Choose destination */}
        {!target && !isRunning && (
          <div className="modal-body">
            <p className="modal-subtitle">
              Automatically fetch all pages and transport data to your destination.
            </p>
            <div className="export-options">
              <button className="export-card" onClick={() => setTarget('gsheet')}>
                <div className="export-card-icon">GAS</div>
                <h3>Google Sheets</h3>
                <p>Send all pages to Google Sheets via Apps Script Web App</p>
              </button>
              <button className="export-card" onClick={() => setTarget('n8n')}>
                <div className="export-card-icon">n8n</div>
                <h3>n8n Webhook</h3>
                <p>Send all pages to an n8n workflow</p>
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Configure transport options */}
        {target && !isRunning && !isComplete && (
          <div className="modal-body">
            <button className="btn btn-ghost btn-small back-btn" onClick={() => setTarget(null)}>
              Back
            </button>

            {/* Destination config */}
            {target === 'gsheet' && (
              <div className="bulk-destination-config">
                <h3>Google Sheets (Web App)</h3>
                <p className="settings-hint">
                  Deploy the Apps Script as a <strong>Web App</strong> and paste the URL here.
                  See README for setup steps.
                </p>
                <label className="form-label">
                  Web App URL
                  <input
                    className="form-input"
                    type="url"
                    value={localWebAppUrl}
                    onChange={(e) => setLocalWebAppUrl(e.target.value)}
                    placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                  />
                </label>

                <div className="sheet-name-section">
                  <label className="form-label">
                    Destination Sheet Name
                    <input
                      className="form-input"
                      type="text"
                      value={localSheetName}
                      onChange={(e) => setLocalSheetName(e.target.value)}
                      placeholder="API_Data"
                    />
                  </label>
                  <p className="settings-hint">
                    Sheet tab to write data into. The sheet will be created automatically if it doesn't exist.
                  </p>
                </div>
              </div>
            )}

            {target === 'n8n' && (
              <div className="bulk-destination-config">
                <h3>n8n Webhook</h3>
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
              </div>
            )}

            {/* Transport mode selection */}
            <div className="bulk-mode-section">
              <h4>Transport Mode</h4>

              <label className="bulk-mode-option">
                <input
                  type="radio"
                  name="bulkMode"
                  checked={bulkTransport.mode === 'all'}
                  onChange={() => setBulkTransport({ mode: 'all' })}
                />
                <div className="bulk-mode-info">
                  <span className="bulk-mode-title">All Pages</span>
                  <span className="bulk-mode-desc">Fetch from first page to last, send everything</span>
                </div>
              </label>

              <label className="bulk-mode-option">
                <input
                  type="radio"
                  name="bulkMode"
                  checked={bulkTransport.mode === 'pages'}
                  onChange={() => setBulkTransport({ mode: 'pages' })}
                />
                <div className="bulk-mode-info">
                  <span className="bulk-mode-title">Specific Number of Pages</span>
                  <span className="bulk-mode-desc">Fetch and send up to N pages</span>
                </div>
                {bulkTransport.mode === 'pages' && (
                  <input
                    className="bulk-mode-input"
                    type="number"
                    min="1"
                    max="500"
                    value={bulkTransport.maxPages}
                    onChange={(e) => setBulkTransport({ maxPages: parseInt(e.target.value, 10) || 1 })}
                  />
                )}
              </label>

              <label className="bulk-mode-option">
                <input
                  type="radio"
                  name="bulkMode"
                  checked={bulkTransport.mode === 'dateRange'}
                  onChange={() => setBulkTransport({ mode: 'dateRange' })}
                />
                <div className="bulk-mode-info">
                  <span className="bulk-mode-title">Date Range</span>
                  <span className="bulk-mode-desc">Only transport items within a date window</span>
                </div>
              </label>

              {bulkTransport.mode === 'dateRange' && (
                <div className="bulk-date-range">
                  <label className="form-label">
                    Date field name
                    <input
                      className="form-input"
                      type="text"
                      value={bulkTransport.dateField}
                      onChange={(e) => setBulkTransport({ dateField: e.target.value })}
                      placeholder="e.g. created_at, updated_at, date"
                    />
                  </label>
                  <div className="bulk-date-inputs">
                    <label className="form-label">
                      From
                      <input
                        className="form-input"
                        type="date"
                        value={bulkTransport.dateFrom}
                        onChange={(e) => setBulkTransport({ dateFrom: e.target.value })}
                      />
                    </label>
                    <label className="form-label">
                      To
                      <input
                        className="form-input"
                        type="date"
                        value={bulkTransport.dateTo}
                        onChange={(e) => setBulkTransport({ dateTo: e.target.value })}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Info summary */}
            <div className="bulk-summary">
              <div className="bulk-summary-item">
                <span className="bulk-summary-label">Pagination:</span>
                <span className="bulk-summary-value">
                  {pagination.mode === 'cursor' ? 'Cursor-based' :
                   pagination.mode === 'page' ? `Page-based (${pagination.pageParamName})` :
                   'None detected'}
                </span>
              </div>
              <div className="bulk-summary-item">
                <span className="bulk-summary-label">Per page:</span>
                <span className="bulk-summary-value">{pagination.perPage} items</span>
              </div>
              <div className="bulk-summary-item">
                <span className="bulk-summary-label">Rate limit delay:</span>
                <span className="bulk-summary-value">{rateLimit.delayMs}ms between requests</span>
              </div>
              {target === 'gsheet' && (
                <div className="bulk-summary-item">
                  <span className="bulk-summary-label">Sheet name:</span>
                  <span className="bulk-summary-value">{localSheetName || 'API_Data'}</span>
                </div>
              )}
            </div>

            {/* Start button */}
            <button
              className="btn btn-primary btn-full"
              onClick={startTransport}
              disabled={
                (target === 'gsheet' && !localWebAppUrl) ||
                (target === 'n8n' && !localWebhook) ||
                !parsedRequest ||
                (bulkTransport.mode === 'dateRange' && !bulkTransport.dateField)
              }
            >
              Start Bulk Transport
            </button>
          </div>
        )}

        {/* Step 3: Progress view */}
        {(isRunning || isComplete) && (
          <div className="modal-body">
            {/* Progress header */}
            <div className="bulk-progress-header">
              <div className="bulk-progress-stats">
                <div className="bulk-stat">
                  <span className="bulk-stat-value">{currentPage}</span>
                  <span className="bulk-stat-label">Current Page</span>
                </div>
                <div className="bulk-stat">
                  <span className="bulk-stat-value">{totalPagesSent}</span>
                  <span className="bulk-stat-label">Pages Sent</span>
                </div>
                <div className="bulk-stat">
                  <span className="bulk-stat-value">{totalItemsSent}</span>
                  <span className="bulk-stat-label">Items Sent</span>
                </div>
                <div className="bulk-stat">
                  <span className="bulk-stat-value error-count">{errors.length}</span>
                  <span className="bulk-stat-label">Errors</span>
                </div>
              </div>

              {isRunning && (
                <div className="bulk-progress-actions">
                  <button
                    className={`btn btn-small ${isPaused ? 'btn-accent' : 'btn-ghost'}`}
                    onClick={handlePause}
                  >
                    {isPaused ? 'Resume' : 'Pause'}
                  </button>
                  <button className="btn btn-small btn-danger" onClick={handleCancel}>
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Progress bar */}
            {isRunning && (
              <div className="bulk-progress-bar-container">
                <div className="bulk-progress-bar pulse" />
                <span className="bulk-progress-text">
                  {isPaused ? 'Paused...' : `Fetching page ${currentPage}...`}
                </span>
              </div>
            )}

            {isComplete && (
              <div className={`bulk-complete-banner ${errors.length > 0 ? 'has-errors' : 'success'}`}>
                {errors.length === 0
                  ? `Transport complete! ${totalPagesSent} pages, ${totalItemsSent} items sent.`
                  : `Transport finished with ${errors.length} error(s). ${totalPagesSent} pages, ${totalItemsSent} items sent.`
                }
              </div>
            )}

            {/* Log output */}
            <div className="bulk-log">
              <div className="bulk-log-header">Transport Log</div>
              <div className="bulk-log-entries">
                {log.map((entry, i) => (
                  <div
                    key={i}
                    className={`bulk-log-entry ${
                      entry.status === 'sent' ? 'log-success' :
                      entry.status.includes('error') ? 'log-error' :
                      entry.status === 'cancelled' ? 'log-warn' :
                      entry.status.includes('rate-limited') ? 'log-warn' :
                      'log-info'
                    }`}
                  >
                    <span className="log-page">
                      {entry.page !== '-' ? `Page ${entry.page}` : 'TOTAL'}
                    </span>
                    {entry.items > 0 && (
                      <span className="log-items">{entry.items} items</span>
                    )}
                    <span className="log-status">{entry.status}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>

            {isComplete && (
              <button className="btn btn-ghost btn-full" onClick={handleClose}>
                Close
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default BulkTransportModal;
