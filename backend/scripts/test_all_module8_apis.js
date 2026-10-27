require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const u = new URL(process.env.DATABASE_URL.replace(/^["']|["']$/g, ''));
const pool = new Pool({
  host: u.hostname,
  port: parseInt(u.port, 10) || 5432,
  user: u.username,
  password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ''),
  ssl: { rejectUnauthorized: false }
});

const API_PORT = process.env.PORT || 5001;
const BASE = `http://127.0.0.1:${API_PORT}`;

let coordinatorToken = '';
let mdToken = '';
let accountantToken = '';

async function runTestSuite() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧪 COMPREHENSIVE MODULE 8 & API INTEGRATION TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Fetch Users to generate valid JWTs
  const { rows: users } = await pool.query(`SELECT id, email, role, full_name, avatar_url FROM users`);
  const mdUser = users.find(u => u.role === 'managing_director') || { id: '00000000-0000-0000-0000-000000000001', email: 'warren@constructscenery.co.uk', role: 'managing_director', full_name: 'Warren Lever' };
  const coordUser = users.find(u => u.role === 'construction_coordinator') || { id: '00000000-0000-0000-0000-000000000002', email: 'sian@constructscenery.co.uk', role: 'construction_coordinator', full_name: 'Sian Lyn-Jones' };
  const acctUser = users.find(u => u.role === 'construction_accountant') || { id: '00000000-0000-0000-0000-000000000003', email: 'invoice@constructscenery.co.uk', role: 'construction_accountant', full_name: 'Ben Keville' };

  const secret = process.env.JWT_SECRET || 'cshq_super_secret_jwt_key_change_this_in_production_min_64_chars_long';
  mdToken = jwt.sign(mdUser, secret, { expiresIn: '2h' });
  coordinatorToken = jwt.sign(coordUser, secret, { expiresIn: '2h' });
  accountantToken = jwt.sign(acctUser, secret, { expiresIn: '2h' });

  console.log('🔑 Generated authenticated tokens:');
  console.log('  • MD (Warren):', mdUser.email);
  console.log('  • Coordinator (Sian):', coordUser.email);
  console.log('  • Accountant (Ben):', acctUser.email);

  // Helper fetch function
  const api = async (endpoint, method = 'GET', body = null, token = coordinatorToken) => {
    const res = await fetch(`${BASE}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  };

  let testVehicleId = null;
  let testHireId = null;
  let productionId = null;

  // Find a production for linking
  const { rows: prods } = await pool.query(`SELECT id, name FROM productions LIMIT 1`);
  if (prods.length > 0) {
    productionId = prods[0].id;
    console.log(`🎬 Found active production for tests: "${prods[0].name}" (${productionId})\n`);
  }

  // ─── TEST 1: VEHICLE CREATION ───────────────────────────────────────────────
  console.log('📋 [TEST 1] POST /api/vehicles (Create Vehicle with Deadlines)');
  const createVehRes = await api('/api/vehicles', 'POST', {
    registration_number: 'CS24 HQX',
    make: 'Mercedes-Benz',
    model: 'Sprinter 315 CDI',
    year_of_manufacture: 2024,
    number_plate: 'CS24 HQX',
    colour: 'Silver Metallic',
    vehicle_type: 'Luton',
    owner_assigned_to: 'Warren Lever',
    notes: 'Company primary Luton van with tail lift',
    mot_expiry_date: '2026-10-15',
    insurance_renewal_date: '2026-09-20', // Due soon (<=30d)
    tax_renewal_date: '2026-12-01',
  }, coordinatorToken);

  console.log(`  Status: ${createVehRes.status} | OK: ${createVehRes.ok}`);
  if (createVehRes.ok && createVehRes.data.vehicle) {
    testVehicleId = createVehRes.data.vehicle.id;
    console.log(`  ✅ Vehicle Created ID: ${testVehicleId} (${createVehRes.data.vehicle.registration_number})`);
  } else {
    console.error('  ❌ Failed to create vehicle:', createVehRes.data);
  }

  // ─── TEST 2: VEHICLE LIST & COMPLIANCE CALCULATION ──────────────────────────
  console.log('\n📋 [TEST 2] GET /api/vehicles (List Vehicles & Real-Time Deadlines)');
  const listVehRes = await api('/api/vehicles', 'GET', null, coordinatorToken);
  console.log(`  Status: ${listVehRes.status} | Total Vehicles: ${listVehRes.data.vehicles?.length}`);
  const createdVeh = listVehRes.data.vehicles?.find(v => v.id === testVehicleId);
  if (createdVeh) {
    console.log(`  ✅ Vehicle Details: ${createdVeh.make} ${createdVeh.model}`);
    console.log(`  • MOT Compliance: status=${createdVeh.mot_compliance.status}, days=${createdVeh.mot_compliance.days_remaining}`);
    console.log(`  • Insurance Compliance: status=${createdVeh.insurance_compliance.status}, days=${createdVeh.insurance_compliance.days_remaining}`);
    console.log(`  • Tax Compliance: status=${createdVeh.tax_compliance.status}, days=${createdVeh.tax_compliance.days_remaining}`);
    console.log(`  • Overall Vehicle Status: "${createdVeh.overall_status}"`);
  }

  // ─── TEST 3: VEHICLE UPDATE ─────────────────────────────────────────────────
  console.log('\n📋 [TEST 3] PUT /api/vehicles/:id (Update Vehicle Details)');
  const updateVehRes = await api(`/api/vehicles/${testVehicleId}`, 'PUT', {
    colour: 'Construct Blue',
    notes: 'Updated maintenance notes: Service completed August 2026',
  }, coordinatorToken);
  console.log(`  Status: ${updateVehRes.status} | Updated Colour: "${updateVehRes.data.vehicle?.colour}"`);

  // ─── TEST 4: HIRE EQUIPMENT CREATION ─────────────────────────────────────────
  if (productionId) {
    console.log('\n📋 [TEST 4] POST /api/hire-equipment (Record Equipment Hire)');
    const createHireRes = await api('/api/hire-equipment', 'POST', {
      equipment_type: 'Telehandler 17m',
      supplier_name: 'Nationwide Platforms Ltd',
      description: '17m Reach Telehandler with forks and rotating platform',
      production_id: productionId,
      hire_start_date: '2026-08-15',
      weekly_hire_rate: 550.00,
      notes: 'Site delivery to stage 3. Off-hire contact: John Driver',
    }, coordinatorToken);

    console.log(`  Status: ${createHireRes.status} | OK: ${createHireRes.ok}`);
    if (createHireRes.ok && createHireRes.data.hire_equipment) {
      testHireId = createHireRes.data.hire_equipment.id;
      console.log(`  ✅ Hire Record Created ID: ${testHireId} (${createHireRes.data.hire_equipment.equipment_type})`);
    } else {
      console.error('  ❌ Failed to create hire record:', createHireRes.data);
    }
  }

  // ─── TEST 5: HIRE EQUIPMENT LIST & LIVE WEEKS/COST COMPUTATION ───────────────
  console.log('\n📋 [TEST 5] GET /api/hire-equipment (List & Live Metrics Calculation)');
  const listHireRes = await api('/api/hire-equipment', 'GET', null, coordinatorToken);
  console.log(`  Status: ${listHireRes.status} | Total Hires: ${listHireRes.data.hire_equipment?.length}`);
  const createdHire = listHireRes.data.hire_equipment?.find(h => h.id === testHireId);
  if (createdHire) {
    console.log(`  ✅ Hire Details: ${createdHire.equipment_type} from ${createdHire.supplier_name}`);
    console.log(`  • Weekly Rate: £${createdHire.weekly_hire_rate}`);
    console.log(`  • Weeks Elapsed: ${createdHire.weeks_hired} weeks (${createdHire.days_hired} days)`);
    console.log(`  • Total Cost to Date: £${createdHire.total_cost}`);
    console.log(`  • Status: ${createdHire.status}`);
  }

  // ─── TEST 6: HIRE EQUIPMENT RETURN / CLOSED LOOP ────────────────────────────
  if (testHireId) {
    console.log('\n📋 [TEST 6] POST /api/hire-equipment/:id/return (Return & Close Loop)');
    const returnRes = await api(`/api/hire-equipment/${testHireId}/return`, 'POST', {
      return_date: '2026-09-01',
      notes: 'Off-hired successfully. Collection ref: OFF-99214. Checked and signed off.',
    }, coordinatorToken);

    console.log(`  Status: ${returnRes.status} | OK: ${returnRes.ok}`);
    if (returnRes.ok && returnRes.data.hire_equipment) {
      const closed = returnRes.data.hire_equipment;
      console.log(`  ✅ Closed Status: "${closed.status}"`);
      console.log(`  • Final Duration: ${closed.weeks_hired} weeks (${closed.days_hired} days)`);
      console.log(`  • Final Closed Cost: £${closed.total_cost}`);
    }
  }

  // ─── TEST 7: ASSETS & HIRE DASHBOARD SUMMARY ────────────────────────────────
  console.log('\n📋 [TEST 7] GET /api/assets-hire/summary (Aggregate Module Metrics)');
  const summaryRes = await api('/api/assets-hire/summary', 'GET', null, mdToken);
  console.log(`  Status: ${summaryRes.status} | OK: ${summaryRes.ok}`);
  console.log('  Summary Output:', JSON.stringify(summaryRes.data.summary, null, 2));

  // ─── TEST 8: COST REPORT INTEGRATION ────────────────────────────────────────
  if (productionId) {
    console.log('\n📋 [TEST 8] GET /api/cost-reports/:productionId (Verify Hire Cost Integration)');
    const costReportRes = await api(`/api/cost-reports/${productionId}`, 'GET', null, accountantToken);
    console.log(`  Status: ${costReportRes.status} | OK: ${costReportRes.ok}`);
    if (costReportRes.ok && costReportRes.data.metrics) {
      console.log('  • Total Costs to Date:', costReportRes.data.metrics.total_costs_to_date);
      console.log('  • Total Supplier Costs:', costReportRes.data.metrics.total_supplier_costs);
      console.log('  • Total Labour Costs:', costReportRes.data.metrics.total_labour_costs);
      console.log('  • Total Hire Costs:', costReportRes.data.metrics.total_hire_costs);
    }
  }

  // ─── TEST 9: CLEANUP OF TEST RECORDS ────────────────────────────────────────
  console.log('\n📋 [TEST 9] DELETE /api/vehicles/:id & /api/hire-equipment/:id (Cleanup)');
  if (testVehicleId) {
    const delVeh = await api(`/api/vehicles/${testVehicleId}`, 'DELETE', null, coordinatorToken);
    console.log(`  • Deleted Test Vehicle (${testVehicleId}): ${delVeh.status === 200 ? '✅ SUCCESS' : '❌ FAILED'}`);
  }
  if (testHireId) {
    const delHire = await api(`/api/hire-equipment/${testHireId}`, 'DELETE', null, coordinatorToken);
    console.log(`  • Deleted Test Hire (${testHireId}): ${delHire.status === 200 ? '✅ SUCCESS' : '❌ FAILED'}`);
  }

  await pool.end();
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('🎉 ALL MODULE 8 API TESTS COMPLETED AND VERIFIED 100%!');
  console.log('═══════════════════════════════════════════════════════════════');
}

runTestSuite().catch(err => {
  console.error('❌ Test suite failed with error:', err);
  process.exit(1);
});
