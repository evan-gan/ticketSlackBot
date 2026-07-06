import * as http from 'http';
import { UNCLAIMED_TEXT, CLAIMED_TEXT_FORMAT, WEB_PAGE_REFRESH_SECONDS } from './constants';

/**
 * HTTP server that serves the ticket queue as an HTML page.
 * updateQueue in tickets.ts pushes a snapshot here on every queue change,
 * so page loads never hit the Slack API. Each ticket has a Resolve button
 * that POSTs to /resolve; the actual resolution is delegated to a handler
 * injected from main.ts (avoids a circular import with tickets.ts).
 */

export interface QueueSnapshotTicket {
  ticketTs: string;
  threadUrl: string;
  responders: string[];
}

/** Resolves a ticket by its ticket message timestamp. Returns false if no such ticket. */
export type ResolveHandler = (ticketTs: string) => Promise<boolean>;

let queueSnapshot: QueueSnapshotTicket[] | null = null;
let snapshotUpdatedAt: Date | null = null;

/**
 * Records the current queue state. Called by updateQueue on every queue change.
 */
export function setQueueSnapshot(ticketsInQueue: QueueSnapshotTicket[]): void {
  queueSnapshot = ticketsInQueue;
  snapshotUpdatedAt = new Date();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderQueuePage(): string {
  const timestamp = snapshotUpdatedAt
    ? snapshotUpdatedAt.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : null;

  let body: string;
  if (queueSnapshot === null) {
    body = '<p class="empty">⏳ Queue not loaded yet — the bot is still starting up.</p>';
  } else if (queueSnapshot.length === 0) {
    body = '<p class="empty">✅ All tickets have been responded to!</p>';
  } else {
    const items = queueSnapshot
      .map(ticket => {
        const claimStatus = ticket.responders.length === 0
          ? escapeHtml(UNCLAIMED_TEXT)
          : escapeHtml(
              CLAIMED_TEXT_FORMAT.replace(
                '{mentions}',
                ticket.responders.map(name => `@${name}`).join(', ')
              )
            );
        return `<li>
        <strong>${claimStatus}</strong> — <a href="${escapeHtml(ticket.threadUrl)}" target="_blank" rel="noopener">View thread</a>
        <form method="POST" action="/resolve" onsubmit="return confirm('Resolve this ticket?')">
          <input type="hidden" name="ticketTs" value="${escapeHtml(ticket.ticketTs)}">
          <button type="submit">✓ Resolve</button>
        </form>
      </li>`;
      })
      .join('\n      ');
    body = `<ol>\n      ${items}\n    </ol>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="${WEB_PAGE_REFRESH_SECONDS}">
  <title>🎫 Ticket Queue</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
    h1 { font-size: 1.4rem; }
    .updated { color: gray; font-size: 0.85rem; }
    ol { padding-left: 1.5rem; }
    li { margin: 0.6rem 0; }
    li form { display: inline; margin-left: 0.5rem; }
    li button { cursor: pointer; border: 1px solid #2eb67d; background: transparent; color: #2eb67d; border-radius: 4px; padding: 0.1rem 0.5rem; font-size: 0.85rem; }
    li button:hover { background: #2eb67d; color: white; }
    .empty { font-size: 1.1rem; }
  </style>
</head>
<body>
  <h1>🎫 Tickets Needing Response</h1>
  ${timestamp ? `<p class="updated">Last updated: ${timestamp}</p>` : ''}
  ${body}
</body>
</html>
`;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 10_000) reject(new Error('Body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/**
 * Starts the HTTP server. Returns the server so callers can close it if needed.
 */
export function startWebServer(port: number, logger: any, onResolve: ResolveHandler): http.Server {
  const server = http.createServer(async (req, res) => {
    const path = (req.url || '/').split('?')[0];

    if ((req.method === 'GET' || req.method === 'HEAD') && path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(renderQueuePage());
      return;
    }

    if (req.method === 'POST' && path === '/resolve') {
      try {
        const body = await readBody(req);
        const ticketTs = new URLSearchParams(body).get('ticketTs');
        if (!ticketTs) {
          res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Missing ticketTs');
          return;
        }
        const resolved = await onResolve(ticketTs);
        if (!resolved) {
          res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Ticket not found');
          return;
        }
        // Redirect back to the queue page (POST-redirect-GET)
        res.writeHead(303, { Location: '/' }).end();
      } catch (error) {
        logger.error('❌ Error resolving ticket from web page:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Internal error');
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found');
  });

  server.on('error', (error) => {
    logger.error('❌ Web server error:', error);
  });

  server.listen(port, () => {
    logger.info(`🌐 Ticket queue web page serving on http://localhost:${port}`);
  });

  return server;
}
