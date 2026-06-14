import http from 'http';
import { URL } from 'url';
import { log } from './logger.js';

let _proxyServer = null;
let _localUrl = null;

export function startLocalProxy(upstreamProxyUrl, localPort = 0) {
  const parsed = new URL(upstreamProxyUrl);
  const upstreamHost = parsed.hostname;
  const upstreamPort = parseInt(parsed.port, 10) || 80;
  const auth = (parsed.username || parsed.password)
    ? 'Basic ' + Buffer.from(`${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`).toString('base64')
    : null;

  const server = http.createServer((req, res) => {
    const proxyReq = http.request({
      host: upstreamHost,
      port: upstreamPort,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        ...(auth ? { 'Proxy-Authorization': auth } : {}),
      },
    });
    proxyReq.on('response', (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => {
      res.writeHead(502);
      res.end(`Upstream proxy error: ${e.message}`);
    });
    req.pipe(proxyReq);
  });

  server.on('connect', (req, clientSocket, head) => {
    const proxyReq = http.request({
      host: upstreamHost,
      port: upstreamPort,
      method: 'CONNECT',
      path: req.url,
      headers: {
        ...req.headers,
        ...(auth ? { 'Proxy-Authorization': auth } : {}),
      },
    });
    proxyReq.on('connect', (proxyRes, proxySocket) => {
      clientSocket.write(`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n\r\n`);
      proxySocket.pipe(clientSocket);
      clientSocket.pipe(proxySocket);
    });
    proxyReq.on('error', () => {
      clientSocket.end();
    });
    if (head && head.length) proxyReq.write(head);
    proxyReq.end();
  });

  return new Promise((resolve) => {
    server.listen(localPort, '127.0.0.1', () => {
      const addr = server.address();
      const localUrl = `http://127.0.0.1:${addr.port}`;
      const maskedUpstream = upstreamProxyUrl.replace(/\/\/[^:]+:[^@]+@/, '//@');
      log.info(`[LocalProxy] 本地代理已启动: ${localUrl} -> ${maskedUpstream}`);
      _proxyServer = server;
      _localUrl = localUrl;
      resolve({ server, localUrl });
    });
  });
}

export function getLocalProxy() {
  return { server: _proxyServer, localUrl: _localUrl };
}
