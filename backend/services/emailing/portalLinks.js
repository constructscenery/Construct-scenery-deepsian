/**
 * Secure crew portal links.
 *
 * One active link per crew member, reused across every email (timesheet reminders,
 * invoice requests, availability polls). Lookups use a SHA-256 hash of the token;
 * the token itself is kept AES-256-GCM encrypted (config/crypto) so it can be put
 * into later emails. Reusing a link slides its expiry forward; staff can rotate or
 * revoke it at any time.
 */
const crypto = require('crypto');
const db = require('../../config/db');
const { encrypt, decrypt } = require('../../config/crypto');
const { getSettings } = require('./settings');

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const generateToken = () => crypto.randomBytes(32).toString('base64url');
const looksLikeToken = (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(token);

async function ttlDays() {
  const settings = await getSettings();
  return settings.portal_link_ttl_days || 60;
}

async function insertLink(runner, crewMemberId, userId, days) {
  const token = generateToken();
  const { rows: [link] } = await runner.query(
    `INSERT INTO crew_portal_links (crew_member_id, token_hash, token_encrypted, created_by, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' days')::interval)
     RETURNING id, crew_member_id, expires_at, created_at`,
    [crewMemberId, hashToken(token), encrypt(token), userId || null, String(days)]
  );
  return { ...link, token };
}

/**
 * Returns the crew member's active link (creating one if needed) with its raw token.
 * Extends the expiry so a link sent today is valid for at least the configured TTL.
 */
async function getOrCreateActiveLink(crewMemberId, { userId = null } = {}) {
  const days = await ttlDays();
  for (let attempt = 0; attempt < 2; attempt++) {
    const { rows: [active] } = await db.query(
      `SELECT id, crew_member_id, token_encrypted, expires_at, created_at
       FROM crew_portal_links
       WHERE crew_member_id = $1 AND revoked_at IS NULL`,
      [crewMemberId]
    );

    if (active && new Date(active.expires_at) > new Date()) {
      const token = decrypt(active.token_encrypted);
      const { rows: [updated] } = await db.query(
        `UPDATE crew_portal_links
         SET expires_at = GREATEST(expires_at, NOW() + ($2 || ' days')::interval)
         WHERE id = $1
         RETURNING expires_at`,
        [active.id, String(days)]
      );
      return { id: active.id, crew_member_id: crewMemberId, token, expires_at: updated?.expires_at || active.expires_at, created_at: active.created_at };
    }

    if (active) {
      await db.query(`UPDATE crew_portal_links SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`, [active.id]);
    }

    try {
      return await insertLink(db, crewMemberId, userId, days);
    } catch (err) {
      // 23505 = another request created the active link at the same moment — read it back.
      if (err.code !== '23505' || attempt === 1) throw err;
    }
  }
  throw new Error('Could not create portal link');
}

async function rotateLink(crewMemberId, userId) {
  await db.query(
    `UPDATE crew_portal_links SET revoked_at = NOW(), revoked_by = $2
     WHERE crew_member_id = $1 AND revoked_at IS NULL`,
    [crewMemberId, userId || null]
  );
  return insertLink(db, crewMemberId, userId, await ttlDays());
}

async function revokeLink(crewMemberId, userId) {
  const { rowCount } = await db.query(
    `UPDATE crew_portal_links SET revoked_at = NOW(), revoked_by = $2
     WHERE crew_member_id = $1 AND revoked_at IS NULL`,
    [crewMemberId, userId || null]
  );
  return rowCount > 0;
}

async function getLinkStatus(crewMemberId) {
  const { rows: [link] } = await db.query(
    `SELECT id, created_at, expires_at, last_used_at
     FROM crew_portal_links
     WHERE crew_member_id = $1 AND revoked_at IS NULL`,
    [crewMemberId]
  );
  if (!link) return { active: false };
  return { active: new Date(link.expires_at) > new Date(), ...link };
}

/**
 * Resolves a raw token to its crew member.
 * @returns {{ ok: true, link, crew } | { ok: false, status: number, error: string }}
 */
async function resolveToken(token) {
  if (!looksLikeToken(token)) return { ok: false, status: 404, error: 'This link is not valid.' };

  const { rows: [row] } = await db.query(
    `SELECT pl.id AS link_id, pl.expires_at, pl.revoked_at, pl.last_used_at,
            cm.id, cm.first_name, cm.last_name, cm.crew_number, cm.email,
            cm.employment_status, cm.is_active, cm.deleted_at, cm.is_archived
     FROM crew_portal_links pl
     JOIN crew_members cm ON cm.id = pl.crew_member_id
     WHERE pl.token_hash = $1`,
    [hashToken(token)]
  );

  if (!row) return { ok: false, status: 404, error: 'This link is not valid.' };
  if (row.revoked_at) return { ok: false, status: 410, error: 'This link has been replaced. Please use the most recent email from Construct Scenery.' };
  if (new Date(row.expires_at) <= new Date()) return { ok: false, status: 410, error: 'This link has expired. Please contact the Construct Scenery office for a new one.' };
  if (row.deleted_at || row.is_archived || row.is_active === false) {
    return { ok: false, status: 403, error: 'Your crew record is not currently active. Please contact the Construct Scenery office.' };
  }

  // Touch last_used_at at most once a minute.
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 60_000) {
    db.query('UPDATE crew_portal_links SET last_used_at = NOW() WHERE id = $1', [row.link_id]).catch(() => {});
  }

  const { link_id, expires_at, revoked_at, last_used_at, ...crew } = row;
  return { ok: true, link: { id: link_id, expires_at }, crew };
}

module.exports = {
  hashToken, generateToken, looksLikeToken,
  getOrCreateActiveLink, rotateLink, revokeLink, getLinkStatus, resolveToken,
};
