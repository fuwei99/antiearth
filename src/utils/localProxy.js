import http from 'http';
import https from 'https';
import net from 'net';
import { URL } from 'url';
import { log } from './logger.js';

let _proxyServer = null;
let _localUrl = null;

export function startLocalProxy(localPort = 0) {
  const upstreamProxyUrl = process.env.AUTH_PROXY || process.env.PROXY;
  const parsed = upstreamProxyUrl ? new URL(upstreamProxyUrl) : null;
  const upstreamHost = parsed?.hostname;
  const upstreamPort = parsed ? (parseInt(parsed.port, 10) || 80) : null;
  const auth = parsed && (parsed.username || parsed.password)
    ? 'Basic ' + Buffer.from(`${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`).toString('base64')
    : null;

  const server = http.createServer((req, res) => {
    let requestModule = http;
    let requestOptions;

    if (parsed) {
      requestOptions = {
        host: upstreamHost,
        port: upstreamPort,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          ...(auth ? { 'Proxy-Authorization': auth } : {}),
        },
      };
    } else {
      const target = new URL(req.url);
      requestModule = target.protocol === 'https:' ? https : http;
      requestOptions = {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers: { ...req.headers, host: target.host },
      };
      delete requestOptions.headers['proxy-authorization'];
    }

    const proxyReq = requestModule.request(requestOptions);
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
    if (!parsed) {
      const [targetHost, targetPort = '443'] = req.url.split(':');
      const targetSocket = net.connect(Number(targetPort), targetHost, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head?.length) targetSocket.write(head);
        targetSocket.pipe(clientSocket);
        clientSocket.pipe(targetSocket);
      });
      targetSocket.on('error', () => clientSocket.end());
      return;
    }

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
      const exit = upstreamProxyUrl
        ? upstreamProxyUrl.replace(/\/\/[^:]+:[^@]+@/, '//@')
        : 'DIRECT';
      log.info(`[LocalProxy] 本地代理已启动: ${localUrl} -> ${exit}`);
      _proxyServer = server;
      _localUrl = localUrl;
      resolve({ server, localUrl });
    });
  });
}

export function getLocalProxy() {
  return { server: _proxyServer, localUrl: _localUrl };
}
