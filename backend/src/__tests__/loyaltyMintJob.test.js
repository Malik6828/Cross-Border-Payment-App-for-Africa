'use strict';

/**
 * Tests for loyaltyMintJob.js
 *
 * Coverage:
 *  1. Concurrency — two concurrent callers against the same pending row call
 *     mintPoints() exactly once (the second caller finds an empty queue because
 *     the first has already set status='processing' inside its transaction).
 *  2. ON CONFLICT DO NOTHING — enqueueLoyaltyMint() never creates duplicate rows.
 *  3. Status transitions & retry_count — pending→processing→completed,
 *     pending→processing→pending (retry), pending→processing→failed (max retries).
 *  4. claimNextJob — unit tests for BEGIN/COMMIT/ROLLBACK sequencing.
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before any require() calls
// ---------------------------------------------------------------------------

jest.mock('../db', () => ({
  query:        jest.fn(),
  pool:         { connect: jest.fn() },
  getPoolStats: jest.fn(),
}));

 * Tests for backend/src/jobs/loyaltyMintJob.js
 *
 * Covers:
 *   - Concurrency: two simulated callers against the same pending row →
 *     mintPoints() called exactly once (#893 regression)
 *   - ON CONFLICT DO NOTHING enqueue path: no duplicate queue rows
 *   - retry_count and status transitions remain correct after the fix
 *   - Distributed lock defence: withLock skips a slot when already held
 */

// ---------------------------------------------------------------------------
// Mock logger (must come first – jest.mock is hoisted)
// ---------------------------------------------------------------------------
jest.mock('../utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
}));

// Disable the distributed lock so concurrency tests are driven purely by the
// DB-transaction logic rather than the Redis layer.
jest.mock('../utils/distributedLock', () => ({
  withLock: jest.fn(async (_key, _ttl, fn) => { await fn(); return true; }),
}));

  debug: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock notificationInbox so we don't need the full broadcast infrastructure
// ---------------------------------------------------------------------------
jest.mock('../services/notificationInbox', () => ({
  persistAndBroadcast: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock loyaltyToken service
// ---------------------------------------------------------------------------
jest.mock('../services/loyaltyToken', () => ({
  mintPoints: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const db         = require('../db');
const { mintPoints } = require('../services/loyaltyToken');
const { processLoyaltyMintQueue, enqueueLoyaltyMint, claimNextJob } =
  require('../jobs/loyaltyMintJob');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const JOB_ID   = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER_ID  = 'bbbbbbbb-0000-0000-0000-000000000002';
const WALLET   = 'GCSEQ5XE5YYKPITLT63FZ7LCW2JZNYVP3L2XKMGELRKGPNZXNNBVPOU3';
const TX_HASH  = 'c'.repeat(64);

const PENDING_JOB = {
  id:            JOB_ID,
  user_id:       USER_ID,
  sender_wallet: WALLET,
  amount:        '10',
  asset:         'XLM',
  retry_count:   0,
  tx_status:     'completed',
  tx_hash:       TX_HASH,
};

// ---------------------------------------------------------------------------
// Global env setup
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.LOYALTY_TOKEN_CONTRACT_ID = 'CTEST_CONTRACT_ID';
  process.env.LOYALTY_MINT_CONCURRENCY  = '1'; // keep tests predictable
});

afterAll(() => {
  delete process.env.LOYALTY_TOKEN_CONTRACT_ID;
  delete process.env.LOYALTY_MINT_CONCURRENCY;
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Test client factory
//
// Returns a mock pg PoolClient whose query() method delegates to a
// caller-supplied handler.  BEGIN / COMMIT / ROLLBACK are handled
// automatically so tests only need to supply logic for real SQL statements.
// ---------------------------------------------------------------------------

function makeMockClient(handler) {
  const txState = { inTx: false };
  return {
    txState,
    query: jest.fn(async (sql, params) => {
      const norm = sql.replace(/\s+/g, ' ').trim().toUpperCase();
      if (norm === 'BEGIN')    { txState.inTx = true;  return { rows: [] }; }
      if (norm === 'COMMIT')   { txState.inTx = false; return { rows: [] }; }
      if (norm === 'ROLLBACK') { txState.inTx = false; return { rows: [] }; }
      return handler(sql, params, txState);
    }),
    release: jest.fn(),
  };
}

// ===========================================================================
// 1. CONCURRENCY TEST
// ===========================================================================

describe('processLoyaltyMintQueue — concurrency', () => {
  /**
   * Caller A:  BEGIN → SELECT (finds row) → UPDATE status='processing' → COMMIT
   * Caller B:  BEGIN → SELECT FOR UPDATE SKIP LOCKED (row claimed, returns []) → ROLLBACK
   *
   * We simulate SKIP LOCKED by giving the second pool.connect() a client whose
   * SELECT always returns an empty row set.
   */
  test('mintPoints is called exactly once when two callers race on the same row', async () => {
    mintPoints.mockResolvedValue({ txHash: TX_HASH });
    db.query.mockResolvedValue({ rows: [] });

    const clientA = makeMockClient((sql) =>
      sql.includes('SELECT') && sql.includes('loyalty_mint_queue')
        ? { rows: [PENDING_JOB] }
        : { rows: [] },
    );
    const clientB = makeMockClient(() => ({ rows: [] })); // SKIP LOCKED — empty

    let callCount = 0;
    db.pool.connect.mockImplementation(async () => (++callCount % 2 === 1 ? clientA : clientB));

// Mock distributedLock — by default withLock just runs fn (single-instance
// mode). Individual tests can override this to test lock-held behaviour.
// ---------------------------------------------------------------------------
jest.mock('../utils/distributedLock', () => ({
  withLock: jest.fn(async (_key, _ttl, fn) => {
    await fn();
    return true;
  }),
}));

// ---------------------------------------------------------------------------
// Mock db module
// ---------------------------------------------------------------------------
jest.mock('../db');

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
const db           = require('../db');
const { mintPoints } = require('../services/loyaltyToken');
const { withLock }   = require('../utils/distributedLock');
const { processLoyaltyMintQueue, enqueueLoyaltyMint } = require('../jobs/loyaltyMintJob');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FAKE_TX_HASH = 'b'.repeat(64);

const PENDING_JOB = {
  id:            'job-uuid-1',
  user_id:       'user-uuid-1',
  sender_wallet: 'GCSEQ5XE5YYKPITLT63FZ7LCW2JZNYVP3L2XKMGELRKGPNZXNNBVPOU3',
  amount:        '100',
  asset:         'XLM',
  retry_count:   0,
  tx_status:     'completed',
  tx_hash:       'original-hash',
};

/**
 * Build a mock pg client that simulates:
 *   1. BEGIN  → ok
 *   2. SELECT → returns `jobRow` (or empty if null)
 *   3. UPDATE status='processing' → ok
 *   4. COMMIT → ok
 *
 * Subsequent query calls (post-claimNextJob) fall through to `db.query`.
 */
function buildMockClient(jobRow) {
  let callCount = 0;
  const client = {
    query: jest.fn(async (sql) => {
      callCount += 1;
      if (callCount === 1) {
        // BEGIN
        expect(sql.trim().toUpperCase()).toBe('BEGIN');
        return { rows: [] };
      }
      if (callCount === 2) {
        // SELECT FOR UPDATE
        expect(sql).toMatch(/FOR UPDATE/i);
        return { rows: jobRow ? [jobRow] : [] };
      }
      if (callCount === 3) {
        // UPDATE status='processing'
        expect(sql).toMatch(/status\s*=\s*'processing'/i);
        return { rows: [] };
      }
      if (callCount === 4) {
        // COMMIT
        expect(sql.trim().toUpperCase()).toBe('COMMIT');
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  return client;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();

  // Default: LOYALTY_MINT_CONCURRENCY=1 to keep tests simple
  process.env.LOYALTY_MINT_CONCURRENCY = '1';
  process.env.LOYALTY_TOKEN_CONTRACT_ID = 'CONTRACT_XYZ';

  // Default db.query (post-claim updates and inserts)
  db.query.mockResolvedValue({ rows: [] });

  // Default pool.connect returns a single-job client
  db.pool = { connect: jest.fn() };
  db.pool.connect.mockResolvedValue(buildMockClient(PENDING_JOB));

  // Default mintPoints returns a valid result
  mintPoints.mockResolvedValue({ txHash: FAKE_TX_HASH });

  // Default withLock: transparent pass-through (single-instance mode)
  withLock.mockImplementation(async (_key, _ttl, fn) => {
    await fn();
    return true;
  });
});

afterEach(() => {
  delete process.env.LOYALTY_MINT_CONCURRENCY;
  delete process.env.LOYALTY_TOKEN_CONTRACT_ID;
});

// ===========================================================================
// #893 CONCURRENCY REGRESSION
// Two concurrent callers simulate overlapping processLoyaltyMintQueue() ticks.
// Because each call gets its own pool client with its own BEGIN/COMMIT, the
// second call should find no 'pending' row (SKIP LOCKED semantics) and
// therefore NOT call mintPoints().
// ===========================================================================
describe('#893 concurrency — mintPoints() called exactly once per row', () => {
  test('two concurrent processLoyaltyMintQueue calls invoke mintPoints once', async () => {
    // Simulate SKIP LOCKED: the first client sees the pending row;
    // the second client sees no rows (the row is locked by the first).
    let connectCount = 0;
    db.pool.connect.mockImplementation(async () => {
      connectCount += 1;
      // First caller gets the job; second caller gets an empty result set.
      return buildMockClient(connectCount === 1 ? PENDING_JOB : null);
    });

    // Run both callers concurrently — mimics two cron ticks overlapping.
    await Promise.all([
      processLoyaltyMintQueue(),
      processLoyaltyMintQueue(),
    ]);

    // Primary assertion: only one on-chain mint regardless of concurrency
    expect(mintPoints).toHaveBeenCalledTimes(1);
    expect(mintPoints).toHaveBeenCalledWith({
      recipientWallet: WALLET,
      points:          10,
    });
  });

  test('both concurrent callers resolve without throwing', async () => {
    mintPoints.mockResolvedValue({ txHash: TX_HASH });
    db.query.mockResolvedValue({ rows: [] });

    const clientA = makeMockClient((sql) =>
      sql.includes('SELECT') && sql.includes('loyalty_mint_queue')
        ? { rows: [PENDING_JOB] }
        : { rows: [] },
    );
    const clientB = makeMockClient(() => ({ rows: [] }));

    let n = 0;
    db.pool.connect.mockImplementation(async () => (++n % 2 === 1 ? clientA : clientB));

    await expect(
      Promise.all([processLoyaltyMintQueue(), processLoyaltyMintQueue()]),
    ).resolves.not.toThrow();
  });

  test('BEGIN appears before SELECT, UPDATE appears before COMMIT inside claimNextJob', async () => {
    mintPoints.mockResolvedValue({ txHash: TX_HASH });
    db.query.mockResolvedValue({ rows: [] });

    const clientA = makeMockClient((sql) =>
      sql.includes('SELECT') && sql.includes('loyalty_mint_queue')
        ? { rows: [PENDING_JOB] }
        : { rows: [] },
    );
    db.pool.connect.mockResolvedValue(clientA);

    await processLoyaltyMintQueue();

    const calls = clientA.query.mock.calls.map(([s]) =>
      s.replace(/\s+/g, ' ').trim().toUpperCase(),
    );

    const beginIdx  = calls.findIndex((s) => s === 'BEGIN');
    const selectIdx = calls.findIndex((s) => s.includes('SELECT'));
    const updateIdx = calls.findIndex((s) => s.includes('UPDATE') && s.includes('PROCESSING'));
    const commitIdx = calls.findIndex((s) => s === 'COMMIT');

    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(selectIdx).toBeGreaterThan(beginIdx);
    expect(updateIdx).toBeGreaterThan(selectIdx);
    expect(commitIdx).toBeGreaterThan(updateIdx);
  });
});

// ===========================================================================
// 2. ON CONFLICT DO NOTHING — enqueue path
// ===========================================================================

describe('enqueueLoyaltyMint — ON CONFLICT DO NOTHING', () => {
  test('inserts and returns the id on first call', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: JOB_ID }] });

    const id = await enqueueLoyaltyMint(JOB_ID, USER_ID, WALLET, '10', 'XLM');

    expect(id).toBe(JOB_ID);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/i);
    expect(params[0]).toBe(JOB_ID);
  });

  test('returns undefined (no error) on duplicate — RETURNING returns empty set', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // ON CONFLICT DO NOTHING → no row returned

    const id = await enqueueLoyaltyMint(JOB_ID, USER_ID, WALLET, '10', 'XLM');

    expect(id).toBeUndefined();
    expect(db.query).toHaveBeenCalledTimes(1); // only one INSERT
  });

  test('two calls for the same txId each issue exactly one INSERT, second gets no row', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: JOB_ID }] })
      .mockResolvedValueOnce({ rows: [] });

    const id1 = await enqueueLoyaltyMint(JOB_ID, USER_ID, WALLET, '10', 'XLM');
    const id2 = await enqueueLoyaltyMint(JOB_ID, USER_ID, WALLET, '10', 'XLM');

    expect(id1).toBe(JOB_ID);
    expect(id2).toBeUndefined();
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  test('returns null immediately when LOYALTY_TOKEN_CONTRACT_ID is unset', async () => {
    const saved = process.env.LOYALTY_TOKEN_CONTRACT_ID;
    delete process.env.LOYALTY_TOKEN_CONTRACT_ID;

    const id = await enqueueLoyaltyMint(JOB_ID, USER_ID, WALLET, '10', 'XLM');

    expect(id).toBeNull();
    expect(db.query).not.toHaveBeenCalled();

    process.env.LOYALTY_TOKEN_CONTRACT_ID = saved;
  });
});

// ===========================================================================
// 3. STATUS TRANSITIONS & retry_count
// ===========================================================================

describe('processLoyaltyMintQueue — status transitions', () => {
  /** Wire up pool + auto-commit db.query for a single-iteration run */
  function setupPool(jobRow) {
    const client = makeMockClient((sql) =>
      sql.includes('SELECT') && sql.includes('loyalty_mint_queue')
        ? { rows: jobRow ? [jobRow] : [] }
        : { rows: [] },
    );
    db.pool.connect.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [] });
    return client;
  }

  test('pending → processing → completed when mintPoints succeeds', async () => {
    mintPoints.mockResolvedValue({ txHash: TX_HASH });
    const client = setupPool(PENDING_JOB);

    await processLoyaltyMintQueue();

    // Inside transaction: UPDATE status='processing'
    const processingCall = client.query.mock.calls.find(([s]) =>
      s.toLowerCase().includes('processing'),
    );
    expect(processingCall).toBeDefined();

    // Outside transaction (db.query): UPDATE status='completed'
    const completedCall = db.query.mock.calls.find(([s]) =>
      s.toLowerCase().includes('completed') && !s.toLowerCase().includes('insert'),
    );
    expect(completedCall).toBeDefined();
    expect(completedCall[1][1]).toBe(JOB_ID);
  });

  test('claimNextJob increments retry_count inside the transaction', async () => {
    mintPoints.mockResolvedValue({ txHash: TX_HASH });
    const client = setupPool(PENDING_JOB);

    await processLoyaltyMintQueue();

    const retryIncrement = client.query.mock.calls.find(([s]) =>
      s.includes('retry_count') && s.toLowerCase().includes('processing'),
    );
    expect(retryIncrement).toBeDefined();
    expect(retryIncrement[0]).toMatch(/retry_count\s*=\s*retry_count\s*\+\s*1/i);
  });

  test('pending → processing → pending (retry) when mintPoints throws and retry_count < 3', async () => {
    mintPoints.mockRejectedValue(new Error('soroban rpc timeout'));
    setupPool({ ...PENDING_JOB, retry_count: 0 });

    await processLoyaltyMintQueue();

    const retryUpdate = db.query.mock.calls.find(([s]) =>
      s.toLowerCase().includes("status = 'pending'") ||
      s.toLowerCase().includes("status='pending'"),
    );
    expect(retryUpdate).toBeDefined();
    expect(retryUpdate[1][0]).toMatch(/soroban rpc timeout/);
    expect(retryUpdate[1][1]).toBe(JOB_ID);
  });

  test('pending → processing → failed when mintPoints throws and retry_count >= 3', async () => {
    mintPoints.mockRejectedValue(new Error('permanent failure'));
    setupPool({ ...PENDING_JOB, retry_count: 3 });

    await processLoyaltyMintQueue();

    const failedUpdate = db.query.mock.calls.find(([s]) =>
      s.toLowerCase().includes('failed'),
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate[1][0]).toMatch(/permanent failure/);
    expect(failedUpdate[1][1]).toBe(JOB_ID);
  });

  test('pending → processing → completed (no-op) when mintPoints returns null', async () => {
    mintPoints.mockResolvedValue(null);
    setupPool(PENDING_JOB);

    await processLoyaltyMintQueue();

    // The no-op completion UPDATE has no tx_hash param
    const completedNoTxHash = db.query.mock.calls.find(([s, p]) =>
      s.toLowerCase().includes('completed') &&
      !s.toLowerCase().includes('insert') &&
      p && p.length === 1 && p[0] === JOB_ID,
    );
    expect(completedNoTxHash).toBeDefined();
  });

  test('inserts loyalty_points ledger row after a successful mint', async () => {
    mintPoints.mockResolvedValue({ txHash: TX_HASH });
    setupPool(PENDING_JOB);

    await processLoyaltyMintQueue();

    const ledgerInsert = db.query.mock.calls.find(([s]) =>
      s.includes('INSERT INTO loyalty_points') && s.includes("'mint'"),
    );
    expect(ledgerInsert).toBeDefined();
    const p = ledgerInsert[1];
    expect(p[1]).toBe(USER_ID);
    expect(p[2]).toBe(WALLET);
    expect(p[3]).toBe(10);  // points for 10 XLM
    expect(p[4]).toBe(JOB_ID);
    expect(p[5]).toBe(TX_HASH);
  });

  test('does nothing when queue is empty', async () => {
    setupPool(null);

    await processLoyaltyMintQueue();

    expect(mintPoints).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled(); // no auto-commit calls needed
  });

  test('always releases the pg client regardless of mintPoints outcome', async () => {
    mintPoints.mockRejectedValue(new Error('crash'));
    const client = setupPool({ ...PENDING_JOB, retry_count: 5 }); // → 'failed'

    await processLoyaltyMintQueue();

    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back the transaction and releases client when claimNextJob throws', async () => {
    const client = makeMockClient((sql) => {
      if (sql.toLowerCase().includes('select')) throw new Error('db connection lost');
      return { rows: [] };
    });
    db.pool.connect.mockResolvedValue(client);
    db.query.mockResolvedValue({ rows: [] });

    await expect(processLoyaltyMintQueue()).resolves.not.toThrow();

    const rollbackCall = client.query.mock.calls.find(([s]) =>
      s.replace(/\s+/g, ' ').trim().toUpperCase() === 'ROLLBACK',
    );
    expect(rollbackCall).toBeDefined();
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 4. claimNextJob — unit tests
// ===========================================================================

describe('claimNextJob', () => {
  test('returns null when SELECT returns no rows', async () => {
    const client = makeMockClient(() => ({ rows: [] }));
    const result = await claimNextJob(client);
    expect(result).toBeNull();
  });

  test('returns the job row when SELECT returns a row', async () => {
    const client = makeMockClient((sql) =>
      sql.toLowerCase().includes('select') ? { rows: [PENDING_JOB] } : { rows: [] },
    );
    const result = await claimNextJob(client);
    expect(result).toMatchObject({ id: JOB_ID });
  });

  test('wraps SELECT and UPDATE inside BEGIN … COMMIT', async () => {
    const client = makeMockClient((sql) =>
      sql.toLowerCase().includes('select') ? { rows: [PENDING_JOB] } : { rows: [] },
    );
    await claimNextJob(client);

    const stmts = client.query.mock.calls.map(([s]) =>
      s.replace(/\s+/g, ' ').trim().toUpperCase(),
    );
    expect(stmts[0]).toBe('BEGIN');
    expect(stmts[stmts.length - 1]).toBe('COMMIT');
  });

  test('issues ROLLBACK (not COMMIT) when SELECT throws', async () => {
    const client = makeMockClient((sql) => {
      if (sql.toLowerCase().includes('select')) throw new Error('db error');
      return { rows: [] };
    });

    await expect(claimNextJob(client)).rejects.toThrow('db error');

    const stmts = client.query.mock.calls.map(([s]) =>
      s.replace(/\s+/g, ' ').trim().toUpperCase(),
    );
    expect(stmts).toContain('ROLLBACK');
    expect(stmts).not.toContain('COMMIT');
  });

  test('SELECT query includes FOR UPDATE … SKIP LOCKED', async () => {
    const client = makeMockClient(() => ({ rows: [] }));
    await claimNextJob(client);

    const selectSql = client.query.mock.calls.find(([s]) =>
      s.toLowerCase().includes('select'),
    )?.[0];
    expect(selectSql).toMatch(/FOR UPDATE/i);
    expect(selectSql).toMatch(/SKIP LOCKED/i);
    // mintPoints must have been called exactly once regardless of race order.
    expect(mintPoints).toHaveBeenCalledTimes(1);
    expect(mintPoints).toHaveBeenCalledWith({
      recipientWallet: PENDING_JOB.sender_wallet,
      points:          100, // 100 XLM → 100 points
    });
  });

  test('each caller releases its client even when no row is found', async () => {
    const client1 = buildMockClient(null);
    const client2 = buildMockClient(null);
    db.pool.connect
      .mockResolvedValueOnce(client1)
      .mockResolvedValueOnce(client2);

    await Promise.all([
      processLoyaltyMintQueue(),
      processLoyaltyMintQueue(),
    ]);

    expect(client1.release).toHaveBeenCalledTimes(1);
    expect(client2.release).toHaveBeenCalledTimes(1);
    expect(mintPoints).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// DISTRIBUTED LOCK (defense-in-depth)
// ===========================================================================
describe('distributed lock — slot is skipped when lock is already held', () => {
  test('withLock returning false prevents mintPoints from running', async () => {
    // Simulate Redis reporting the slot is held by another replica.
    withLock.mockResolvedValue(false);

    await processLoyaltyMintQueue();

    expect(mintPoints).not.toHaveBeenCalled();
    // Pool client should never have been checked out.
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  test('withLock is invoked with the per-slot key', async () => {
    process.env.LOYALTY_MINT_CONCURRENCY = '3';

    await processLoyaltyMintQueue();

    // One lock call per concurrency slot.
    expect(withLock).toHaveBeenCalledTimes(3);
    expect(withLock.mock.calls[0][0]).toBe('loyalty_mint:slot:0');
    expect(withLock.mock.calls[1][0]).toBe('loyalty_mint:slot:1');
    expect(withLock.mock.calls[2][0]).toBe('loyalty_mint:slot:2');
  });
});

// ===========================================================================
// CLAIM TRANSACTION INTEGRITY
// ===========================================================================
describe('claimNextJob — transaction integrity', () => {
  test('SELECT uses FOR UPDATE OF lq SKIP LOCKED', async () => {
    await processLoyaltyMintQueue();

    const client = await db.pool.connect.mock.results[0].value;
    const selectCall = client.query.mock.calls.find(
      ([sql]) => /FOR UPDATE/i.test(sql),
    );
    expect(selectCall).toBeDefined();
    expect(selectCall[0]).toMatch(/SKIP LOCKED/i);
    expect(selectCall[0]).toMatch(/FOR UPDATE OF lq/i);
  });

  test('UPDATE status=processing happens inside the same transaction before COMMIT', async () => {
    await processLoyaltyMintQueue();

    const client = await db.pool.connect.mock.results[0].value;
    const calls   = client.query.mock.calls.map(([sql]) => sql.trim().toUpperCase());

    const beginIdx    = calls.findIndex((s) => s === 'BEGIN');
    const processingIdx = calls.findIndex((s) => /STATUS\s*=\s*'PROCESSING'/.test(s));
    const commitIdx   = calls.findIndex((s) => s === 'COMMIT');

    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(processingIdx).toBeGreaterThan(beginIdx);
    expect(commitIdx).toBeGreaterThan(processingIdx);
  });

  test('ROLLBACK is issued when SELECT throws', async () => {
    const failClient = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })               // BEGIN ok
        .mockRejectedValueOnce(new Error('pg SELECT boom')),// SELECT fails
      release: jest.fn(),
    };
    db.pool.connect.mockResolvedValue(failClient);

    // Should not throw — error is caught and logged.
    await expect(processLoyaltyMintQueue()).resolves.toBeUndefined();

    const calls = failClient.query.mock.calls.map(([sql]) => sql.trim().toUpperCase());
    expect(calls).toContain('ROLLBACK');
    expect(failClient.release).toHaveBeenCalledTimes(1);
  });

  test('pool client is always released via finally block', async () => {
    mintPoints.mockRejectedValue(new Error('Soroban failure'));

    await processLoyaltyMintQueue();

    const client = await db.pool.connect.mock.results[0].value;
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// STATUS TRANSITIONS
// ===========================================================================
describe('status transitions — successful mint', () => {
  test("sets status='completed' and records tx_hash after a successful mint", async () => {
    await processLoyaltyMintQueue();

    const completedCall = db.query.mock.calls.find(
      ([sql]) => /status\s*=\s*'completed'/i.test(sql) && /tx_hash/i.test(sql),
    );
    expect(completedCall).toBeDefined();
    expect(completedCall[1][0]).toBe(FAKE_TX_HASH);
    expect(completedCall[1][1]).toBe(PENDING_JOB.id);
  });

  test('inserts a mint row into loyalty_points', async () => {
    await processLoyaltyMintQueue();

    const insertCall = db.query.mock.calls.find(
      ([sql]) => /INSERT INTO loyalty_points/i.test(sql),
    );
    expect(insertCall).toBeDefined();
    // INSERT INTO loyalty_points
    //   (id,  user_id, wallet_address, event_type, points, transaction_id, tx_hash)
    // VALUES ($1, $2,  $3,             'mint',     $4,     $5,             $6)
    //
    // 'mint' is a SQL literal — not a JS parameter — so the params array is:
    //   params[0] = uuid   ($1 id)
    //   params[1] = user_id ($2)
    //   params[2] = wallet_address ($3)
    //   params[3] = points ($4)
    //   params[4] = job.id ($5 transaction_id)
    //   params[5] = tx_hash ($6)
    const params = insertCall[1];
    expect(typeof params[0]).toBe('string');            // $1 — generated uuid
    expect(params[1]).toBe(PENDING_JOB.user_id);       // $2 — user_id
    expect(params[2]).toBe(PENDING_JOB.sender_wallet); // $3 — wallet_address
    // event_type 'mint' is a SQL literal in the query, not in params
    expect(insertCall[0]).toMatch(/'mint'/);
    expect(params[3]).toBeGreaterThanOrEqual(1);        // $4 — points
    expect(params[4]).toBe(PENDING_JOB.id);            // $5 — transaction_id
    expect(params[5]).toBe(FAKE_TX_HASH);              // $6 — tx_hash
  });

  test("sets status='completed' (no tx_hash) when mintPoints returns null", async () => {
    mintPoints.mockResolvedValue(null);

    await processLoyaltyMintQueue();

    const completedCall = db.query.mock.calls.find(
      ([sql]) => /status\s*=\s*'completed'/i.test(sql) && /completed_at/i.test(sql),
    );
    expect(completedCall).toBeDefined();
    // No loyalty_points INSERT should happen.
    const insertCall = db.query.mock.calls.find(
      ([sql]) => /INSERT INTO loyalty_points/i.test(sql),
    );
    expect(insertCall).toBeUndefined();
  });
});

// ===========================================================================
// RETRY_COUNT TRANSITIONS
// ===========================================================================
describe('retry_count transitions', () => {
  test("sets status='pending' and increments retry_count on first failure (retry_count=0)", async () => {
    mintPoints.mockRejectedValue(new Error('transient Soroban error'));
    // retry_count=0 means retriesUsed=1 after claimNextJob's increment → still < 3 → retry

    await processLoyaltyMintQueue();

    const retryCall = db.query.mock.calls.find(
      ([sql]) => /status\s*=\s*'pending'/i.test(sql) && /retry_count/i.test(sql),
    );
    expect(retryCall).toBeDefined();
    expect(retryCall[1][0]).toMatch(/transient Soroban error/);
    expect(retryCall[1][1]).toBe(PENDING_JOB.id);
  });

  test("sets status='pending' on second failure (retry_count=1 → retriesUsed=2)", async () => {
    const jobWithOneRetry = { ...PENDING_JOB, retry_count: 1 };
    db.pool.connect.mockResolvedValue(buildMockClient(jobWithOneRetry));
    mintPoints.mockRejectedValue(new Error('second failure'));

    await processLoyaltyMintQueue();

    const retryCall = db.query.mock.calls.find(
      ([sql]) => /status\s*=\s*'pending'/i.test(sql) && /retry_count/i.test(sql),
    );
    expect(retryCall).toBeDefined();
  });

  test("sets status='failed' after exhausting retries (retry_count=2 → retriesUsed=3)", async () => {
    // retry_count=2 → after claimNextJob's UPDATE it becomes 3 in the DB,
    // but job.retry_count is the value *before* that increment (=2).
    // retriesUsed = (2) + 1 = 3, which is NOT < 3 → fail.
    const jobAtMaxRetries = { ...PENDING_JOB, retry_count: 2 };
    db.pool.connect.mockResolvedValue(buildMockClient(jobAtMaxRetries));
    mintPoints.mockRejectedValue(new Error('final failure'));

    await processLoyaltyMintQueue();

    const failedCall = db.query.mock.calls.find(
      ([sql]) => /status\s*=\s*'failed'/i.test(sql),
    );
    expect(failedCall).toBeDefined();
    expect(failedCall[1][0]).toMatch(/final failure/);
    expect(failedCall[1][1]).toBe(PENDING_JOB.id);

    // Must NOT have set status='pending'.
    const pendingCall = db.query.mock.calls.find(
      ([sql]) => /status\s*=\s*'pending'/i.test(sql) && /retry_count/i.test(sql),
    );
    expect(pendingCall).toBeUndefined();
  });

  test('claimNextJob increments retry_count inside the transaction', async () => {
    await processLoyaltyMintQueue();

    const client = await db.pool.connect.mock.results[0].value;
    const processingCall = client.query.mock.calls.find(
      ([sql]) => /retry_count\s*=\s*retry_count\s*\+\s*1/i.test(sql),
    );
    expect(processingCall).toBeDefined();
  });
});

// ===========================================================================
// ENQUEUE PATH — ON CONFLICT DO NOTHING
// ===========================================================================
describe('enqueueLoyaltyMint — ON CONFLICT DO NOTHING', () => {
  test('returns the new id when the row is freshly inserted', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'new-job-id' }] });

    const id = await enqueueLoyaltyMint(
      'new-job-id', 'user-1', 'GWALLET', '50', 'XLM',
    );
    expect(id).toBe('new-job-id');
  });

  test('returns null when ON CONFLICT suppresses the insert (duplicate txId)', async () => {
    // ON CONFLICT DO NOTHING → RETURNING returns no rows
    db.query.mockResolvedValueOnce({ rows: [] });

    const id = await enqueueLoyaltyMint(
      'existing-job-id', 'user-1', 'GWALLET', '50', 'XLM',
    );
    expect(id).toBeNull();
  });

  test('does not create duplicate rows when called twice with the same txId', async () => {
    // First call inserts successfully.
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'dup-job-id' }] })
      // Second call is suppressed by ON CONFLICT.
      .mockResolvedValueOnce({ rows: [] });

    const first  = await enqueueLoyaltyMint('dup-job-id', 'u', 'GW', '10', 'XLM');
    const second = await enqueueLoyaltyMint('dup-job-id', 'u', 'GW', '10', 'XLM');

    expect(first).toBe('dup-job-id');
    expect(second).toBeNull();

    // Both calls should have used ON CONFLICT DO NOTHING.
    db.query.mock.calls.forEach(([sql]) => {
      if (sql.includes('INSERT INTO loyalty_mint_queue')) {
        expect(sql).toMatch(/ON CONFLICT DO NOTHING/i);
      }
    });
  });

  test('returns null (skips enqueue) when LOYALTY_TOKEN_CONTRACT_ID is not set', async () => {
    delete process.env.LOYALTY_TOKEN_CONTRACT_ID;

    const id = await enqueueLoyaltyMint(
      'job-id', 'user-1', 'GWALLET', '50', 'XLM',
    );

    expect(id).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  test('INSERT uses all five expected parameters', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'j1' }] });

    await enqueueLoyaltyMint('tx-id', 'uid', 'GWALLET', '25.5', 'USDC');

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO loyalty_mint_queue/i);
    expect(params).toEqual(['tx-id', 'uid', 'GWALLET', '25.5', 'USDC']);
  });
});

// ===========================================================================
// CONCURRENCY SLOT CONCURRENCY COUNT
// ===========================================================================
describe('CONCURRENCY env variable controls number of slots processed', () => {
  test('processes only one slot when CONCURRENCY=1 (default in tests)', async () => {
    await processLoyaltyMintQueue();

    expect(db.pool.connect).toHaveBeenCalledTimes(1);
  });

  test('processes N slots when CONCURRENCY=N', async () => {
    process.env.LOYALTY_MINT_CONCURRENCY = '3';
    // Each slot gets its own client; all return no pending rows.
    db.pool.connect.mockResolvedValue(buildMockClient(null));

    await processLoyaltyMintQueue();

    expect(db.pool.connect).toHaveBeenCalledTimes(3);
  });
});
