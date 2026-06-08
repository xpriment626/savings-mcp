import http, { type IncomingMessage, type Server as NodeServer, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

import { loadConfig } from './config.js';
import { handleMcpRequest } from './mcp.js';
import type { AppConfig, JsonRpcRequest, JsonRpcResponse, SavingsMcpServer } from './types.js';

async function readJson(req: IncomingMessage): Promise<JsonRpcRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  return JSON.parse(text) as JsonRpcRequest;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendNoContent(res: ServerResponse, statusCode: number): void {
  res.writeHead(statusCode);
  res.end();
}

export function createSavingsMcpServer(overrides: Partial<AppConfig> = {}): SavingsMcpServer {
  const config: AppConfig = { ...loadConfig(), ...overrides };
  let server: NodeServer;

  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${config.host}:${config.port}`}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'savings-mcp',
        fixture: Boolean(config.useFixtureCatalogue)
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/mcp') {
      try {
        const body = await readJson(req);
        if (body.method === 'notifications/initialized' && body.id == null) {
          sendNoContent(res, 202);
          return;
        }
        const response: JsonRpcResponse = await handleMcpRequest(config, body);
        sendJson(res, response.error ? 400 : 200, response);
      } catch (error) {
        sendJson(res, 400, {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: error instanceof Error ? error.message : String(error)
          }
        });
      }
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/mcp') {
      sendNoContent(res, 202);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  });

  return {
    get url() {
      const address = server.address();
      if (!address || typeof address === 'string') return null;
      return `http://${config.host}:${address.port}`;
    },
    start() {
      return new Promise<void>((resolve) => {
        server.listen(config.port, config.host, () => resolve());
      });
    },
    stop() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

const isCliEntrypoint = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isCliEntrypoint) {
  const server = createSavingsMcpServer();
  await server.start();
  console.log(`Savings MCP listening on ${server.url}/mcp`);

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
