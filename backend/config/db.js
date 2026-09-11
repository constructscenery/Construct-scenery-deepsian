require('dotenv').config();
const { Pool, types } = require('pg');
types.setTypeParser(1082, (val) => val);


// Parse the DATABASE_URL manually so that pg-connection-string never sees
// the sslmode=verify-full query param (which makes pg try to load a local CA
// cert file that doesn't exist, hanging the SSL handshake indefinitely).
const raw = (process.env.DATABASE_URL || 'postgres://localhost/postgres').replace(/^["']|["']$/g, '');
const u   = new URL(raw);

const pool = new Pool({
  host:     u.hostname,
  port:     parseInt(u.port, 10) || 5432,
  user:     u.username,
  password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ''),
  ssl:      { rejectUnauthorized: false },
  max:                     10,
  idleTimeoutMillis:       30000,
  connectionTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

// Startup connectivity check — retries 3 times with 3 s gaps before giving up.
if (process.env.NODE_ENV !== 'test') {
  (async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await pool.query('SELECT 1');
        console.log('✅ PostgreSQL connected (Render)');
        return;
      } catch (err) {
        if (attempt < 3) {
          console.warn(`⚠️  PostgreSQL attempt ${attempt}/3 failed (${err.message}) — retrying in 3 s…`);
          await new Promise(r => setTimeout(r, 3000));
        } else {
          console.error('❌ PostgreSQL connection failed:', err.message);
        }
      }
    }
  })();
}

module.exports = pool;
