// A synchronous PostgreSQL connection with the surface of node:sqlite's DatabaseSync that the board uses:
// prepare(sql).get/all/run, exec(sql), close(). The pg driver runs in a worker thread (pg-worker.mjs) and every call
// blocks this thread until the answer is back, so a request's reads and writes still follow one another with nothing
// in between, exactly as they did with node:sqlite. SQL is written with ? placeholders, as before.
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';

const WAIT_MS = 90 * 1000; // longer than the worker's start-up wait and statement_timeout, so its own error arrives first

// ? -> $1, $2 ... outside quoted strings.
function numbered(sql) {
  let n = 0;
  return sql.split("'").map((part, i) => (i % 2 ? part : part.replace(/\?/g, () => '$' + ++n))).join("'");
}

export function openPg(url) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(new URL('./pg-worker.mjs', import.meta.url), { workerData: { url, signal, port: port2 }, transferList: [port2] });
  worker.unref();
  port1.unref();
  let seq = 0;
  let closed = false;
  const call = (msg) => {
    if (closed) throw new Error('database is closed');
    const mine = ++seq;
    Atomics.store(signal, 0, 0);
    port1.postMessage({ ...msg, seq: mine });
    for (;;) {
      if (Atomics.wait(signal, 0, 0, WAIT_MS) === 'timed-out') throw new Error(`database did not answer within ${WAIT_MS / 1000} s`);
      Atomics.store(signal, 0, 0);
      let got;
      while ((got = receiveMessageOnPort(port1))) {
        const r = got.message;
        if (r.seq !== mine) continue; // the late answer to a call that already timed out
        if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
        return r;
      }
    }
  };
  return {
    prepare(sql) {
      const text = numbered(sql);
      return {
        get: (...params) => call({ sql: text, params }).rows[0],
        all: (...params) => call({ sql: text, params }).rows,
        // lastInsertRowid needs the INSERT to say RETURNING id.
        run: (...params) => { const r = call({ sql: text, params }); return { changes: r.rowCount, lastInsertRowid: r.rows[0]?.id }; },
      };
    },
    exec(sql) { call({ sql, simple: true }); },
    close() {
      if (closed) return;
      try { call({ close: true }); } finally { closed = true; worker.terminate(); }
    },
  };
}
