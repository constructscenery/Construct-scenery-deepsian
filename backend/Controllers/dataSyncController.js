/**
 * DataSyncController — Handles on-demand DB export & S3 sync,
 * sync history viewing, status check, and direct download.
 */

const {
  executeDataSync,
  getSyncHistory,
  getSyncStatus,
  streamSyncFile,
} = require('../services/dataSyncService');

/**
 * POST /api/data-sync/trigger
 * Manually trigger a full database sync to S3
 */
async function triggerSync(req, res) {
  try {
    const user = req.user || {};
    const result = await executeDataSync({
      triggeredByType: 'MANUAL',
      userId: user.id || null,
      userName: user.full_name || user.email || 'User',
    });

    return res.status(200).json({
      message: 'Database sync to S3 completed successfully',
      sync: result,
    });
  } catch (err) {
    console.error('[DATA-SYNC] Trigger sync error:', err);
    return res.status(500).json({
      error: 'Failed to sync database to S3',
      details: err.message,
    });
  }
}

/**
 * GET /api/data-sync/history
 * Get list of previous sync operations
 */
async function getHistory(req, res) {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const history = await getSyncHistory({ limit });
    return res.json({ history });
  } catch (err) {
    console.error('[DATA-SYNC] Get history error:', err);
    return res.status(500).json({ error: 'Failed to retrieve sync history' });
  }
}

/**
 * GET /api/data-sync/status
 * Get sync service status, latest sync, and schedule info
 */
async function getStatus(req, res) {
  try {
    const status = await getSyncStatus();
    return res.json(status);
  } catch (err) {
    console.error('[DATA-SYNC] Get status error:', err);
    return res.status(500).json({ error: 'Failed to retrieve sync status' });
  }
}

/**
 * GET /api/data-sync/download/:id
 * Stream the versioned Excel file from S3 for download
 */
async function downloadSync(req, res) {
  try {
    const { id } = req.params;
    const requestedFile = req.query.file || null;
    await streamSyncFile(id, res, requestedFile);
  } catch (err) {
    console.error('[DATA-SYNC] Download sync error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Failed to download sync file' });
  }
}

module.exports = {
  triggerSync,
  getHistory,
  getStatus,
  downloadSync,
};
