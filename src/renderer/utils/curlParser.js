/**
 * cURL Parser - Layer 1 of the Switchboard
 * Converts raw cURL command strings into structured request config objects.
 * Handles: GET/POST/PUT/PATCH/DELETE, headers, data/body, query params, auth
 */

export function parseCurl(curlString) {
  if (!curlString || typeof curlString !== 'string') {
    throw new Error('Invalid input: please paste a cURL command');
  }

  // Normalize: remove line continuations and extra whitespace
  let raw = curlString
    .replace(/\\\n/g, ' ')   // backslash newline
    .replace(/\\\r\n/g, ' ') // windows line continuation
    .replace(/`\n/g, ' ')    // PowerShell backtick continuation
    .replace(/\s+/g, ' ')
    .trim();

  // Strip leading "curl" keyword
  if (raw.toLowerCase().startsWith('curl ')) {
    raw = raw.substring(5).trim();
  } else if (raw.toLowerCase() === 'curl') {
    throw new Error('No URL provided in cURL command');
  }

  const result = {
    method: 'GET',
    url: '',
    headers: {},
    data: null,
    params: {},
    auth: null
  };

  const tokens = tokenize(raw);
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    // Method
    if (token === '-X' || token === '--request') {
      i++;
      if (i < tokens.length) {
        result.method = tokens[i].toUpperCase();
      }
    }
    // Headers
    else if (token === '-H' || token === '--header') {
      i++;
      if (i < tokens.length) {
        const headerStr = stripQuotes(tokens[i]);
        const colonIdx = headerStr.indexOf(':');
        if (colonIdx > 0) {
          const key = headerStr.substring(0, colonIdx).trim();
          const value = headerStr.substring(colonIdx + 1).trim();
          result.headers[key] = value;
        }
      }
    }
    // Data / Body
    else if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary' || token === '--data-urlencode') {
      i++;
      if (i < tokens.length) {
        const bodyStr = stripQuotes(tokens[i]);
        result.data = tryParseJSON(bodyStr) || bodyStr;
        // If sending data, default to POST unless explicitly set
        if (result.method === 'GET' && !tokens.includes('-X') && !tokens.includes('--request')) {
          result.method = 'POST';
        }
      }
    }
    // Basic Auth
    else if (token === '-u' || token === '--user') {
      i++;
      if (i < tokens.length) {
        const authStr = stripQuotes(tokens[i]);
        const [username, password] = authStr.split(':');
        result.auth = { username, password: password || '' };
        result.headers['Authorization'] = 'Basic ' + btoa(authStr);
      }
    }
    // Bearer token shorthand
    else if (token === '--oauth2-bearer') {
      i++;
      if (i < tokens.length) {
        result.headers['Authorization'] = `Bearer ${stripQuotes(tokens[i])}`;
      }
    }
    // Compressed
    else if (token === '--compressed') {
      // Accept-Encoding is implicit, skip
    }
    // Follow redirects
    else if (token === '-L' || token === '--location') {
      // Axios follows by default, skip
    }
    // Silent/verbose flags (ignore)
    else if (token === '-s' || token === '--silent' || token === '-v' || token === '--verbose' || token === '-k' || token === '--insecure' || token === '-i' || token === '--include') {
      // Skip
    }
    // URL (anything that looks like a URL or doesn't start with -)
    else if (!token.startsWith('-') || token.match(/^https?:\/\//)) {
      const urlStr = stripQuotes(token);
      if (urlStr.match(/^https?:\/\//) || urlStr.match(/^[a-zA-Z0-9].*\..+/)) {
        // Parse URL and extract query params
        try {
          const urlObj = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
          result.url = `${urlObj.origin}${urlObj.pathname}`;
          urlObj.searchParams.forEach((value, key) => {
            result.params[key] = value;
          });
        } catch {
          result.url = urlStr;
        }
      }
    }

    i++;
  }

  if (!result.url) {
    throw new Error('No URL found in cURL command');
  }

  // Clean up empty objects
  if (Object.keys(result.params).length === 0) delete result.params;
  if (Object.keys(result.headers).length === 0) delete result.headers;
  if (!result.data) delete result.data;
  if (!result.auth) delete result.auth;

  return result;
}

/**
 * Tokenize a cURL command string, respecting quoted strings
 */
function tokenize(input) {
  const tokens = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Strip surrounding quotes from a string
 */
function stripQuotes(str) {
  if (!str) return str;
  if ((str.startsWith("'") && str.endsWith("'")) ||
      (str.startsWith('"') && str.endsWith('"'))) {
    return str.slice(1, -1);
  }
  return str;
}

/**
 * Try to parse a string as JSON, return null if it fails
 */
function tryParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * Convert a request config back to a cURL string (for display/copy)
 */
export function toCurl(config) {
  const parts = ['curl'];

  if (config.method && config.method !== 'GET') {
    parts.push(`-X ${config.method}`);
  }

  let url = config.url;
  if (config.params && Object.keys(config.params).length > 0) {
    const qs = new URLSearchParams(config.params).toString();
    url += `?${qs}`;
  }
  parts.push(`'${url}'`);

  if (config.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      parts.push(`-H '${key}: ${value}'`);
    }
  }

  if (config.data) {
    const body = typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
    parts.push(`-d '${body}'`);
  }

  return parts.join(' \\\n  ');
}
