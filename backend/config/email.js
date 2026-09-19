/**
 * Email service — AWS SES via nodemailer SES transport.
 * All outbound email goes through SES using AWS_SES_FROM_EMAIL.
 *
 * Usage:
 *   const { sendEmail } = require('../config/email');
 *   await sendEmail({ to: 'user@example.com', subject: 'Hello', html: '<p>Hi</p>' });
 */

require('dotenv').config();
const nodemailer = require('nodemailer');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const sesClient = new SESv2Client({
  region: process.env.AWS_REGION || 'eu-north-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const transporter = nodemailer.createTransport({
  SES: { sesClient, SendEmailCommand },
});

/**
 * Send a single email via SES.
 * @param {object} opts
 * @param {string|string[]} opts.to          - Recipient(s)
 * @param {string}          opts.subject     - Subject line
 * @param {string}          opts.html        - HTML body
 * @param {string}          [opts.text]      - Plain-text fallback
 * @param {string}          [opts.from]      - Override sender
 * @param {string}          [opts.replyTo]   - Reply-to address
 * @param {Array}           [opts.attachments] - nodemailer attachment objects
 */
const sendEmail = async ({ to, subject, html, text, from, replyTo, attachments }) => {
  const fromAddress = from || `"Construct Scenery" <${process.env.AWS_SES_FROM_EMAIL}>`;
  const opts = { from: fromAddress, to, subject, html, text };
  if (replyTo)     opts.replyTo     = replyTo;
  if (attachments) opts.attachments = attachments;

  try {
    const info = await transporter.sendMail(opts);
    console.log(`📧 Email sent via SES → ${Array.isArray(to) ? to.join(', ') : to} | ${subject}`);
    return info;
  } catch (err) {
    console.error(`❌ SES email failed → ${subject}:`, err.message);
    throw err;
  }
};

// ─── Email Templates ─────────────────────────────────────────────────────────

const templates = {

  insuranceCertificateExpiryAlert: (document, daysRemaining) => {
    const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    const timing = daysRemaining < 0 ? `expired ${Math.abs(daysRemaining)} days ago` : daysRemaining === 0 ? 'expires today' : `expires in ${daysRemaining} days`;
    return {
      subject: `Insurance Expiry Alert: ${document.file_name} (${timing})`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><h2>Health &amp; Safety</h2><h3>Insurance Expiry Notice</h3><p><strong>${escapeHtml(document.file_name)}</strong> ${timing}.</p><p>Expiry date: <strong>${escapeHtml(document.expiry_date)}</strong></p><p>Please renew the policy and update its certificate and expiry date in Health &amp; Safety.</p></div>`,
    };
  },

  /**
   * PO issued to supplier (triggered by POST /api/purchase-orders/:id/issue)
   */
  poIssued: (po, productionName) => ({
    subject: `Purchase Order ${po.po_number} — Construct Scenery Limited`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#0f172a;padding:20px 24px;margin-bottom:24px">
          <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:1px">Construct Scenery</span>
          <span style="color:#94a3b8;font-size:12px;margin-left:12px">Construct Scenery Limited</span>
        </div>
        <h2 style="color:#0f172a;margin:0 0 4px">Purchase Order: ${po.po_number}</h2>
        <p style="color:#64748b;margin:0 0 20px">Production: <strong>${productionName || '—'}</strong></p>
        <p>Dear ${po.supplier_name},</p>
        <p>Please find attached a purchase order issued by <strong>Construct Scenery Limited</strong>.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr style="background:#f8fafc"><td style="padding:8px 12px;border:1px solid #e2e8f0"><strong>PO Number</strong></td><td style="padding:8px 12px;border:1px solid #e2e8f0">${po.po_number}</td></tr>
          <tr><td style="padding:8px 12px;border:1px solid #e2e8f0"><strong>Date</strong></td><td style="padding:8px 12px;border:1px solid #e2e8f0">${po.date_of_po}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:8px 12px;border:1px solid #e2e8f0"><strong>Production</strong></td><td style="padding:8px 12px;border:1px solid #e2e8f0">${productionName || '—'}</td></tr>
          <tr><td style="padding:8px 12px;border:1px solid #e2e8f0"><strong>Description</strong></td><td style="padding:8px 12px;border:1px solid #e2e8f0">${po.description || '—'}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:8px 12px;border:1px solid #e2e8f0"><strong>Net Amount</strong></td><td style="padding:8px 12px;border:1px solid #e2e8f0">£${parseFloat(po.net_amount).toFixed(2)}</td></tr>
          <tr><td style="padding:8px 12px;border:1px solid #e2e8f0"><strong>VAT</strong></td><td style="padding:8px 12px;border:1px solid #e2e8f0">£${parseFloat(po.vat || 0).toFixed(2)}</td></tr>
          <tr style="background:#f8fafc"><td style="padding:8px 12px;border:1px solid #e2e8f0"><strong>Gross Amount</strong></td><td style="padding:8px 12px;border:1px solid #e2e8f0"><strong>£${parseFloat(po.gross_amount).toFixed(2)}</strong></td></tr>
        </table>
        <p>Please confirm receipt of this order and supply the goods/services as specified.</p>
        <p>When invoicing, please quote the PO number <strong>${po.po_number}</strong> on your invoice.</p>
        <br/>
        <p style="color:#666">Regards,<br/><strong>Construct Scenery Limited</strong><br/>warren@constructscenery.co.uk</p>
      </div>
    `,
  }),

  /**
   * Timesheet distributed to crew member.
   */
  timesheetDistributed: (crewName, weekEndingDate, productionName, daysWorked, grandTotal) => ({
    subject: `Timesheet for Week Ending ${weekEndingDate} — ${productionName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#0f172a;padding:16px 24px;margin-bottom:24px">
          <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:1px">Construct Scenery</span>
          <span style="color:#94a3b8;font-size:11px;margin-left:10px">Construct Scenery Limited</span>
        </div>
        <h2 style="color:#0f172a;margin:0 0 4px">Timesheet: Week Ending ${weekEndingDate}</h2>
        <p style="color:#64748b;margin:0 0 20px">Production: <strong>${productionName || '—'}</strong></p>
        <p>Dear ${crewName},</p>
        <p>Please find your timesheet for the week ending <strong>${weekEndingDate}</strong> attached to this email.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:6px">
          <tr>
            <td style="padding:10px 16px;border-bottom:1px solid #e2e8f0"><strong>Days worked</strong></td>
            <td style="padding:10px 16px;border-bottom:1px solid #e2e8f0">${daysWorked ?? '—'}</td>
          </tr>
          <tr>
            <td style="padding:10px 16px"><strong>Grand total</strong></td>
            <td style="padding:10px 16px"><strong>£${parseFloat(grandTotal || 0).toFixed(2)}</strong></td>
          </tr>
        </table>
        <p>If everything looks correct, please sign the timesheet and reply to this email with:</p>
        <ol>
          <li>Your <strong>signed timesheet</strong> (the attached PDF, signed and scanned/photographed)</li>
          <li>Your <strong>invoice</strong> for the amount shown above</li>
        </ol>
        <p>If anything needs correcting, please reply explaining the issue and we will amend and resend.</p>
        <br/>
        <p style="color:#666;font-size:13px">Regards,<br/><strong>Construct Scenery Limited</strong><br/>invoice@constructscenery.co.uk</p>
      </div>
    `,
  }),

  /**
   * Invoice chase reminder (self-employed crew only).
   */
  invoiceChase: (crewName, weekEndingDate, grandTotal) => ({
    subject: `Reminder: Invoice Required — Week Ending ${weekEndingDate}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#0f172a;padding:16px 24px;margin-bottom:24px">
          <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:1px">Construct Scenery</span>
          <span style="color:#94a3b8;font-size:11px;margin-left:10px">Construct Scenery Limited</span>
        </div>
        <h2 style="color:#b91c1c;margin:0 0 4px">Invoice Required</h2>
        <p style="color:#64748b;margin:0 0 20px">Week ending: <strong>${weekEndingDate}</strong></p>
        <p>Dear ${crewName},</p>
        <p>We have not yet received your invoice for the week ending <strong>${weekEndingDate}</strong>.</p>
        <p>Your timesheet total is <strong>£${parseFloat(grandTotal || 0).toFixed(2)}</strong>. Please submit your invoice for this amount as soon as possible so we can process your payment promptly.</p>
        <p>Please reply to this email with your invoice attached. If you have already sent it, please disregard this message.</p>
        <br/>
        <p style="color:#666;font-size:13px">Regards,<br/><strong>Construct Scenery Limited</strong><br/>invoice@constructscenery.co.uk</p>
      </div>
    `,
  }),

  /**
   * Handover alert — sent to coordinators + MD at 14-day and 7-day marks
   */
  handoverAlert: (set, days) => {
    const handoverDate = set.handover_date
      ? new Date(set.handover_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : '—';
    const statusLabel = (set.completion_status ?? '').replace(/_/g, ' ');
    const appUrl  = process.env.APP_URL || 'https://deepsian.onrender.com';
    const deepLink = `${appUrl}/productions/${set.prod_id}`;
    const dotColor = days <= 7 ? '#ef4444' : '#f59e0b';
    return {
      subject: `Handover alert — ${set.set_name}${set.set_number ? ` (Set ${set.set_number})` : ''} · ${days} days`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
          <div style="background:#1e293b;padding:16px 24px">
            <p style="color:#94a3b8;font-size:11px;margin:0;letter-spacing:1px;text-transform:uppercase">Handover alert — ${set.set_name}${set.set_number ? ` (Set ${set.set_number})` : ''}</p>
            <p style="color:#64748b;font-size:11px;margin:6px 0 0">From: invoice@constructscenery.co.uk &nbsp;·&nbsp; To: coordinator, warren</p>
          </div>
          <div style="padding:24px">
            <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:20px">
              <span style="color:${dotColor};font-size:18px;margin-top:1px">⏱</span>
              <div>
                <p style="font-weight:700;color:#1e293b;margin:0;font-size:15px">${days} days to handover</p>
                <p style="color:#475569;font-size:13px;margin:6px 0 0">
                  <strong>${set.set_name}${set.set_number ? ` — (Set ${set.set_number})` : ''}</strong>
                  is due for handover to production on <strong>${handoverDate}</strong>.
                  Current status: <strong style="text-transform:capitalize">${statusLabel || 'Not started'}</strong>.
                </p>
              </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:20px;padding-top:16px;border-top:1px solid #e2e8f0">
              <span style="font-size:16px;margin-top:1px">🎬</span>
              <div>
                <p style="font-weight:700;color:#1e293b;margin:0;font-size:13px">Production</p>
                <p style="color:#475569;font-size:13px;margin:4px 0 0">
                  ${set.production_name ?? '—'}${set.production_company ? ` &nbsp;·&nbsp; ${set.production_company}` : ''}${set.production_designer ? ` &nbsp;·&nbsp; Production designer: ${set.production_designer}` : ''}
                </p>
              </div>
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:14px 16px">
              <a href="${deepLink}" style="color:#0ea5e9;font-size:13px;text-decoration:none">
                View full set schedule &rarr; <span style="text-decoration:underline">[link]</span>
              </a>
            </div>
          </div>
          <div style="background:#f8fafc;padding:10px 24px;border-top:1px solid #e2e8f0">
            <p style="color:#94a3b8;font-size:11px;margin:0">Construct Scenery Limited &nbsp;·&nbsp; Automated alert &nbsp;·&nbsp; Do not reply</p>
          </div>
        </div>
      `,
    };
  },

  /**
   * Vehicle compliance deadline alert — MOT, Insurance, Tax (VED)
   */
  vehicleComplianceAlert: (vehicle, deadlineLabel, expiryDate, daysRemaining) => {
    const formattedDate = expiryDate
      ? new Date(expiryDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : expiryDate;

    const isOverdue = daysRemaining < 0;
    const isDueToday = daysRemaining === 0;
    const dotColor = isOverdue ? '#ef4444' : daysRemaining <= 14 ? '#f59e0b' : '#3b82f6';
    const urgencyLabel = isOverdue
      ? `${Math.abs(daysRemaining)} Days Overdue`
      : isDueToday
      ? 'Due Today'
      : `${daysRemaining} Days Remaining`;

    const appUrl = process.env.APP_URL || 'https://frontend-csldatabase.vercel.app';
    const deepLink = `${appUrl}/assets-hire`;

    return {
      subject: `Vehicle Compliance Alert: ${vehicle.registration_number} — ${deadlineLabel} due (${urgencyLabel})`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
          <div style="background:#0f172a;padding:16px 24px">
            <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:1px">Construct Scenery</span>
            <span style="color:#94a3b8;font-size:11px;margin-left:10px">Fleet Compliance Register</span>
          </div>
          <div style="padding:24px">
            <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:20px">
              <span style="color:${dotColor};font-size:20px;line-height:1">⚠️</span>
              <div>
                <h3 style="color:#0f172a;margin:0 0 6px;font-size:16px">${deadlineLabel} Notice: ${urgencyLabel}</h3>
                <p style="color:#475569;font-size:14px;margin:0">
                  The <strong>${deadlineLabel}</strong> for vehicle <strong>${vehicle.registration_number}</strong> (${vehicle.make} ${vehicle.model}) is due on <strong>${formattedDate}</strong>.
                </p>
              </div>
            </div>

            <table style="width:100%;border-collapse:collapse;margin:20px 0;background:#f8fafc;border-radius:6px;overflow:hidden">
              <tr style="border-bottom:1px solid #e2e8f0">
                <td style="padding:10px 14px;font-size:13px;color:#64748b;width:35%">Registration Number</td>
                <td style="padding:10px 14px;font-size:13px;color:#0f172a;font-weight:600">${vehicle.registration_number}</td>
              </tr>
              <tr style="border-bottom:1px solid #e2e8f0">
                <td style="padding:10px 14px;font-size:13px;color:#64748b">Make & Model</td>
                <td style="padding:10px 14px;font-size:13px;color:#0f172a">${vehicle.make} ${vehicle.model} ${vehicle.year_of_manufacture ? `(${vehicle.year_of_manufacture})` : ''}</td>
              </tr>
              <tr style="border-bottom:1px solid #e2e8f0">
                <td style="padding:10px 14px;font-size:13px;color:#64748b">Vehicle Type</td>
                <td style="padding:10px 14px;font-size:13px;color:#0f172a">${vehicle.vehicle_type || '—'}</td>
              </tr>
              <tr style="border-bottom:1px solid #e2e8f0">
                <td style="padding:10px 14px;font-size:13px;color:#64748b">Assigned To</td>
                <td style="padding:10px 14px;font-size:13px;color:#0f172a">${vehicle.owner_assigned_to || '—'}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-size:13px;color:#64748b">Deadline Date</td>
                <td style="padding:10px 14px;font-size:13px;color:#b91c1c;font-weight:700">${formattedDate} (${urgencyLabel})</td>
              </tr>
            </table>

            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:12px 16px;margin-bottom:20px">
              <p style="color:#1e40af;font-size:13px;margin:0">
                Please arrange for the necessary renewal/inspection and update the vehicle record in the Assets & Hire module.
              </p>
            </div>

            <div style="text-align:center">
              <a href="${deepLink}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 20px;border-radius:6px">
                Open Assets & Hire Register &rarr;
              </a>
            </div>
          </div>
          <div style="background:#f8fafc;padding:12px 24px;border-top:1px solid #e2e8f0">
            <p style="color:#94a3b8;font-size:11px;margin:0">Construct Scenery Limited · Automated Fleet Alert · info@constructscenery.co.uk</p>
          </div>
        </div>
      `,
    };
  },

  /**
   * Crew Registration Invitation
   */
  crewInvite: ({ inviteeName, inviteUrl, senderName, customMessage, to }) => ({
    to,
    subject: 'Invitation to Register with Construct Scenery Crew Roster',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <div style="background:#1e3a8a;padding:24px;text-align:center">
          <h1 style="color:#ffffff;font-size:20px;margin:0">Construct Scenery Limited</h1>
          <p style="color:#93c5fd;font-size:13px;margin:6px 0 0">Crew Registration & Onboarding Portal</p>
        </div>
        <div style="padding:28px 24px">
          <h2 style="color:#0f172a;font-size:16px;margin:0 0 14px">Hello ${inviteeName || 'there'},</h2>
          <p style="color:#334155;font-size:14px;line-height:1.6;margin:0 0 16px">
            You have been invited by <strong>${senderName || 'Construct Scenery'}</strong> to register your details for our construction crew database.
          </p>
          ${customMessage ? `
            <div style="background:#f1f5f9;border-left:4px solid #3b82f6;padding:12px 16px;margin:16px 0;border-radius:0 6px 6px 0">
              <p style="color:#334155;font-size:13px;font-style:italic;margin:0">"${customMessage}"</p>
            </div>
          ` : ''}
          <p style="color:#334155;font-size:14px;line-height:1.6;margin:0 0 24px">
            Please click the button below to complete your crew onboarding form (contact information, trade specialism, emergency contact, and bank details for payroll).
          </p>
          <div style="text-align:center;margin:30px 0">
            <a href="${inviteUrl}" style="background:#2563eb;color:#ffffff;padding:14px 28px;font-size:15px;font-weight:600;text-decoration:none;border-radius:6px;display:inline-block">
              Complete Crew Registration &rarr;
            </a>
          </div>
          <p style="color:#64748b;font-size:12px;margin:24px 0 0;line-height:1.5">
            If the button above does not work, copy and paste this link into your browser:<br/>
            <a href="${inviteUrl}" style="color:#2563eb">${inviteUrl}</a>
          </p>
        </div>
        <div style="background:#f8fafc;padding:14px 24px;border-top:1px solid #e2e8f0;text-align:center">
          <p style="color:#94a3b8;font-size:11px;margin:0">Construct Scenery Limited · info@constructscenery.co.uk</p>
        </div>
      </div>
    `,
  }),

  /**
   * Crew Registration Approved Notification
   */
  crewApproved: ({ name, crewNumber, trade, rank, to }) => ({
    to,
    subject: `Construct Scenery — Crew Registration Approved (${crewNumber})`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <div style="background:#166534;padding:24px;text-align:center">
          <h1 style="color:#ffffff;font-size:20px;margin:0">Construct Scenery Limited</h1>
          <p style="color:#bbf7d0;font-size:13px;margin:6px 0 0">Crew Registration Confirmed</p>
        </div>
        <div style="padding:28px 24px">
          <h2 style="color:#0f172a;font-size:16px;margin:0 0 14px">Welcome aboard, ${name}!</h2>
          <p style="color:#334155;font-size:14px;line-height:1.6;margin:0 0 16px">
            Your registration request with Construct Scenery has been reviewed and approved.
          </p>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0">
            <table style="width:100%;font-size:14px;color:#334155">
              <tr>
                <td style="padding:4px 0;color:#64748b;width:40%">Crew Number:</td>
                <td style="padding:4px 0;font-weight:700;color:#166534;font-size:16px">${crewNumber}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#64748b">Trade / Department:</td>
                <td style="padding:4px 0;font-weight:600">${trade}</td>
              </tr>
              ${rank ? `
                <tr>
                  <td style="padding:4px 0;color:#64748b">Assigned Rank:</td>
                  <td style="padding:4px 0;font-weight:600">${rank}</td>
                </tr>
              ` : ''}
            </table>
          </div>
          <p style="color:#64748b;font-size:13px;margin:16px 0 0">
            Please quote your Crew Number (<strong>${crewNumber}</strong>) on all timesheets and correspondence.
          </p>
        </div>
        <div style="background:#f8fafc;padding:14px 24px;border-top:1px solid #e2e8f0;text-align:center">
          <p style="color:#94a3b8;font-size:11px;margin:0">Construct Scenery Limited · info@constructscenery.co.uk</p>
        </div>
      </div>
    `,
  }),

  /**
   * Building Lease Expiry Alert
   */
  leaseExpiryAlert: (building, daysRemaining) => ({
    subject: `Lease Expiry Alert: ${building.name} (${daysRemaining} days remaining)`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px">
        <div style="background:#0f172a;padding:16px 24px">
          <span style="color:#fff;font-size:18px;font-weight:700">Construct Scenery</span>
          <span style="color:#94a3b8;font-size:11px;margin-left:10px">Buildings Register</span>
        </div>
        <div style="padding:24px">
          <h3>Lease Expiry Notice</h3>
          <p>The lease for <strong>${building.name}</strong> is due to expire in <strong>${daysRemaining} days</strong> on <strong>${building.lease_expiry}</strong>.</p>
        </div>
      </div>
    `,
  }),

  /**
   * Building Insurance Renewal Alert
   */
  insuranceRenewalAlert: (building, policyDetails, daysRemaining) => ({
    subject: `Insurance Renewal Alert: ${building.name} (${daysRemaining} days remaining)`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px">
        <div style="background:#0f172a;padding:16px 24px">
          <span style="color:#fff;font-size:18px;font-weight:700">Construct Scenery</span>
          <span style="color:#94a3b8;font-size:11px;margin-left:10px">Buildings Register</span>
        </div>
        <div style="padding:24px">
          <h3>Insurance Renewal Notice</h3>
          <p>An insurance policy for <strong>${building.name}</strong> is due for renewal in <strong>${daysRemaining} days</strong>.</p>
          <p>Policy Details: ${policyDetails}</p>
        </div>
      </div>
    `,
  }),

  /**
   * Asset Maintenance Alert
   */
  assetMaintenanceAlert: (asset, maintenanceDetails, daysRemaining) => ({
    subject: `Asset Maintenance Alert: ${asset.name} (${daysRemaining} days remaining)`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px">
        <div style="background:#0f172a;padding:16px 24px">
          <span style="color:#fff;font-size:18px;font-weight:700">Construct Scenery</span>
          <span style="color:#94a3b8;font-size:11px;margin-left:10px">Assets Register</span>
        </div>
        <div style="padding:24px">
          <h3>Asset Maintenance Notice</h3>
          <p>Maintenance for asset <strong>${asset.name}</strong> is due in <strong>${daysRemaining} days</strong>.</p>
          <p>Details: ${maintenanceDetails}</p>
        </div>
      </div>
    `,
  }),

  /**
   * IT Subscription Renewal Alert
   */
  itRenewalAlert: (resource, daysRemaining) => ({
    subject: `IT Subscription Renewal: ${resource.name} (${daysRemaining} days remaining)`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px">
        <div style="background:#0f172a;padding:16px 24px">
          <span style="color:#fff;font-size:18px;font-weight:700">Construct Scenery</span>
          <span style="color:#94a3b8;font-size:11px;margin-left:10px">IT Register</span>
        </div>
        <div style="padding:24px">
          <h3>IT Subscription Renewal Notice</h3>
          <p>The subscription for <strong>${resource.name}</strong> is due for renewal in <strong>${daysRemaining} days</strong> on <strong>${resource.renewal_date}</strong>.</p>
        </div>
      </div>
    `,
  }),

};

module.exports = { sendEmail, templates };
