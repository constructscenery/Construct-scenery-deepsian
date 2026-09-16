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

// Calculate deadline status and days remaining
const calculateDeadline = (dateStr, reminderDaysThreshold = 30) => {
  if (!dateStr) return { date: null, days_remaining: null, status: 'none', label: 'Not Set' };
  const target = new Date(dateStr);
  const now = new Date();
  // Strip time for clean day comparison
  target.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);

  const diffMs = target.getTime() - now.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));

  let status = 'compliant'; // green
  if (days < 0) {
    status = 'overdue'; // red
  } else if (days <= reminderDaysThreshold) {
    status = 'due_soon'; // amber
  }

  return {
    date: toDateStr(dateStr),
    days_remaining: days,
    status,
    label: days < 0 ? `${Math.abs(days)} days overdue` : days === 0 ? 'Due today' : `${days} days remaining`,
  };
};

// Calculate hire equipment duration and cost
const calculateHireMetrics = (startDateStr, returnDateStr, weeklyRate) => {
  const start = new Date(startDateStr);
  const end = returnDateStr ? new Date(returnDateStr) : new Date();
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const diffDays = Math.max(0, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  // Number of weeks (standard: ceil of days / 7, min 1 week if active/started)
  const weeksHired = diffDays === 0 ? 1 : Math.ceil(diffDays / 7);
  const rate = parseFloat(weeklyRate || 0);
  const totalCost = Number((rate * weeksHired).toFixed(2));

  return {
    days_hired: diffDays,
    weeks_hired: weeksHired,
    total_cost: totalCost,
  };
};

// ─── VEHICLE CONTROLLERS ──────────────────────────────────────────────────────

// GET /api/vehicles
const getVehicles = async (req, res) => {
  const { search, status, vehicle_type } = req.query;

  try {
    const conds = ['1=1'];
    const params = [];
    let i = 1;

    if (search) {
      conds.push(`(registration_number ILIKE $${i} OR make ILIKE $${i} OR model ILIKE $${i} OR number_plate ILIKE $${i} OR owner_assigned_to ILIKE $${i})`);
      params.push(`%${search.trim()}%`);
      i++;
    }

    if (vehicle_type) {
      conds.push(`vehicle_type = $${i}`);
      params.push(vehicle_type);
      i++;
    }

    const { rows } = await db.query(
      `SELECT * FROM vehicles WHERE ${conds.join(' AND ')} ORDER BY make ASC, model ASC, registration_number ASC`,
      params
    );

    // Attach computed compliance statuses
    const vehicles = rows.map(v => {
      const mot = calculateDeadline(v.mot_expiry_date);
      const insurance = calculateDeadline(v.insurance_renewal_date);
      const tax = calculateDeadline(v.tax_renewal_date);

      // Overall vehicle status: overdue > due_soon > compliant
      let overallStatus = 'compliant';
      if (mot.status === 'overdue' || insurance.status === 'overdue' || tax.status === 'overdue') {
        overallStatus = 'overdue';
      } else if (mot.status === 'due_soon' || insurance.status === 'due_soon' || tax.status === 'due_soon') {
        overallStatus = 'due_soon';
      }

      return {
        ...v,
        mot_expiry_date: toDateStr(v.mot_expiry_date),
        insurance_renewal_date: toDateStr(v.insurance_renewal_date),
        tax_renewal_date: toDateStr(v.tax_renewal_date),
        mot_compliance: mot,
        insurance_compliance: insurance,
        tax_compliance: tax,
        overall_status: overallStatus,
      };
    });

    // Optional status filter (compliant, due_soon, overdue, attention_needed)
    let filtered = vehicles;
    if (status === 'attention_needed') {
      filtered = vehicles.filter(v => v.overall_status === 'overdue' || v.overall_status === 'due_soon');
    } else if (status) {
      filtered = vehicles.filter(v => v.overall_status === status);
    }

    res.json({ vehicles: filtered });
  } catch (err) {
    console.error('getVehicles error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// GET /api/vehicles/:id
const getVehicleById = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM vehicles WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Vehicle not found' });
    const v = rows[0];

    const mot = calculateDeadline(v.mot_expiry_date);
    const insurance = calculateDeadline(v.insurance_renewal_date);
    const tax = calculateDeadline(v.tax_renewal_date);

    res.json({
      vehicle: {
        ...v,
        mot_expiry_date: toDateStr(v.mot_expiry_date),
        insurance_renewal_date: toDateStr(v.insurance_renewal_date),
        tax_renewal_date: toDateStr(v.tax_renewal_date),
        mot_compliance: mot,
        insurance_compliance: insurance,
        tax_compliance: tax,
      },
    });
  } catch (err) {
    console.error('getVehicleById error:', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/vehicles
const createVehicle = async (req, res) => {
  const {
    registration_number, make, model, year_of_manufacture,
    number_plate, colour, vehicle_type, owner_assigned_to,
    notes, mileage, mot_expiry_date, insurance_renewal_date, tax_renewal_date, tax_direct_debit,
  } = req.body;

  if (!registration_number || !make || !model) {
    return res.status(400).json({ error: 'Registration number, make, and model are required' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO vehicles (
        registration_number, make, model, year_of_manufacture,
        number_plate, colour, vehicle_type, owner_assigned_to,
        notes, mileage, mot_expiry_date, insurance_renewal_date, tax_renewal_date, tax_direct_debit
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        registration_number.trim(),
        make.trim(),
        model.trim(),
        year_of_manufacture ? parseInt(year_of_manufacture, 10) : null,
        number_plate ? number_plate.trim() : null,
        colour ? colour.trim() : null,
        vehicle_type ? vehicle_type.trim() : null,
        owner_assigned_to ? owner_assigned_to.trim() : null,
        notes ? notes.trim() : null,
        mileage !== undefined && mileage !== null && mileage !== '' ? parseInt(mileage, 10) : null,
        mot_expiry_date || null,
        insurance_renewal_date || null,
        tax_renewal_date || null,
        tax_direct_debit ?? false,
      ]
    );

    res.status(201).json({ message: 'Vehicle added successfully', vehicle: rows[0] });
  } catch (err) {
    console.error('createVehicle error:', err);
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/vehicles/:id
const updateVehicle = async (req, res) => {
  const { id } = req.params;
  const {
    registration_number, make, model, year_of_manufacture,
    number_plate, colour, vehicle_type, owner_assigned_to,
    notes, mileage, mot_expiry_date, insurance_renewal_date, tax_renewal_date, tax_direct_debit,
  } = req.body;

  try {
    const { rows } = await db.query(
      `UPDATE vehicles SET
        registration_number    = COALESCE($1, registration_number),
        make                   = COALESCE($2, make),
        model                  = COALESCE($3, model),
        year_of_manufacture    = $4,
        number_plate           = $5,
        colour                 = $6,
        vehicle_type           = $7,
        owner_assigned_to      = $8,
        notes                  = $9,
        mileage                = $10,
        mot_expiry_date        = $11,
        insurance_renewal_date = $12,
        tax_renewal_date       = $13,
        tax_direct_debit      = COALESCE($14, tax_direct_debit),
        updated_at             = NOW()
      WHERE id = $15
      RETURNING *`,
      [
        registration_number?.trim(),
        make?.trim(),
        model?.trim(),
        year_of_manufacture !== undefined ? (year_of_manufacture ? parseInt(year_of_manufacture, 10) : null) : undefined,
        number_plate !== undefined ? (number_plate ? number_plate.trim() : null) : undefined,
        colour !== undefined ? (colour ? colour.trim() : null) : undefined,
        vehicle_type !== undefined ? (vehicle_type ? vehicle_type.trim() : null) : undefined,
        owner_assigned_to !== undefined ? (owner_assigned_to ? owner_assigned_to.trim() : null) : undefined,
        notes !== undefined ? (notes ? notes.trim() : null) : undefined,
        mileage !== undefined ? (mileage !== null && mileage !== '' ? parseInt(mileage, 10) : null) : undefined,
        mot_expiry_date !== undefined ? mot_expiry_date : undefined,
        insurance_renewal_date !== undefined ? insurance_renewal_date : undefined,
        tax_renewal_date !== undefined ? tax_renewal_date : undefined,
        tax_direct_debit !== undefined ? tax_direct_debit : undefined,
        id,
      ]
    );

    if (!rows.length) return res.status(404).json({ error: 'Vehicle not found' });
    res.json({ message: 'Vehicle updated successfully', vehicle: rows[0] });
  } catch (err) {
    console.error('updateVehicle error:', err);
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/vehicles/:id
const deleteVehicle = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await db.query('DELETE FROM vehicles WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Vehicle not found' });
    res.json({ message: 'Vehicle deleted successfully' });
  } catch (err) {
    console.error('deleteVehicle error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── HIRE EQUIPMENT CONTROLLERS ───────────────────────────────────────────────

// GET /api/hire-equipment
const getHireEquipment = async (req, res) => {
  const { production_id, status, supplier_name, search } = req.query;

  try {
    const conds = ['1=1'];
    const params = [];
    let i = 1;

    if (production_id) {
      conds.push(`he.production_id = $${i}`);
      params.push(production_id);
      i++;
    }

    if (status) {
      conds.push(`he.status = $${i}`);
      params.push(status);
      i++;
    }

    if (supplier_name) {
      conds.push(`he.supplier_name ILIKE $${i}`);
      params.push(`%${supplier_name.trim()}%`);
      i++;
    }

    if (search) {
      conds.push(`(he.equipment_type ILIKE $${i} OR he.supplier_name ILIKE $${i} OR he.description ILIKE $${i} OR p.name ILIKE $${i})`);
      params.push(`%${search.trim()}%`);
      i++;
    }

    const { rows } = await db.query(
      `SELECT he.*,
              p.name AS production_name,
              p.status AS production_status,
              s.name AS supplier_official_name
       FROM hire_equipment he
       JOIN productions p ON p.id = he.production_id
       LEFT JOIN suppliers s ON s.id = he.supplier_id
       WHERE ${conds.join(' AND ')}
       ORDER BY (CASE WHEN he.status = 'active' THEN 0 ELSE 1 END), he.hire_start_date DESC, he.created_at DESC`,
      params
    );

    const items = rows.map(item => {
      const metrics = calculateHireMetrics(item.hire_start_date, item.return_date, item.weekly_hire_rate);
      return {
        ...item,
        hire_start_date: toDateStr(item.hire_start_date),
        return_date: toDateStr(item.return_date),
        weekly_hire_rate: parseFloat(item.weekly_hire_rate || 0),
        days_hired: metrics.days_hired,
        weeks_hired: metrics.weeks_hired,
        total_cost: metrics.total_cost,
      };
    });

    res.json({ hire_equipment: items });
  } catch (err) {
    console.error('getHireEquipment error:', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/hire-equipment/:id
const getHireEquipmentById = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT he.*, p.name AS production_name, s.name AS supplier_official_name
       FROM hire_equipment he
       JOIN productions p ON p.id = he.production_id
       LEFT JOIN suppliers s ON s.id = he.supplier_id
       WHERE he.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Hire record not found' });
    const item = rows[0];
    const metrics = calculateHireMetrics(item.hire_start_date, item.return_date, item.weekly_hire_rate);

    res.json({
      hire_equipment: {
        ...item,
        hire_start_date: toDateStr(item.hire_start_date),
        return_date: toDateStr(item.return_date),
        weekly_hire_rate: parseFloat(item.weekly_hire_rate || 0),
        days_hired: metrics.days_hired,
        weeks_hired: metrics.weeks_hired,
        total_cost: metrics.total_cost,
      },
    });
  } catch (err) {
    console.error('getHireEquipmentById error:', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/hire-equipment
const createHireEquipment = async (req, res) => {
  const {
    equipment_type, supplier_id, supplier_name, description,
    production_id, hire_start_date, weekly_hire_rate, return_date,
    notes, status,
  } = req.body;

  if (!equipment_type || !supplier_name || !production_id || !hire_start_date || weekly_hire_rate === undefined) {
    return res.status(400).json({
      error: 'Equipment type, supplier name, production, start date, and weekly hire rate are required',
    });
  }

  try {
    const itemStatus = return_date ? 'returned' : (status || 'active');

    const { rows } = await db.query(
      `INSERT INTO hire_equipment (
        equipment_type, supplier_id, supplier_name, description,
        production_id, hire_start_date, weekly_hire_rate, return_date,
        status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        equipment_type.trim(),
        supplier_id || null,
        supplier_name.trim(),
        description ? description.trim() : null,
        production_id,
        hire_start_date,
        parseFloat(weekly_hire_rate || 0),
        return_date || null,
        itemStatus,
        notes ? notes.trim() : null,
      ]
    );

    res.status(201).json({ message: 'Equipment hire recorded successfully', hire_equipment: rows[0] });
  } catch (err) {
    console.error('createHireEquipment error:', err);
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/hire-equipment/:id
const updateHireEquipment = async (req, res) => {
  const { id } = req.params;
  const {
    equipment_type, supplier_id, supplier_name, description,
    production_id, hire_start_date, weekly_hire_rate, return_date,
    status, notes,
  } = req.body;

  try {
    const newStatus = return_date ? 'returned' : (status !== undefined ? status : undefined);

    const { rows } = await db.query(
      `UPDATE hire_equipment SET
        equipment_type   = COALESCE($1, equipment_type),
        supplier_id      = $2,
        supplier_name    = COALESCE($3, supplier_name),
        description      = $4,
        production_id    = COALESCE($5, production_id),
        hire_start_date  = COALESCE($6, hire_start_date),
        weekly_hire_rate = COALESCE($7, weekly_hire_rate),
        return_date      = $8,
        status           = COALESCE($9, status),
        notes            = $10,
        updated_at       = NOW()
      WHERE id = $11
      RETURNING *`,
      [
        equipment_type?.trim(),
        supplier_id !== undefined ? supplier_id : undefined,
        supplier_name?.trim(),
        description !== undefined ? (description ? description.trim() : null) : undefined,
        production_id,
        hire_start_date,
        weekly_hire_rate !== undefined ? parseFloat(weekly_hire_rate) : undefined,
        return_date !== undefined ? return_date : undefined,
        newStatus,
        notes !== undefined ? (notes ? notes.trim() : null) : undefined,
        id,
      ]
    );

    if (!rows.length) return res.status(404).json({ error: 'Hire record not found' });
    res.json({ message: 'Hire record updated successfully', hire_equipment: rows[0] });
  } catch (err) {
    console.error('updateHireEquipment error:', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/hire-equipment/:id/return (Closes the hire record)
const returnHireEquipment = async (req, res) => {
  const { id } = req.params;
  const { return_date, notes } = req.body;

  const actualReturnDate = return_date || new Date().toISOString().split('T')[0];

  try {
    const { rows } = await db.query(
      `UPDATE hire_equipment SET
        return_date = $1,
        status      = 'returned',
        notes       = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE notes END,
        updated_at  = NOW()
      WHERE id = $3
      RETURNING *`,
      [actualReturnDate, notes ? notes.trim() : null, id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Hire record not found' });

    const item = rows[0];
    const metrics = calculateHireMetrics(item.hire_start_date, item.return_date, item.weekly_hire_rate);

    res.json({
      message: 'Equipment returned and hire record closed',
      hire_equipment: {
        ...item,
        hire_start_date: toDateStr(item.hire_start_date),
        return_date: toDateStr(item.return_date),
        weekly_hire_rate: parseFloat(item.weekly_hire_rate || 0),
        days_hired: metrics.days_hired,
        weeks_hired: metrics.weeks_hired,
        total_cost: metrics.total_cost,
      },
    });
  } catch (err) {
    console.error('returnHireEquipment error:', err);
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/hire-equipment/:id
const deleteHireEquipment = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await db.query('DELETE FROM hire_equipment WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Hire record not found' });
    res.json({ message: 'Hire record deleted successfully' });
  } catch (err) {
    console.error('deleteHireEquipment error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── SUMMARY & METRICS ────────────────────────────────────────────────────────

// GET /api/assets-hire/summary
const getAssetsHireSummary = async (req, res) => {
  try {
    const [vehiclesRes, hireRes] = await Promise.all([
      db.query('SELECT * FROM vehicles'),
      db.query(`
        SELECT he.*, p.name AS production_name
        FROM hire_equipment he
        JOIN productions p ON p.id = he.production_id
      `),
    ]);

    const vehicles = vehiclesRes.rows;
    const hires = hireRes.rows;

    let motDueCount = 0;
    let insuranceDueCount = 0;
    let taxDueCount = 0;
    let overdueCount = 0;

    vehicles.forEach(v => {
      const mot = calculateDeadline(v.mot_expiry_date);
      const ins = calculateDeadline(v.insurance_renewal_date);
      const tax = calculateDeadline(v.tax_renewal_date);

      if (mot.status === 'overdue') overdueCount++;
      else if (mot.status === 'due_soon') motDueCount++;

      if (ins.status === 'overdue') overdueCount++;
      else if (ins.status === 'due_soon') insuranceDueCount++;

      if (tax.status === 'overdue') overdueCount++;
      else if (tax.status === 'due_soon') taxDueCount++;
    });

    let activeHiresCount = 0;
    let activeWeeklyRunRate = 0;
    let totalHireCostToDate = 0;

    hires.forEach(h => {
      const metrics = calculateHireMetrics(h.hire_start_date, h.return_date, h.weekly_hire_rate);
      totalHireCostToDate += metrics.total_cost;
      if (h.status === 'active') {
        activeHiresCount++;
        activeWeeklyRunRate += parseFloat(h.weekly_hire_rate || 0);
      }
    });

    res.json({
      summary: {
        total_vehicles: vehicles.length,
        deadlines_due_soon: motDueCount + insuranceDueCount + taxDueCount,
        deadlines_overdue: overdueCount,
        mot_due_count: motDueCount,
        insurance_due_count: insuranceDueCount,
        tax_due_count: taxDueCount,
        active_hires_count: activeHiresCount,
        total_hires_count: hires.length,
        active_weekly_run_rate: Number(activeWeeklyRunRate.toFixed(2)),
        total_hire_cost_to_date: Number(totalHireCostToDate.toFixed(2)),
      },
    });
  } catch (err) {
    console.error('getAssetsHireSummary error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─── AUTOMATED VEHICLE COMPLIANCE ALERTS ──────────────────────────────────────

/**
 * Scans all vehicles and sends compliance alert emails for deadlines within threshold.
 * Runs on daily cron (07:15 UTC) and can be invoked manually.
 */
const runVehicleComplianceAlerts = async () => {
  console.log(`[COMPLIANCE] Scanning vehicle compliance deadlines...`);

  // Default 30 days or read from settings
  let reminderDays = 30;
  try {
    const { rows: settingRows } = await db.query(
      `SELECT value FROM app_settings WHERE key = 'vehicle_reminder_days'`
    );
    if (settingRows.length && settingRows[0].value) {
      reminderDays = parseInt(settingRows[0].value, 10) || 30;
    }
  } catch { /* use default */ }

  const { rows: vehicles } = await db.query('SELECT * FROM vehicles');
  if (!vehicles.length) return { sent: 0, skipped: 0 };

  // Fetch recipients: Construction Coordinators, Managing Directors & Accountants
  const { rows: recipients } = await db.query(
    `SELECT email, full_name, role FROM users WHERE role IN ('construction_coordinator', 'managing_director', 'construction_accountant') AND is_active = true`
  );

  const recipientEmails = recipients.map(r => r.email).filter(Boolean);
  if (!recipientEmails.length) {
    console.warn('[COMPLIANCE] No active staff found to receive vehicle alerts.');
    return { sent: 0, skipped: 0 };
  }

  let sentCount = 0;
  let skippedCount = 0;

  for (const v of vehicles) {
    const deadlines = [
      { type: 'mot', label: 'MOT Expiry', date: v.mot_expiry_date },
      { type: 'insurance', label: 'Insurance Renewal', date: v.insurance_renewal_date },
      { type: 'tax', label: 'Vehicle Tax (VED) Renewal', date: v.tax_renewal_date },
    ];

    for (const d of deadlines) {
      if (!d.date) continue;
      const calc = calculateDeadline(d.date, reminderDays);

      // Check if deadline is due within threshold (or overdue)
      if (calc.days_remaining !== null && calc.days_remaining <= reminderDays) {
        // Check if we already sent an alert for this vehicle + deadline + expiry date
        const dateKey = toDateStr(d.date);
        const { rows: existingAlert } = await db.query(
          `SELECT id FROM vehicle_compliance_alerts_sent
           WHERE vehicle_id = $1 AND deadline_type = $2 AND expiry_date = $3`,
          [v.id, d.type, dateKey]
        );

        if (existingAlert.length > 0) {
          skippedCount++;
          continue; // Already sent alert for this period
        }

        // Send Email via SES
        try {
          const emailData = templates.vehicleComplianceAlert(v, d.label, dateKey, calc.days_remaining);
          await sendEmail({
            to: recipientEmails,
            subject: emailData.subject,
            html: emailData.html,
          });

          // Log sent alert
          await db.query(
            `INSERT INTO vehicle_compliance_alerts_sent
             (vehicle_id, deadline_type, expiry_date, days_before, sent_to)
             VALUES ($1, $2, $3, $4, $5)`,
            [v.id, d.type, dateKey, calc.days_remaining, recipientEmails.join(', ')]
          );

          sentCount++;
          console.log(`[COMPLIANCE] Sent ${d.label} alert for ${v.registration_number} (${v.make} ${v.model}) to ${recipientEmails.join(', ')}`);
        } catch (mailErr) {
          console.error(`[COMPLIANCE] Failed to send email for vehicle ${v.id}:`, mailErr.message);
        }
      }
    }
  }

  return { sent: sentCount, skipped: skippedCount };
};

// POST /api/vehicles/compliance-check (Manual trigger)
const triggerVehicleComplianceCheck = async (req, res) => {
  try {
    const result = await runVehicleComplianceAlerts();
    res.json({ message: 'Compliance check completed', ...result });
  } catch (err) {
    console.error('triggerVehicleComplianceCheck error:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getVehicles,
  getVehicleById,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  getHireEquipment,
  getHireEquipmentById,
  createHireEquipment,
  updateHireEquipment,
  returnHireEquipment,
  deleteHireEquipment,
  getAssetsHireSummary,
  runVehicleComplianceAlerts,
  triggerVehicleComplianceCheck,
};
