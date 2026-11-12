const xero = require('../services/xeroService');
const { logAudit } = require('../services/auditService');

// Addendum 6 — Xero connection and sync endpoints.

/** Where the browser goes after Xero's consent screen: the Sales page, where the Xero card lives. */
const returnUrl = params => {
  let base = process.env.FRONTEND_URL || '';
  if (!base && process.env.XERO_REDIRECT_URI) {
    try { base = new URL(process.env.XERO_REDIRECT_URI).origin; } catch { base = ''; }
  }
  return `${base.replace(/\/+$/, '')}/sales?${new URLSearchParams(params)}`;
};

// GET /api/xero/status
const getStatus = async (req, res) => {
  try {
    res.json(await xero.getStatus());
  } catch (err) {
    console.error('xero getStatus error:', err);
    res.status(500).json({ error: 'Unable to load Xero status' });
  }
};

// GET /api/xero/connect  (Administrator) → { url } for Xero's consent screen
const getConnectUrl = async (req, res) => {
  try {
    res.json({ url: xero.buildAuthorizeUrl(req.user.id) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Unable to start Xero connection' });
  }
};

// GET /api/public/xero/callback  — Xero redirects the browser here (no app token; the signed state identifies the user)
const handleCallback = async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.redirect(returnUrl({ xero: error === 'access_denied' ? 'cancelled' : 'error', message: String(error) }));
  }
  try {
    const { connection, userId } = await xero.completeConnection({ code, state });
    await logAudit({
      userId,
      category: 'financial',
      action: 'xero_connected',
      entityType: 'xero_connection',
      entityId: connection.tenant_id,
      details: `Connected Xero organisation ${connection.tenant_name || connection.tenant_id}`,
    });
    // First full sync runs in the background; the Sales page shows its result.
    xero.syncInvoices({ trigger: 'connect' }).catch(err => console.error('[Xero] Initial sync failed:', err.message));
    res.redirect(returnUrl({ xero: 'connected' }));
  } catch (err) {
    console.error('xero callback error:', err.message);
    res.redirect(returnUrl({ xero: 'error', message: err.message || 'Xero connection failed' }));
  }
};

// POST /api/xero/sync   body: { mode: 'manual' | 'auto' }
// 'auto' (sent when Sales opens) quietly does nothing if Xero isn't connected or synced a few minutes ago.
const sync = async (req, res) => {
  const mode = req.body?.mode === 'auto' ? 'auto' : 'manual';
  try {
    if (mode === 'auto') {
      const status = await xero.getStatus();
      if (!status.configured || status.status !== 'connected') {
        return res.json({ ran: false, reason: 'not_connected', status });
      }
    }
    res.json(await xero.syncInvoices({ trigger: mode }));
  } catch (err) {
    const status = await xero.getStatus().catch(() => null);
    if (!(err instanceof xero.XeroError)) console.error('xero sync error:', err);
    res.status(err instanceof xero.XeroError ? err.status : 500).json({ error: err.message || 'Xero sync failed', status });
  }
};

// DELETE /api/xero/connection  (Administrator)
const disconnect = async (req, res) => {
  try {
    const before = await xero.getStatus();
    await xero.disconnect();
    if (before.status !== 'not_connected' && before.status !== 'disconnected') {
      await logAudit({
        userId: req.user.id,
        userName: req.user.full_name,
        userRole: req.user.role,
        category: 'financial',
        action: 'xero_disconnected',
        entityType: 'xero_connection',
        details: `Disconnected Xero organisation ${before.tenant_name || ''}`.trim(),
      });
    }
    res.json(await xero.getStatus());
  } catch (err) {
    console.error('xero disconnect error:', err);
    res.status(500).json({ error: 'Unable to disconnect Xero' });
  }
};

module.exports = { getStatus, getConnectUrl, handleCallback, sync, disconnect };
