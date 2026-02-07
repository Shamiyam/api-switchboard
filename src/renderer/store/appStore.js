import { create } from 'zustand';

const useAppStore = create((set, get) => ({
  // ── Layer 1: cURL Input State ──
  curlInput: '',
  parsedRequest: null,
  parseError: null,

  setCurlInput: (input) => set({ curlInput: input }),
  setParsedRequest: (request) => set({ parsedRequest: request, parseError: null }),
  setParseError: (error) => set({ parseError: error, parsedRequest: null }),

  // ── Layer 2: API Response State ──
  apiResponse: null,
  isExecuting: false,
  executeError: null,

  setApiResponse: (response) => set({ apiResponse: response, executeError: null }),
  setIsExecuting: (val) => set({ isExecuting: val }),
  setExecuteError: (error) => set({ executeError: error }),

  // ── Layer 3: Export State ──
  exportTarget: null, // 'n8n' | 'appscript'
  isExporting: false,
  exportResult: null,
  exportError: null,
  showExportModal: false,

  setExportTarget: (target) => set({ exportTarget: target }),
  setIsExporting: (val) => set({ isExporting: val }),
  setExportResult: (result) => set({ exportResult: result, exportError: null }),
  setExportError: (error) => set({ exportError: error, exportResult: null }),
  setShowExportModal: (val) => set({ showExportModal: val }),

  // ── Settings State ──
  showSettings: false,
  setShowSettings: (val) => set({ showSettings: val }),

  // Google auth state
  googleAuth: { authenticated: false, tokens: null },
  setGoogleAuth: (auth) => set({ googleAuth: auth }),

  // ── Config cache ──
  config: {
    n8nWebhookUrl: '',
    googleClientId: '',
    googleClientSecret: '',
    googleScriptId: '',
    googleWebAppUrl: ''
  },
  setConfigValue: (key, value) => set((state) => ({
    config: { ...state.config, [key]: value }
  })),
  setConfig: (config) => set({ config }),

  // ── Pagination State ──
  pagination: {
    currentPage: 1,
    perPage: 10,
    pageParamName: 'page',       // auto-detected or user-set
    perPageParamName: 'per_page', // auto-detected or user-set
    hasDetected: false,
    // Cursor-based pagination
    mode: 'none',                // 'none' | 'page' | 'cursor'
    nextCursor: null,            // next cursor URL or token
    prevCursors: [],             // stack of previous cursor URLs for "Back" navigation
    cursorParamName: null,       // e.g. 'since_id', 'cursor', 'after'
    nextPageUrl: null,           // full URL for next page (e.g., Workable's paging.next)
    currentPageEntry: null,      // the URL/cursor that was used to fetch the current page (for prev stack)
  },
  setPagination: (updates) => set((state) => ({
    pagination: { ...state.pagination, ...updates }
  })),
  resetPagination: () => set({
    pagination: {
      currentPage: 1, perPage: 10, pageParamName: 'page', perPageParamName: 'per_page',
      hasDetected: false, mode: 'none', nextCursor: null, prevCursors: [],
      cursorParamName: null, nextPageUrl: null, currentPageEntry: null
    }
  }),

  // Stored fetch function ref (set by CurlInput so ResponseViewer can call it for pagination)
  _fetchPageFn: null,
  setFetchPageFn: (fn) => set({ _fetchPageFn: fn }),

  // ── Rate Limit State ──
  rateLimit: {
    delayMs: 500,          // delay between requests (ms)
    retryOn429: true,       // auto-retry on 429 Too Many Requests
    maxRetries: 3,          // max retry attempts on 429
    retryCount: 0,          // current retry count
    lastRequestTime: 0,     // timestamp of last request
    rateLimitInfo: null,    // { limit, remaining, reset } from response headers
    isWaiting: false,       // true when waiting for rate limit cooldown
    waitUntil: null,        // timestamp when the wait ends
  },
  setRateLimit: (updates) => set((state) => ({
    rateLimit: { ...state.rateLimit, ...updates }
  })),
  resetRateLimit: () => set({
    rateLimit: {
      delayMs: 500, retryOn429: true, maxRetries: 3, retryCount: 0,
      lastRequestTime: 0, rateLimitInfo: null, isWaiting: false, waitUntil: null
    }
  }),

  // ── Bulk Transport State ──
  showBulkTransport: false,
  setShowBulkTransport: (val) => set({ showBulkTransport: val }),
  bulkTransport: {
    isRunning: false,
    isPaused: false,
    isCancelled: false,
    mode: 'all',           // 'all' | 'pages' | 'dateRange'
    maxPages: 10,           // for 'pages' mode
    dateFrom: '',           // for 'dateRange' mode (ISO string)
    dateTo: '',             // for 'dateRange' mode (ISO string)
    dateField: '',          // which field to filter by (e.g. 'created_at')
    // Progress tracking
    currentPage: 0,
    totalPagesSent: 0,
    totalItemsSent: 0,
    errors: [],
    log: [],               // array of { page, items, status, timestamp }
    startedAt: null,
    completedAt: null,
  },
  setBulkTransport: (updates) => set((state) => ({
    bulkTransport: { ...state.bulkTransport, ...updates }
  })),
  resetBulkTransport: () => set({
    bulkTransport: {
      isRunning: false, isPaused: false, isCancelled: false,
      mode: 'all', maxPages: 10, dateFrom: '', dateTo: '', dateField: '',
      currentPage: 0, totalPagesSent: 0, totalItemsSent: 0,
      errors: [], log: [], startedAt: null, completedAt: null,
    }
  }),

  // ── UI State ──
  activeTab: 'input', // 'input' | 'response' | 'export'
  setActiveTab: (tab) => set({ activeTab: tab }),

  // ── Reset ──
  resetAll: () => set({
    curlInput: '',
    parsedRequest: null,
    parseError: null,
    apiResponse: null,
    isExecuting: false,
    executeError: null,
    exportTarget: null,
    isExporting: false,
    exportResult: null,
    exportError: null,
    showExportModal: false,
    activeTab: 'input',
    pagination: {
      currentPage: 1, perPage: 10, pageParamName: 'page', perPageParamName: 'per_page',
      hasDetected: false, mode: 'none', nextCursor: null, prevCursors: [],
      cursorParamName: null, nextPageUrl: null, currentPageEntry: null
    },
    rateLimit: {
      delayMs: 500, retryOn429: true, maxRetries: 3, retryCount: 0,
      lastRequestTime: 0, rateLimitInfo: null, isWaiting: false, waitUntil: null
    }
  })
}));

export default useAppStore;
