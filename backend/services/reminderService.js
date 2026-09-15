const db = require('../config/db');
const { sendEmail, templates } = require('../config/email');

// Helper to safely format dates
const toDateStr = (d) => {
  if (!d) return null;
  try {
    const p = new Date(d);
    return isNaN(p.getTime()) ? null : p.toISOString().split('T')[0];
  } catch { return null; }
};

const getDaysRemaining = (targetDateStr) => {
  if (!targetDateStr) return null;
  const target = new Date(targetDateStr);
  const now = new Date();
  target.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - now.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
};

const runAssetReminders = async () => {
  console.log(`[REMINDERS] Scanning for asset & building reminders...`);

  // Default reminder days to 30
  const reminderDays = 30;

  // Fetch recipients (Warren and Construction Coordinator)
  const { rows: recipients } = await db.query(
    `SELECT email FROM users WHERE role IN ('managing_director', 'construction_coordinator') AND is_active = true`
  );
  
  const recipientEmails = recipients.map(r => r.email).filter(Boolean);
  if (!recipientEmails.length) {
    console.warn('[REMINDERS] No active staff found to receive alerts.');
    return;
  }

  let sentCount = 0;

  // Helper function to process reminders
  const processReminder = async (resourceType, resource, dateField, reminderType, emailTemplateFunc, ...templateArgs) => {
    if (resource.reminder_enabled === false || resource.billing_cycle === 'free') return;
    const targetDate = resource[dateField];
    if (!targetDate) return;
    
    const daysRemaining = getDaysRemaining(targetDate);
    const threshold = Number.isInteger(resource.reminder_days) ? resource.reminder_days : reminderDays;
    if (daysRemaining !== null && daysRemaining <= threshold) {
      const dateKey = toDateStr(targetDate);
      
      const { rows: existingAlert } = await db.query(
        `SELECT id FROM asset_reminders_sent
         WHERE resource_type = $1 AND resource_id = $2 AND reminder_type = $3 AND target_date = $4`,
        [resourceType, resource.id, reminderType, dateKey]
      );

      if (existingAlert.length > 0) return; // Already sent

      try {
        const emailData = emailTemplateFunc(resource, ...templateArgs, daysRemaining);
        await sendEmail({
          to: recipientEmails,
          subject: emailData.subject,
          html: emailData.html,
        });

        await db.query(
          `INSERT INTO asset_reminders_sent (resource_type, resource_id, reminder_type, target_date, sent_to)
           VALUES ($1, $2, $3, $4, $5)`,
          [resourceType, resource.id, reminderType, dateKey, recipientEmails.join(', ')]
        );
        sentCount++;
      } catch (err) {
        console.error(`[REMINDERS] Failed to send email for ${resourceType} ${resource.id}:`, err.message);
      }
    }
  };

  // 1. Buildings - Lease Expiry
  const { rows: buildings } = await db.query('SELECT * FROM buildings');
  for (const b of buildings) {
    await processReminder('building', b, 'lease_expiry', 'lease', templates.leaseExpiryAlert);
    
    // Also check insurance policies inside the JSONB if present
    if (b.insurance_policies && Array.isArray(b.insurance_policies)) {
      for (const policy of b.insurance_policies) {
        if (policy.expiryDate) {
          const daysRem = getDaysRemaining(policy.expiryDate);
          if (daysRem !== null && daysRem <= reminderDays) {
            const dateKey = toDateStr(policy.expiryDate);
            const { rows: existingAlert } = await db.query(
              `SELECT id FROM asset_reminders_sent
               WHERE resource_type = $1 AND resource_id = $2 AND reminder_type = $3 AND target_date = $4`,
              ['building', b.id, `insurance_${policy.policyNumber}`, dateKey]
            );
            if (existingAlert.length === 0) {
              const details = `Provider: ${policy.provider}, Policy: ${policy.policyNumber}`;
              const emailData = templates.insuranceRenewalAlert(b, details, daysRem);
              try {
                await sendEmail({ to: recipientEmails, subject: emailData.subject, html: emailData.html });
                await db.query(
                  `INSERT INTO asset_reminders_sent (resource_type, resource_id, reminder_type, target_date, sent_to)
                   VALUES ($1, $2, $3, $4, $5)`,
                  ['building', b.id, `insurance_${policy.policyNumber}`, dateKey, recipientEmails.join(', ')]
                );
                sentCount++;
              } catch (e) {}
            }
          }
        }
      }
    }
  }

  // 2. Assets - Maintenance
  const { rows: assets } = await db.query('SELECT * FROM assets');
  for (const a of assets) {
    if (a.maintenance_schedule && a.maintenance_schedule.nextDueDate) {
      const daysRem = getDaysRemaining(a.maintenance_schedule.nextDueDate);
      if (daysRem !== null && daysRem <= reminderDays) {
        const dateKey = toDateStr(a.maintenance_schedule.nextDueDate);
        const { rows: existingAlert } = await db.query(
          `SELECT id FROM asset_reminders_sent
           WHERE resource_type = $1 AND resource_id = $2 AND reminder_type = $3 AND target_date = $4`,
          ['asset', a.id, 'maintenance', dateKey]
        );
        if (existingAlert.length === 0) {
          const details = a.maintenance_schedule.type || 'Scheduled Maintenance';
          const emailData = templates.assetMaintenanceAlert(a, details, daysRem);
          try {
            await sendEmail({ to: recipientEmails, subject: emailData.subject, html: emailData.html });
            await db.query(
              `INSERT INTO asset_reminders_sent (resource_type, resource_id, reminder_type, target_date, sent_to)
               VALUES ($1, $2, $3, $4, $5)`,
              ['asset', a.id, 'maintenance', dateKey, recipientEmails.join(', ')]
            );
            sentCount++;
          } catch (e) {}
        }
      }
    }
  }

  // 3. IT Resources - Renewal
  const { rows: itResources } = await db.query('SELECT * FROM it_resources');
  for (const it of itResources) {
    await processReminder('it_resource', it, 'renewal_date', 'renewal', templates.itRenewalAlert);
  }

  console.log(`[REMINDERS] Asset reminders scan complete. Sent: ${sentCount}`);
};

module.exports = { runAssetReminders };
