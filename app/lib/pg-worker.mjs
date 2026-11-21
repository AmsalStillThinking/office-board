// Worker thread for lib/pgsync.mjs: owns the one PostgreSQL connection and answers one message at a time.
import { workerData } from 'node:worker_threads';
import pg from 'pg';

const { url, signal, port } = workerData;
pg.types.setTypeParser(20, Number); // BIGINT (ids, millisecond times, COUNT(*)) as a JS number, as node:sqlite gave
const START_WAIT_MS = 60 * 1000; // at boot the board can start before the PostgreSQL service is ready

let client = null;
let inTx = false;
let started = false; // the long wait is for the first connection only; later a database that is gone fails at once
async function connect() {
  const until = Date.now() + (started ? 0 : START_WAIT_MS);
  for (;;) {
    const c = new pg.Client({ connectionString: url, statement_timeout: 20000, lock_timeout: 10000 });
    const drop = () => { if (client === c) client = null; }; // a dropped connection: the next statement reconnects
    c.on('error', drop);
    c.on('end', drop);
    try { await c.connect(); started = true; return c; } catch (e) {
      await c.end().catch(() => {});
      if (Date.now() > until || !['ECONNREFUSED', '57P03'].includes(e.code)) throw e; // 57P03: the server is starting
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
// The connection itself failed (no SQLSTATE, or class 08, or the server ended the session), not just the statement.
const lost = (e) => !/^[0-9A-Z]{5}$/.test(e.code || '') || /^(08|57P0)/.test(e.code);

async function run({ sql, params, simple }) {
  const verb = sql.trimStart().slice(0, 8).toUpperCase();
  if (!client) {
    // Never reconnect in the middle of a transaction: the rest of it would run outside it, one statement at a time.
    if (inTx && !verb.startsWith('ROLLBACK')) throw Object.assign(new Error('database connection lost inside a transaction'), { code: '08006' });
    if (verb.startsWith('ROLLBACK')) { inTx = false; return { rows: [], rowCount: 0 }; }
    client = await connect();
  }
  const c = client;
  try {
    const r = simple ? await c.query(sql) : await c.query(sql, params);
    const last = Array.isArray(r) ? r[r.length - 1] : r; // a multi-statement script answers with one result each
    return { rows: last.rows || [], rowCount: last.rowCount ?? 0 };
  } catch (e) {
    if (lost(e)) { if (client === c) client = null; c.end().catch(() => {}); } // killed mid-statement: never reuse it
    throw e;
  } finally {
    if (verb.startsWith('BEGIN')) inTx = true;
    else if (verb.startsWith('COMMIT') || verb.startsWith('ROLLBACK')) inTx = false;
  }
}

port.on('message', async (msg) => {
  let reply;
  try {
    if (msg.close) { if (client) await client.end(); client = null; reply = { seq: msg.seq, rows: [], rowCount: 0 }; }
    else reply = { seq: msg.seq, ...(await run(msg)) };
  } catch (e) {
    reply = { seq: msg.seq, error: { message: e.message, code: e.code } };
  }
  port.postMessage(reply);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
});
