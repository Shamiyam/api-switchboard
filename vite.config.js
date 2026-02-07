import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Custom CORS proxy plugin - handles /api-proxy/{url} requests
function corsProxyPlugin() {
  return {
    name: 'cors-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api-proxy/')) return next();

        // Extract the real URL from the request path
        const realUrl = req.url.replace('/api-proxy/', '');

        try {
          // Dynamic import node's https/http
          const { default: https } = await import('https');
          const { default: http } = await import('http');

          const targetUrl = new URL(realUrl);
          const client = targetUrl.protocol === 'https:' ? https : http;

          // Forward headers (except host)
          const forwardHeaders = { ...req.headers };
          delete forwardHeaders.host;
          delete forwardHeaders.referer;
          delete forwardHeaders.origin;
          forwardHeaders.host = targetUrl.host;

          const proxyReq = client.request(
            targetUrl.href,
            {
              method: req.method || 'GET',
              headers: forwardHeaders,
            },
            (proxyRes) => {
              // Set CORS headers
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Allow-Methods', '*');
              res.setHeader('Access-Control-Allow-Headers', '*');

              // Forward status and headers
              res.writeHead(proxyRes.statusCode, proxyRes.headers);
              proxyRes.pipe(res);
            }
          );

          // Forward request body for POST/PUT/PATCH
          if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
            req.pipe(proxyReq);
          } else {
            proxyReq.end();
          }

          proxyReq.on('error', (err) => {
            res.writeHead(502);
            res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
          });

        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: `Proxy URL parse error: ${err.message}` }));
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), corsProxyPlugin()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist',
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
