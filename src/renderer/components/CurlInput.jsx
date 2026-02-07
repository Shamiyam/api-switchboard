import React, { useState, useEffect, useCallback } from 'react';
import useAppStore from '../store/appStore';
import { parseCurl } from '../utils/curlParser';

// Known pagination parameter patterns
const PAGE_PARAM_NAMES = ['page', 'p', 'pageNumber', 'page_number', 'pageNo', 'pg'];
const OFFSET_PARAM_NAMES = ['offset', 'skip', 'start'];
const CURSOR_PARAM_NAMES = ['cursor', 'after', 'since_id', 'next_cursor', 'starting_after', 'next_token', 'continuation'];
const PER_PAGE_PARAM_NAMES = ['per_page', 'perPage', 'page_size', 'pageSize', 'limit', 'count', 'size', 'rows', 'maxResults', 'max_results'];

// Known response patterns for cursor-based pagination
const CURSOR_RESPONSE_PATHS = [
  // { path: array of keys to traverse, urlField: true if it contains a full URL }
  { path: ['paging', 'next'], urlField: true },       // Workable, Facebook
  { path: ['next'], urlField: true },                   // Generic next URL
  { path: ['next_page'], urlField: true },              // Some APIs
  { path: ['links', 'next'], urlField: true },          // HAL-style
  { path: ['_links', 'next', 'href'], urlField: true }, // HAL-style
  { path: ['meta', 'next_cursor'], urlField: false },   // Cursor tokens
  { path: ['cursor', 'next'], urlField: false },        // Cursor tokens
  { path: ['next_cursor'], urlField: false },            // Twitter-style
  { path: ['has_more'], urlField: false },               // Stripe-style (check separately)
  { path: ['nextPageToken'], urlField: false },          // Google APIs
  { path: ['pagination', 'next_url'], urlField: true },  // Generic
  { path: ['pagination', 'next_cursor'], urlField: false },
];

function CurlInput() {
  const {
    curlInput, setCurlInput, setParsedRequest, setParseError,
    parsedRequest, isExecuting, setIsExecuting, setApiResponse,
    setExecuteError, setActiveTab, pagination, setPagination, setFetchPageFn,
    rateLimit, setRateLimit
  } = useAppStore();

  const [parseStatus, setParseStatus] = useState(null); // 'success' | 'error' | null

  // Register the fetchPage function so ResponseViewer pagination can use it
  useEffect(() => {
    setFetchPageFn((pageOrDirection) => executeFetch(pageOrDirection));
  }, []);

  const handleParse = () => {
    try {
      const parsed = parseCurl(curlInput);
      setParsedRequest(parsed);
      setParseStatus('success');

      // Auto-detect pagination parameters from query params
      if (parsed.params) {
        const paramKeys = Object.keys(parsed.params);
        const detectedPageParam = paramKeys.find(k => PAGE_PARAM_NAMES.includes(k));
        const detectedPerPageParam = paramKeys.find(k => PER_PAGE_PARAM_NAMES.includes(k));
        const detectedCursorParam = paramKeys.find(k => CURSOR_PARAM_NAMES.includes(k));
        const detectedOffsetParam = paramKeys.find(k => OFFSET_PARAM_NAMES.includes(k));

        if (detectedCursorParam) {
          // Cursor param found in URL (e.g., since_id, cursor, after)
          setPagination({
            mode: 'cursor',
            cursorParamName: detectedCursorParam,
            perPageParamName: detectedPerPageParam || 'limit',
            perPage: detectedPerPageParam ? parseInt(parsed.params[detectedPerPageParam], 10) || 10 : 10,
            hasDetected: true,
            currentPage: 1,
            nextCursor: null,
            prevCursors: [],
            nextPageUrl: null,
          });
        } else if (detectedPageParam) {
          // Page-number based pagination
          setPagination({
            mode: 'page',
            pageParamName: detectedPageParam,
            perPageParamName: detectedPerPageParam || 'per_page',
            currentPage: parseInt(parsed.params[detectedPageParam], 10) || 1,
            perPage: detectedPerPageParam ? parseInt(parsed.params[detectedPerPageParam], 10) || 10 : 10,
            hasDetected: true,
            nextCursor: null,
            prevCursors: [],
            cursorParamName: null,
            nextPageUrl: null,
          });
        } else if (detectedOffsetParam) {
          // Offset-based pagination (treat like page-based with offset math)
          setPagination({
            mode: 'page',
            pageParamName: detectedOffsetParam,
            perPageParamName: detectedPerPageParam || 'limit',
            currentPage: 1,
            perPage: detectedPerPageParam ? parseInt(parsed.params[detectedPerPageParam], 10) || 10 : 10,
            hasDetected: true,
            nextCursor: null,
            prevCursors: [],
            cursorParamName: null,
            nextPageUrl: null,
          });
        } else if (detectedPerPageParam) {
          // Only limit/per_page found — might be cursor-based (will detect from response)
          setPagination({
            mode: 'cursor',  // Assume cursor until proven otherwise
            perPageParamName: detectedPerPageParam,
            perPage: parseInt(parsed.params[detectedPerPageParam], 10) || 10,
            hasDetected: true,
            currentPage: 1,
            nextCursor: null,
            prevCursors: [],
            cursorParamName: null,
            nextPageUrl: null,
          });
        }
      }
    } catch (err) {
      setParseError(err.message);
      setParseStatus('error');
    }
  };

  const handleExecute = async (pageOverride) => {
    return executeFetch(pageOverride);
  };

  const handlePaste = (e) => {
    // Auto-parse on paste
    const text = e.clipboardData?.getData('text') || '';
    if (text.trim().toLowerCase().startsWith('curl')) {
      setCurlInput(text);
      setTimeout(() => {
        try {
          const parsed = parseCurl(text);
          setParsedRequest(parsed);
          setParseStatus('success');
        } catch (err) {
          setParseError(err.message);
          setParseStatus('error');
        }
      }, 50);
    }
  };

  const sampleCurl = `curl -X GET "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1" -H "accept: application/json"`;

  return (
    <div className="panel curl-input-panel">
      <div className="panel-header">
        <h2>Paste cURL Command</h2>
        <button
          className="btn btn-small btn-ghost"
          onClick={() => { setCurlInput(sampleCurl); }}
          title="Load sample cURL"
        >
          Sample
        </button>
      </div>

      <textarea
        className="curl-textarea"
        value={curlInput}
        onChange={(e) => setCurlInput(e.target.value)}
        onPaste={handlePaste}
        placeholder={`Paste your cURL command here...\n\nExample:\ncurl -X GET "https://api.example.com/data" \\\n  -H "Authorization: Bearer token123" \\\n  -H "Content-Type: application/json"`}
        spellCheck={false}
      />

      {/* Rate Limit Settings */}
      <div className="rate-limit-bar">
        <div className="rate-limit-setting">
          <label className="rate-limit-label">Delay between requests:</label>
          <select
            className="rate-limit-select"
            value={rateLimit.delayMs}
            onChange={(e) => setRateLimit({ delayMs: parseInt(e.target.value, 10) })}
          >
            <option value={0}>No delay</option>
            <option value={200}>200ms</option>
            <option value={500}>500ms</option>
            <option value={1000}>1 second</option>
            <option value={2000}>2 seconds</option>
            <option value={3000}>3 seconds</option>
            <option value={5000}>5 seconds</option>
          </select>
        </div>
        <div className="rate-limit-setting">
          <label className="rate-limit-label">Auto-retry on 429:</label>
          <input
            type="checkbox"
            checked={rateLimit.retryOn429}
            onChange={(e) => setRateLimit({ retryOn429: e.target.checked })}
          />
          <span className="rate-limit-hint">up to {rateLimit.maxRetries}x</span>
        </div>
      </div>

      <div className="curl-actions">
        <button
          className="btn btn-primary"
          onClick={handleParse}
          disabled={!curlInput.trim()}
        >
          Parse cURL
        </button>

        <button
          className="btn btn-accent"
          onClick={handleExecute}
          disabled={!parsedRequest || isExecuting}
        >
          {isExecuting ? 'Fetching...' : 'Fetch Data'}
        </button>

        {parseStatus === 'success' && (
          <span className="status-badge success">Parsed OK</span>
        )}
        {parseStatus === 'error' && (
          <span className="status-badge error">Parse Error</span>
        )}
      </div>
    </div>
  );
}

/**
 * Detect cursor-based pagination from API response data.
 * Scans known response patterns to find next page URLs or cursor tokens.
 */
function detectCursorFromResponse(data) {
  if (!data || typeof data !== 'object') return null;

  for (const pattern of CURSOR_RESPONSE_PATHS) {
    let value = data;
    let found = true;
    for (const key of pattern.path) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        found = false;
        break;
      }
    }

    if (found && value) {
      // Special case: has_more is a boolean flag, not a cursor
      if (pattern.path[pattern.path.length - 1] === 'has_more') {
        if (value === true) {
          // Look for a cursor token alongside has_more
          const lastId = data.data?.[data.data.length - 1]?.id;
          if (lastId) {
            return { type: 'cursor', value: lastId, isUrl: false, path: pattern.path.join('.') };
          }
        }
        continue;
      }

      if (typeof value === 'string' && value.length > 0) {
        return {
          type: pattern.urlField ? 'url' : 'cursor',
          value: value,
          isUrl: pattern.urlField,
          path: pattern.path.join('.')
        };
      }
    }
  }

  return null;
}

/**
 * Extract rate limit info from response headers
 */
function extractRateLimitInfo(headers) {
  if (!headers) return null;
  const info = {};
  // Common header patterns
  const limit = headers['x-ratelimit-limit'] || headers['x-rate-limit-limit'] || headers['ratelimit-limit'];
  const remaining = headers['x-ratelimit-remaining'] || headers['x-rate-limit-remaining'] || headers['ratelimit-remaining'];
  const reset = headers['x-ratelimit-reset'] || headers['x-rate-limit-reset'] || headers['ratelimit-reset'] || headers['retry-after'];

  if (limit) info.limit = parseInt(limit, 10);
  if (remaining) info.remaining = parseInt(remaining, 10);
  if (reset) info.reset = parseInt(reset, 10);

  return (Object.keys(info).length > 0) ? info : null;
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Standalone fetch executor that reads fresh state from the Zustand store.
 * This avoids stale closure issues when called from ResponseViewer pagination.
 *
 * pageOrDirection can be:
 *   - a number (page number for page-based pagination)
 *   - 'next' (go to next cursor page)
 *   - 'prev' (go to previous cursor page)
 *   - undefined (initial fetch)
 */
async function executeFetch(pageOrDirection) {
  const state = useAppStore.getState();
  const {
    parsedRequest, pagination, setIsExecuting, setExecuteError,
    setApiResponse, setActiveTab, setPagination, rateLimit, setRateLimit
  } = state;

  if (!parsedRequest) return;
  setIsExecuting(true);
  setExecuteError(null);

  // Rate limit: enforce delay between requests
  const now = Date.now();
  const timeSinceLastRequest = now - rateLimit.lastRequestTime;
  if (rateLimit.lastRequestTime > 0 && timeSinceLastRequest < rateLimit.delayMs) {
    const waitTime = rateLimit.delayMs - timeSinceLastRequest;
    setRateLimit({ isWaiting: true, waitUntil: now + waitTime });
    await sleep(waitTime);
    setRateLimit({ isWaiting: false, waitUntil: null });
  }

  // Build request config
  let requestConfig;

  if (pagination.mode === 'cursor') {
    // CURSOR-BASED PAGINATION
    if (pageOrDirection === 'next' && pagination.nextPageUrl) {
      // Use the full next page URL from the API response
      requestConfig = {
        ...parsedRequest,
        url: pagination.nextPageUrl,
        params: {} // URL already contains all params
      };
    } else if (pageOrDirection === 'next' && pagination.nextCursor && pagination.cursorParamName) {
      // Use cursor token as a query param
      requestConfig = {
        ...parsedRequest,
        params: {
          ...(parsedRequest.params || {}),
          [pagination.cursorParamName]: pagination.nextCursor,
          [pagination.perPageParamName]: String(pagination.perPage)
        }
      };
    } else if (pageOrDirection === 'prev' && pagination.prevCursors.length > 0) {
      // Go back to previous cursor
      const prevStack = [...pagination.prevCursors];
      const prevEntry = prevStack.pop();

      if (prevEntry && prevEntry.url) {
        requestConfig = {
          ...parsedRequest,
          url: prevEntry.url,
          params: {}
        };
      } else if (prevEntry && prevEntry.cursor) {
        requestConfig = {
          ...parsedRequest,
          params: {
            ...(parsedRequest.params || {}),
            [pagination.cursorParamName]: prevEntry.cursor,
            [pagination.perPageParamName]: String(pagination.perPage)
          }
        };
      } else {
        // Go back to first page (original URL with no cursor)
        requestConfig = {
          ...parsedRequest,
          params: {
            ...(parsedRequest.params || {}),
            [pagination.perPageParamName]: String(pagination.perPage)
          }
        };
        // Remove any cursor param from first page request
        if (pagination.cursorParamName && requestConfig.params[pagination.cursorParamName]) {
          delete requestConfig.params[pagination.cursorParamName];
        }
      }

      setPagination({
        prevCursors: prevStack,
        currentPage: Math.max(1, pagination.currentPage - 1)
      });
    } else {
      // First page - use original URL with limit param
      requestConfig = {
        ...parsedRequest,
        params: {
          ...(parsedRequest.params || {}),
          [pagination.perPageParamName]: String(pagination.perPage)
        }
      };
    }
  } else if (pagination.mode === 'page' && pagination.hasDetected) {
    // PAGE-NUMBER BASED PAGINATION
    const page = (typeof pageOrDirection === 'number') ? pageOrDirection : pagination.currentPage;
    requestConfig = {
      ...parsedRequest,
      params: {
        ...(parsedRequest.params || {}),
        [pagination.pageParamName]: String(page),
        [pagination.perPageParamName]: String(pagination.perPage)
      }
    };
    if (typeof pageOrDirection === 'number') {
      setPagination({ currentPage: page });
    }
  } else {
    // No pagination detected - raw fetch
    requestConfig = { ...parsedRequest };
  }

  // Execute with retry logic
  let retryCount = 0;
  const maxRetries = rateLimit.retryOn429 ? rateLimit.maxRetries : 0;

  while (true) {
    try {
      setRateLimit({ lastRequestTime: Date.now(), retryCount });

      let result;
      if (window.switchboard) {
        result = await window.switchboard.executeRequest(requestConfig);
      } else {
        result = await browserFetch(requestConfig);
      }

      // Check for 429 Too Many Requests
      if (result.status === 429 && retryCount < maxRetries) {
        retryCount++;
        // Get retry-after from headers, default to exponential backoff
        const retryAfter = result.headers?.['retry-after'];
        let waitMs;
        if (retryAfter) {
          waitMs = parseInt(retryAfter, 10) * 1000; // retry-after is in seconds
          if (isNaN(waitMs)) waitMs = 2000 * retryCount;
        } else {
          waitMs = Math.min(2000 * Math.pow(2, retryCount - 1), 30000); // exponential backoff, max 30s
        }

        setRateLimit({ isWaiting: true, waitUntil: Date.now() + waitMs, retryCount });
        await sleep(waitMs);
        setRateLimit({ isWaiting: false, waitUntil: null });
        continue; // retry
      }

      // Extract rate limit info from headers
      const rateLimitInfo = extractRateLimitInfo(result.headers);
      if (rateLimitInfo) {
        setRateLimit({ rateLimitInfo, retryCount: 0 });
      }

      // Detect cursor-based pagination from response
      if (result.success && result.data) {
        const cursorInfo = detectCursorFromResponse(result.data);

        if (cursorInfo) {
          // Build current page's cursor entry for "prev" stack
          const currentEntry = pagination.nextPageUrl
            ? { url: pagination.nextPageUrl }
            : pagination.nextCursor
              ? { cursor: pagination.nextCursor }
              : { url: parsedRequest.url + (parsedRequest.params ? '?' + new URLSearchParams(parsedRequest.params).toString() : '') };

          const newState = {
            hasDetected: true,
            mode: 'cursor',
          };

          if (cursorInfo.isUrl) {
            newState.nextPageUrl = cursorInfo.value;
            newState.nextCursor = null;
          } else {
            newState.nextCursor = cursorInfo.value;
            newState.nextPageUrl = null;
            // Try to detect the cursor param name from the URL
            if (!pagination.cursorParamName) {
              newState.cursorParamName = guessCursorParamName(cursorInfo.path);
            }
          }

          if (pageOrDirection === 'next') {
            newState.currentPage = pagination.currentPage + 1;
            newState.prevCursors = [...pagination.prevCursors, currentEntry];
          } else if (pageOrDirection !== 'prev') {
            // First fetch - reset cursors
            newState.currentPage = 1;
            newState.prevCursors = [];
          }

          setPagination(newState);
        } else if (pagination.mode === 'cursor' && !cursorInfo) {
          // No cursor found in response - we're on the last page
          setPagination({ nextCursor: null, nextPageUrl: null });
          if (pageOrDirection === 'next') {
            const currentEntry = pagination.nextPageUrl
              ? { url: pagination.nextPageUrl }
              : pagination.nextCursor
                ? { cursor: pagination.nextCursor }
                : null;
            if (currentEntry) {
              setPagination({
                currentPage: pagination.currentPage + 1,
                prevCursors: [...pagination.prevCursors, currentEntry]
              });
            }
          }
        }
      }

      setApiResponse(result);
      setActiveTab('response');
      break; // success, exit retry loop

    } catch (err) {
      if (retryCount < maxRetries) {
        retryCount++;
        const waitMs = 2000 * retryCount;
        setRateLimit({ isWaiting: true, waitUntil: Date.now() + waitMs, retryCount });
        await sleep(waitMs);
        setRateLimit({ isWaiting: false, waitUntil: null });
        continue;
      }
      setExecuteError(err.message);
      break;
    }
  }

  setIsExecuting(false);
}

/**
 * Guess the cursor param name from the response path
 */
function guessCursorParamName(responsePath) {
  const mapping = {
    'meta.next_cursor': 'cursor',
    'cursor.next': 'cursor',
    'next_cursor': 'cursor',
    'nextPageToken': 'pageToken',
    'pagination.next_cursor': 'cursor',
  };
  return mapping[responsePath] || 'cursor';
}

/**
 * Browser-mode fetch using Vite dev server proxy to bypass CORS.
 * Routes: /api-proxy/{real-url} -> Vite proxy -> real API server
 * Falls back to direct fetch if proxy unavailable (production build).
 */
async function browserFetch(requestConfig) {
  const { method, url, headers, data, params } = requestConfig;
  const startTime = Date.now();

  try {
    // Build full URL with query params
    let fullUrl = url;
    if (params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams(params).toString();
      fullUrl += (fullUrl.includes('?') ? '&' : '?') + qs;
    }

    // In dev mode, route through Vite proxy to bypass CORS
    const isDev = window.location.hostname === 'localhost';
    const fetchUrl = isDev ? `/api-proxy/${fullUrl}` : fullUrl;

    const fetchHeaders = { ...(headers || {}) };
    // Remove host header for proxy (Vite handles it)
    delete fetchHeaders['Host'];
    delete fetchHeaders['host'];

    const fetchOptions = {
      method: method || 'GET',
      headers: fetchHeaders
    };

    if (data && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = typeof data === 'string' ? data : JSON.stringify(data);
    }

    const response = await fetch(fetchUrl, fetchOptions);
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let responseData;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    return {
      success: true,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      data: responseData,
      timing: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      error: error.message.includes('Failed to fetch')
        ? `Network error: Could not reach the API. Check the URL or try Electron mode.`
        : error.message,
      code: 'BROWSER_FETCH_ERROR'
    };
  }
}

export default CurlInput;
