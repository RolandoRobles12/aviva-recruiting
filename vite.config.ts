import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const CLOUD_RUN_HASH = 'wp5lebnvja-uc';

/** Proxy /api/<functionName> → https://<functionname>-<hash>.a.run.app/ */
function cloudRunProxy(): Plugin {
  return {
    name: 'cloud-run-proxy',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res) => {
        const url = req.url || '/';
        const [pathPart, query] = url.split('?');
        const fnName = pathPart.replace(/^\//, '').split('/')[0];
        if (!fnName) { res.statusCode = 404; res.end('Missing function name'); return; }

        const target = `https://${fnName.toLowerCase()}-${CLOUD_RUN_HASH}.a.run.app${query ? `?${query}` : ''}`;

        // Collect request body for POST
        let body: string | undefined;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          body = await new Promise((resolve) => {
            let data = '';
            req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
            req.on('end', () => resolve(data));
          });
        }

        try {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            if (value && key !== 'host' && key !== 'connection') {
              headers[key] = Array.isArray(value) ? value[0] : value;
            }
          }

          const resp = await fetch(target, {
            method: req.method,
            headers,
            body,
          });

          res.statusCode = resp.status;
          resp.headers.forEach((value, key) => {
            if (key !== 'transfer-encoding' && key !== 'content-encoding') {
              res.setHeader(key, value);
            }
          });
          const respBody = Buffer.from(await resp.arrayBuffer());
          res.end(respBody);
        } catch (err) {
          console.error(`[cloud-run-proxy] ${fnName} error:`, err);
          res.statusCode = 502;
          res.end(JSON.stringify({ ok: false, error: 'Proxy error' }));
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudRunProxy()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
  },
})
