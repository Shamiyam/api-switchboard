import React, { useState, useEffect, useCallback } from 'react';
import useAppStore from '../store/appStore';
import { parseCurl } from '../utils/curlParser';

// Known pagination parameter patterns
const PAGE_PARAM_NAMES = ['page', 'p', 'pageNumber', 'page_number', 'pageNo', 'pg', 'offset', 'skip', 'start', 'cursor', 'after'];
const PER_PAGE_PARAM_NAMES = ['per_page', 'perPage', 'page_size', 'pageSize', 'limit', 'count', 'size', 'rows', 'maxResults', 'max_results'];

function CurlInput() {
  const {
    curlInput, setCurlInput, setParsedRequest, setParseError,
    parsedRequest, isExecuting, setIsExecuting, setApiResponse,
    setExecuteError, setActiveTab, pagination, setPagination, setFetchPageFn
  } = useAppStore();

  const [parseStatus, setParseStatus] = useState(null); // 'success' | 'error' | null

  // Register the fetchPage function so ResponseViewer pagination can use it
  // Uses getState() to always read fresh store values (avoids stale closure)
  useEffect(() => {
    setFetchPageFn((page) => executeFetch(page));
  }, []);

  const handleParse = () => {
    try {
      const parsed = parseCurl(curlInput);
      setParsedRequest(parsed);
      setParseStatus('success');

      // Auto-detect pagination parameters from query params
      if (parsed.params) {
        const paramKeys = Object.keys(parsed.params);
        const detectedPageParam = paramKeys.find(k => PAGE_PARAM_NAMES.includes(k.toLowerCase()));
        const detectedPerPageParam = paramKeys.find(k => PER_PAGE_PARAM_NAMES.includes(k.toLowerCase()));

        if (detectedPageParam || detectedPerPageParam) {
          setPagination({
            pageParamName: detectedPageParam || 'page',
            perPageParamName: detectedPerPageParam || 'per_page',
            currentPage: detectedPageParam ? parseInt(parsed.params[detectedPageParam], 10) || 1 : 1,
            perPage: detectedPerPageParam ? parseInt(parsed.params[detectedPerPageParam], 10) || 10 : 10,
            hasDetected: true
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
 * Standalone fetch executor that reads fresh state from the Zustand store.
 * This avoids stale closure issues when called from ResponseViewer pagination.
 */
async function executeFetch(pageOverride) {
  const state = useAppStore.getState();
  const { parsedRequest, pagination, setIsExecuting, setExecuteError, setApiResponse, setActiveTab, setPagination } = state;

  if (!parsedRequest) return;
  setIsExecuting(true);
  setExecuteError(null);

  // Build request with current pagination params injected
  const requestWithPagination = { ...parsedRequest, params: { ...(parsedRequest.params || {}) } };
  if (pagination.hasDetected) {
    const page = (typeof pageOverride === 'number') ? pageOverride : pagination.currentPage;
    requestWithPagination.params[pagination.pageParamName] = String(page);
    requestWithPagination.params[pagination.perPageParamName] = String(pagination.perPage);
    if (typeof pageOverride === 'number') {
      setPagination({ currentPage: page });
    }
  }

  try {
    let result;
    if (window.switchboard) {
      result = await window.switchboard.executeRequest(requestWithPagination);
    } else {
      result = await browserFetch(requestWithPagination);
    }

    setApiResponse(result);
    setActiveTab('response');
  } catch (err) {
    setExecuteError(err.message);
  } finally {
    setIsExecuting(false);
  }
}

/**
 * Browser-mode fetch using Vite dev server proxy to bypass CORS.
 * Routes: /api-proxy/{real-url} → Vite proxy → real API server
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
