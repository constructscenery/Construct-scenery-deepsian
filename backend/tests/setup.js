/**
 * Global test setup — mocks for db, crypto, email, and auth middleware.
 *
 * Every test file can import helpers from here:
 *   const { mockQuery, makeApp, authHeader } = require('./setup');
 *
 * Strategy:
 *  - jest.mock('../config/db') replaces pool with a jest.fn() version
 *  - jest.mock('../Middleware/auth') bypasses JWT verification
 *  - Each test configures mockQuery responses before calling supertest
 */

const express  = require('express');
const { checkPolicy } = require('../Middleware/roleCheck');

// ─── DB mock factory ──────────────────────────────────────────────────────────
// Returns a mock `db` object whose .query() can be configured per-test.
function createDbMock() {
  const mock = {
    _responses: [],
    queries: [],
    query: jest.fn(async (sql, params) => {
      mock.queries.push({ sql, params });
      if (mock._responses.length) return mock._responses.shift();
      return { rows: [], rowCount: 0 };
    }),
    connect: jest.fn(() => {
      const client = {
        query: jest.fn(async (sql, params) => {
          mock.queries.push({ sql, params });
          if (mock._responses.length) return mock._responses.shift();
          return { rows: [], rowCount: 0 };
        }),
        release: jest.fn(),
      };
      return Promise.resolve(client);
    }),
    // Helper: queue responses for successive query() calls
    respond: (...responses) => {
      mock._responses.push(...responses.map(r =>
        Array.isArray(r) ? { rows: r, rowCount: r.length }
        : r && r.rows   ? r
        : { rows: [r].filter(Boolean), rowCount: r ? 1 : 0 }
      ));
      return mock;
    },
    reset: () => {
      mock._responses = [];
      mock.queries = [];
      mock.query.mockClear();
      mock.connect.mockClear();
    },
  };
  return mock;
}

const dbMock = createDbMock();

// Expose globally so individual test files can queue responses
global.dbMock = dbMock;

// ─── Auth tokens & headers ────────────────────────────────────────────────────
const USERS = {
  md:          { id: 'user-md-001',   email: 'warren@cs.com',     full_name: 'Warren MD',     role: 'managing_director'       },
  accountant:  { id: 'user-acc-001',  email: 'acc@cs.com',        full_name: 'Acc User',      role: 'construction_accountant'  },
  coordinator: { id: 'user-coord-001',email: 'coord@cs.com',      full_name: 'Coord User',    role: 'construction_coordinator' },
  guest:       { id: 'user-guest-001',email: 'guest@cs.com',      full_name: 'Guest User',    role: 'guest'                    },
};

// Fake tokens — auth middleware is mocked so the value doesn't matter
const TOKENS = {
  md:          'Bearer fake-md-token',
  accountant:  'Bearer fake-acc-token',
  coordinator: 'Bearer fake-coord-token',
  guest:       'Bearer fake-guest-token',
};

function authHeader(role = 'md') {
  return { Authorization: TOKENS[role] };
}

// ─── Mock auth middleware ──────────────────────────────────────────────────────
// Reads the fake token and populates req.user without hitting JWT/DB
jest.mock('../Middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    const token = req.headers.authorization ?? '';
    if (token.includes('fake-md-token'))         req.user = USERS.md;
    else if (token.includes('fake-acc-token'))   req.user = USERS.accountant;
    else if (token.includes('fake-coord-token')) req.user = USERS.coordinator;
    else if (token.includes('fake-guest-token')) req.user = USERS.guest;
    else if (token.includes('fake.jwt.token'))   req.user = USERS.md;
    else req.user = null;
    next();
  },
}));

// ─── Mock DB ──────────────────────────────────────────────────────────────────
jest.mock('../config/db', () => global.dbMock);

// ─── Mock crypto (encrypt/decrypt = passthrough in tests) ─────────────────────
jest.mock('../config/crypto', () => ({
  encrypt: (v) => v ? `enc(${v})` : null,
  decrypt: (v) => v ? v.replace(/^enc\(/, '').replace(/\)$/, '') : null,
}));

// ─── Mock email (no real emails sent in tests) ────────────────────────────────
jest.mock('../config/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
  templates: {
    invoiceChase:         () => ({ subject: 'Test', html: '<p>test</p>' }),
    handoverAlert:        () => ({ subject: 'Test', html: '<p>test</p>' }),
    timesheetDistributed: () => ({ subject: 'Test', html: '<p>test</p>' }),
  },
  logEmail: jest.fn().mockResolvedValue(true),
}));

// ─── Mock labour cost service (used in pay run processing) ───────────────────
jest.mock('../services/labourCostService', () => ({
  recordWeeklyLabour: jest.fn().mockResolvedValue(undefined),
}));

// ─── Mock csv-parse (used in import controllers) ──────────────────────────────
// Tests that need CSV parsing will override this
jest.mock('csv-parse/sync', () => ({
  parse: jest.fn((str, opts) => {
    // Very basic CSV parser for tests
    const lines = str.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim());
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
    });
  }),
}));

// ─── App factory ──────────────────────────────────────────────────────────────
// Creates a full Express app with auth + policy middleware for integration tests
function makeApp(...routers) {
  const app = express();
  app.use(express.json());
  const { authenticate } = require('../Middleware/auth');
  app.use(authenticate);
  app.use(checkPolicy);
  routers.forEach(([path, router]) => app.use(path, router));
  return app;
}

module.exports = { dbMock, authHeader, makeApp, USERS, TOKENS };
