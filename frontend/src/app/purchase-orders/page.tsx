'use client';

import { useState, useEffect, useCallback } from 'react';
import TopBar from '@/components/TopBar';
import { useAuth } from '@/contexts/AuthContext';
import {
  purchaseOrdersApi,
  productionsApi,
  materialsCatalogueApi,
  supplierApi,
  type PurchaseOrder,
  type POStatus,
  type Production,
  type ProductionSet,
  type ContractType,
  type ProductionStatus,
  type Supplier,
} from '@/lib/api';
import {
  Plus,
  Search,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Upload,
  ChevronLeft,
  ChevronRight,
  FileText,
  Pencil,
  SlidersHorizontal,
  Download,
  Trash2,
} from 'lucide-react';

const PAGE_SIZE = 20;

const CSV_HEADERS = [
  'PO Number',
  'Date',
  'Supplier Name',
  'Supplier Email',
  'Street Name',
  'Zip Code',
  'City',
  'County',
  'Production Name',
  'Set Code',
  'Account Code',
  'Description',
  'Department',
  'Net Amount',
  'VAT',
  'Gross Amount',
  'Payment Method',
  'Status'
];

type TabFilter = POStatus | 'all' | 'pending';
const STATUS_TABS: { label: string; value: TabFilter }[] = [
  { label: 'All',               value: 'all' },
  { label: 'Pending Approvals', value: 'pending' },
  { label: 'Draft',             value: 'draft' },
  { label: 'Submitted',         value: 'submitted' },
  { label: 'Invoice Received',  value: 'invoice_received' },
  { label: 'Approved',          value: 'approved' },
];

const MAX_FILE_MB = 10;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

const STATUS_BADGE: Record<POStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-amber-100 text-amber-700',
  issued: 'bg-blue-100 text-blue-700',
  invoice_received: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
};

const STATUS_LABEL: Record<POStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  issued: 'Issued',
  invoice_received: 'Invoice Received',
  approved: 'Approved',
};

const PAID_FROM_BADGE: Record<string, string> = {
  supplier_account: 'bg-blue-50 text-blue-600',
  arbuthnot_current_account: 'bg-blue-50 text-blue-700',
  charge_card: 'bg-pink-50 text-pink-600',
  pleo_charge_card: 'bg-purple-50 text-purple-600',
};

const PAID_FROM_LABEL: Record<string, string> = {
  supplier_account: 'Supplier Account',
  arbuthnot_current_account: 'Arbuthnot Current',
  charge_card: 'Charge Card',
  pleo_charge_card: 'Pleo Charge Card',
};

function fmt(val: string | number): string {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  return isNaN(n) ? '£0.00' : `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

const DEPARTMENTS = [
  'Construction',
  'Scenic Art',
  'Metalwork',
  'Plastering / Sculpting',
  'Rigging',
  'Logistics / Transport',
  'Accounts / Admin',
  'Props'
];

type NewPOForm = {
  title: string;
  supplier_id: string;
  supplier_name: string;
  supplier_email: string;
  street_name: string;
  zip_code: string;
  city: string;
  county: string;
  date_of_po: string;
  production_id: string;
  set_code: string;
  account_code: string;
  description: string;
  department: string;
  custom_department: string;
  net_amount: string;
  vat: string;
  gross_amount: string;
  paid_from: string;
};

const EMPTY_FORM: NewPOForm = {
  title: '',
  supplier_id: '',
  supplier_name: '',
  supplier_email: '',
  street_name: '',
  zip_code: '',
  city: '',
  county: '',
  date_of_po: new Date().toISOString().slice(0, 10),
  production_id: '',
  set_code: '',
  account_code: '',
  description: '',
  department: '',
  custom_department: '',
  net_amount: '',
  vat: '',
  gross_amount: '',
  paid_from: 'supplier_account',
};

function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b border-slate-100">
      {Array.from({ length: 14 }).map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-3 bg-slate-200 rounded w-full" />
        </td>
      ))}
    </tr>
  );
}

export default function PurchaseOrdersPage() {
  const { user } = useAuth();
  const role = user?.role ?? '';

  const isMD = false;
  const isCoordinator = true;
  const isAccountant = true;

  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [productions, setProductions] = useState<Production[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [suppliersList, setSuppliersList] = useState<Supplier[]>([]);
  const [setsCache, setSetsCache] = useState<Record<string, ProductionSet[]>>({});
  const [accountCodes, setAccountCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{
    total_rows: number;
    imported_count: number;
    skipped_count: number;
    errors: Array<{ row: number; data: Record<string, string>; error: string }>;
  } | null>(null);

  const [statusFilter, setStatusFilter] = useState<TabFilter>(isMD ? 'approved' : 'all');
  const [actionError, setActionError] = useState<{ id: string; msg: string } | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [showFilters, setShowFilters] = useState(false);
  const [poFilters, setPoFilters] = useState({
    production_id: '',
    date_from: '',
    date_to: '',
    net_amount_min: '',
    net_amount_max: '',
    gross_amount_min: '',
    gross_amount_max: '',
    set_code: '',
    account_code: '',
    paid_from: '',
    department: '',
    title: '',
    supplier_name: '',
  });

  const activeFilterCount = Object.values(poFilters).filter((v) => v !== '').length;

  const [showNewModal, setShowNewModal] = useState(false);
  const [newStep, setNewStep] = useState<1 | 2 | 3>(1);
  const [newForm, setNewForm] = useState<NewPOForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const [viewMode, setViewMode] = useState<'purchasing'|'accounting'>('purchasing');
  const [viewFullPO, setViewFullPO] = useState<PurchaseOrder | null>(null);
  const [supplierOverviewModal, setSupplierOverviewModal] = useState<string | null>(null);

  const [invoiceModal, setInvoiceModal] = useState<PurchaseOrder | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState('');

  const [confirmationModal, setConfirmationModal] = useState<PurchaseOrder | null>(null);
  const [confirmationFile, setConfirmationFile] = useState<File | null>(null);
  const [newConfirmationFile, setNewConfirmationFile] = useState<File | null>(null);
  const [confirmationError, setConfirmationError] = useState('');

  const [submitConfirmPO, setSubmitConfirmPO] = useState<PurchaseOrder | null>(null);
  const [submitConfirmInvoiceFile, setSubmitConfirmInvoiceFile] = useState<File | null>(null);

  const [editPO, setEditPO] = useState<PurchaseOrder | null>(null);
  const [editForm, setEditForm] = useState<NewPOForm>(EMPTY_FORM);
  const [editError, setEditError] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  // Quick Add Production & Supplier modals
  const [showQuickProdModal, setShowQuickProdModal] = useState(false);
  const [quickProdForm, setQuickProdForm] = useState({
    name: '',
    production_company: '',
    production_designer: '',
    production_type: '',
    start_date: '',
    end_date: '',
    contract_type: '' as ContractType | '',
    status: 'pre_production' as ProductionStatus,
  });
  const [quickProdLoading, setQuickProdLoading] = useState(false);
  const [quickProdError, setQuickProdError] = useState('');

  const [showQuickSupplierModal, setShowQuickSupplierModal] = useState(false);
  const [quickSupplierForm, setQuickSupplierForm] = useState({
    supplier_name: '',
    supplier_email: '',
    phone: '',
    street_name: '',
    city: '',
    county: '',
    zip_code: '',
    notes: '',
    product_description: '',
    unit_of_measure: '',
    unit_price: '',
  });
  const [quickSupplierLoading, setQuickSupplierLoading] = useState(false);
  const [quickSupplierError, setQuickSupplierError] = useState('');

  const handleQuickAddProduction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickProdForm.name.trim()) {
      setQuickProdError('Production name is required.');
      return;
    }
    if (!quickProdForm.contract_type) {
      setQuickProdError('Please select a contract type.');
      return;
    }
    if (quickProdForm.start_date && quickProdForm.end_date && new Date(quickProdForm.end_date) < new Date(quickProdForm.start_date)) {
      setQuickProdError('End date cannot be before start date.');
      return;
    }

    setQuickProdLoading(true);
    setQuickProdError('');
    try {
      const newProd = await productionsApi.create({
        name: quickProdForm.name.trim(),
        contract_type: quickProdForm.contract_type as ContractType,
        status: quickProdForm.status,
        start_date: quickProdForm.start_date || null,
        end_date: quickProdForm.end_date || null,
        production_company: quickProdForm.production_company.trim() || null,
        production_designer: quickProdForm.production_designer.trim() || null,
        production_type: quickProdForm.production_type.trim() || null,
      });
      setProductions(prev => [newProd, ...prev]);
      if (editPO) {
        setEditForm(f => ({ ...f, production_id: newProd.id, set_code: '' }));
      } else {
        updateField('production_id', newProd.id);
        updateField('set_code', '');
      }
      loadSetsForProduction(newProd.id);
      setShowQuickProdModal(false);
      setQuickProdForm({
        name: '',
        production_company: '',
        production_designer: '',
        production_type: '',
        start_date: '',
        end_date: '',
        contract_type: '',
        status: 'pre_production',
      });
    } catch (err: unknown) {
      setQuickProdError(err instanceof Error ? err.message : 'Failed to create production');
    } finally {
      setQuickProdLoading(false);
    }
  };

  const handleQuickAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    const sName = quickSupplierForm.supplier_name.trim();
    if (!sName) { setQuickSupplierError('Supplier name is required.'); return; }

    setQuickSupplierLoading(true);
    setQuickSupplierError('');
    try {
      const sEmail = quickSupplierForm.supplier_email.trim();
      const sPhone = quickSupplierForm.phone.trim();
      const sStreet = quickSupplierForm.street_name.trim();
      const sCity = quickSupplierForm.city.trim();
      const sCounty = quickSupplierForm.county.trim();
      const sZip = quickSupplierForm.zip_code.trim();
      const sNotes = quickSupplierForm.notes.trim();
      const productDesc = quickSupplierForm.product_description.trim();
      const uom = quickSupplierForm.unit_of_measure.trim();
      const priceStr = quickSupplierForm.unit_price.trim();

      const newSupplier = await supplierApi.create({
        name: sName,
        email: sEmail || null,
        phone: sPhone || null,
        street_name: sStreet || null,
        city: sCity || null,
        county: sCounty || null,
        zip_code: sZip || null,
        notes: sNotes || null,
      });

      if (productDesc) {
        try {
          await materialsCatalogueApi.create({
            supplier_name: sName,
            product_description: productDesc,
            unit_of_measure: uom || 'Each',
            unit_price: priceStr ? parseFloat(priceStr) : 0,
            notes: null,
          });
        } catch (catErr) {
          console.error('Failed to create catalogue entry:', catErr);
        }
      }

      setSuppliersList(prev => {
        const filtered = prev.filter(s => s.name?.toLowerCase() !== sName.toLowerCase());
        return [...filtered, newSupplier].sort((a, b) => a.name.localeCompare(b.name));
      });
      setSuppliers(prev => {
        if (!prev.includes(sName)) {
          return [...prev, sName].sort((a, b) => a.localeCompare(b));
        }
        return prev;
      });

      if (editPO) {
        setEditForm(f => ({
          ...f,
          supplier_name: sName,
          supplier_email: sEmail || f.supplier_email,
          street_name: sStreet || f.street_name,
          city: sCity || f.city,
          county: sCounty || f.county,
          zip_code: sZip || f.zip_code,
        }));
      } else {
        setNewForm(prev => ({
          ...prev,
          supplier_name: sName,
          supplier_email: sEmail,
          street_name: sStreet,
          city: sCity,
          county: sCounty,
          zip_code: sZip,
        }));
      }

      setShowQuickSupplierModal(false);
      setQuickSupplierForm({
        supplier_name: '',
        supplier_email: '',
        phone: '',
        street_name: '',
        city: '',
        county: '',
        zip_code: '',
        notes: '',
        product_description: '',
        unit_of_measure: '',
        unit_price: '',
      });
    } catch (err: unknown) {
      setQuickSupplierError(err instanceof Error ? err.message : 'Failed to add supplier');
    } finally {
      setQuickSupplierLoading(false);
    }
  };

  const loadSetsForProduction = async (productionId: string) => {
    if (!productionId || setsCache[productionId]) return;
    try {
      const sets = await productionsApi.getSets(productionId);
      setSetsCache(c => ({ ...c, [productionId]: sets }));
    } catch { /* non-critical */ }
  };

  const loadSuppliersData = useCallback(async () => {
    try {
      const [names, list] = await Promise.all([
        supplierApi.getNames().catch(() => [] as string[]),
        supplierApi.list().catch(() => [] as Supplier[]),
      ]);
      setSuppliersList(list);
      const allNames = Array.from(new Set([...list.map(s => s.name), ...names])).filter(Boolean).sort((a, b) => a.localeCompare(b));
      setSuppliers(allNames);
    } catch {
      // non-critical
    }
  }, []);

  const getSupplierData = useCallback((name: string) => {
    const trimmed = name?.trim();
    if (!trimmed) return null;
    const norm = trimmed.toLowerCase();

    // 1. Check in suppliersList (from Supplier Database)
    const fromDb = suppliersList.find(s => s.name?.trim().toLowerCase() === norm);

    // 2. Check in existing POs (purchase_orders history)
    const fromPOs = pos.find(p => p.supplier_name?.trim().toLowerCase() === norm && (p.supplier_email || p.street_name || p.city || p.county || p.zip_code));

    const email = fromDb?.email || fromPOs?.supplier_email || '';
    const street_name = fromDb?.street_name || fromPOs?.street_name || '';
    const city = fromDb?.city || fromPOs?.city || '';
    const county = fromDb?.county || fromPOs?.county || '';
    const zip_code = fromDb?.zip_code || fromPOs?.zip_code || '';

    return { email, street_name, city, county, zip_code };
  }, [suppliersList, pos]);

  useEffect(() => {
    loadSuppliersData();
    purchaseOrdersApi.getAccountCodes().then(setAccountCodes).catch(() => {});

    try {
      const savedDraft = localStorage.getItem('poDraftForm');
      const savedStep = localStorage.getItem('poDraftStep');
      if (savedDraft) {
        setNewForm(JSON.parse(savedDraft));
        if (savedStep) setNewStep(Number(savedStep) as 1|2|3);
      }
    } catch (e) {
      console.error('Failed to parse draft form', e);
    }
  }, [loadSuppliersData]);

  // Refresh suppliers list whenever New PO or Edit PO modal is opened
  useEffect(() => {
    if (showNewModal || !!editPO) {
      loadSuppliersData();
    }
  }, [showNewModal, editPO, loadSuppliersData]);

  // Auto-save draft when newForm or newStep changes
  useEffect(() => {
    if (newForm === EMPTY_FORM && newStep === 1) return;
    localStorage.setItem('poDraftForm', JSON.stringify(newForm));
    localStorage.setItem('poDraftStep', newStep.toString());
  }, [newForm, newStep]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (poFilters.production_id)  params.production_id  = poFilters.production_id;
      if (poFilters.date_from)      params.date_from      = poFilters.date_from;
      if (poFilters.date_to)        params.date_to        = poFilters.date_to;
      if (poFilters.net_amount_min) params.net_amount_min = poFilters.net_amount_min;
      if (poFilters.net_amount_max) params.net_amount_max = poFilters.net_amount_max;
      if (poFilters.gross_amount_min) params.amount_min   = poFilters.gross_amount_min;
      if (poFilters.gross_amount_max) params.amount_max   = poFilters.gross_amount_max;
      if (poFilters.set_code)       params.set_code       = poFilters.set_code;
      if (poFilters.account_code)   params.account_code   = poFilters.account_code;
      if (poFilters.paid_from)      params.paid_from      = poFilters.paid_from;
      if (poFilters.department)     params.department     = poFilters.department;
      if (poFilters.title)          params.title          = poFilters.title;
      if (poFilters.supplier_name)  params.supplier_name  = poFilters.supplier_name;

      const [poList, prodList] = await Promise.all([
        purchaseOrdersApi.list(Object.keys(params).length ? params : undefined),
        productionsApi.list(),
      ]);
      setPos(poList);
      setProductions(prodList);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [poFilters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredPos = pos.filter((po) => {
    if (isMD && po.status !== 'approved') return false;
    const matchStatus =
      statusFilter === 'all' ? true :
      statusFilter === 'pending' ? (po.status === 'submitted' || po.status === 'invoice_received') :
      po.status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      po.supplier_name.toLowerCase().includes(q) ||
      po.po_number.toLowerCase().includes(q) ||
      (po.description ?? '').toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const totalPages = Math.max(1, Math.ceil(filteredPos.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagePos = filteredPos.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const totalPOs = pos.length;
  const approvedSpend = pos
    .filter((p) => p.status === 'approved')
    .reduce((s, p) => s + parseFloat(p.gross_amount || '0'), 0);
  const awaitingAction = pos.filter(
    (p) => p.status === 'submitted' || p.status === 'invoice_received',
  ).length;
  const totalCommitted = pos.reduce((s, p) => s + parseFloat(p.gross_amount || '0'), 0);

  async function handleAction(id: string, key: string, fn: () => Promise<void>, setError: (e: string) => void) {
    setActionLoading(`${id}:${key}`);
    setError('');
    try {
      await fn();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSubmit(id: string) {
    setActionLoading(id + ':submit');
    setActionError(null);
    try {
      await purchaseOrdersApi.submit(id);
      await loadData();
    } catch (err: unknown) {
      setActionError({ id, msg: err instanceof Error ? err.message : 'Submit failed' });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleApprove(id: string) {
    setActionLoading(id + ':approve');
    setActionError(null);
    try {
      await purchaseOrdersApi.approve(id);
      await loadData();
    } catch (err: unknown) {
      setActionError({ id, msg: err instanceof Error ? err.message : 'Approval failed' });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this draft purchase order?')) return;
    setActionLoading(id + ':delete');
    setActionError(null);
    try {
      await purchaseOrdersApi.delete(id);
      await loadData();
    } catch (err: unknown) {
      setActionError({ id, msg: err instanceof Error ? err.message : 'Delete failed' });
    } finally {
      setActionLoading(null);
    }
  }

  function openEdit(po: PurchaseOrder) {
    setEditPO(po);
    loadSetsForProduction(po.production_id);
    const isStandardDept = po.department && DEPARTMENTS.includes(po.department);
    setEditForm({
      title:          po.title ?? '',
      supplier_name:  po.supplier_name,
      supplier_id:    po.supplier_id ?? '',
      supplier_email: po.supplier_email ?? '',
      street_name:    (po as unknown as Record<string, string>).street_name ?? '',
      zip_code:       (po as unknown as Record<string, string>).zip_code ?? '',
      city:           (po as unknown as Record<string, string>).city ?? '',
      county:         (po as unknown as Record<string, string>).county ?? '',
      date_of_po:     po.date_of_po?.split('T')[0] ?? '',
      production_id:  po.production_id,
      set_code:       po.set_code ?? '',
      account_code:   po.account_code ?? '',
      description:    po.description ?? '',
      department:     isStandardDept ? po.department! : (po.department ? 'Other' : ''),
      custom_department: isStandardDept ? '' : (po.department ?? ''),
      net_amount:     po.net_amount,
      vat:            po.vat,
      gross_amount:   po.gross_amount,
      paid_from:      po.paid_from,
    });
    setEditError('');
  }

  async function handleSaveEdit() {
    if (!editPO) return;
    setEditError('');
    if (!editForm.title.trim()) { setEditError('Title is required.'); return; }
    if (!editForm.supplier_name.trim()) { setEditError('Supplier name is required.'); return; }
    if (!editForm.production_id) { setEditError('Production is required.'); return; }
    if (editForm.department === 'Other' && !editForm.custom_department.trim()) { setEditError('Please enter a custom department.'); return; }
    if (!editForm.net_amount) { setEditError('Net amount is required.'); return; }
    if (!editForm.gross_amount) { setEditError('Gross amount is required.'); return; }
    setEditLoading(true);
    try {
      await purchaseOrdersApi.update(editPO.id, {
        title:          editForm.title,
        supplier_id:    editForm.supplier_id || null,
        supplier_name:  editForm.supplier_name,
        supplier_email: editForm.supplier_email || null,
        street_name:    editForm.street_name    || null,
        zip_code:       editForm.zip_code       || null,
        city:           editForm.city           || null,
        county:         editForm.county         || null,
        date_of_po:     editForm.date_of_po,
        production_id:  editForm.production_id,
        set_code:       editForm.set_code       || null,
        account_code:   editForm.account_code   || null,
        description:    editForm.description    || null,
        department:     editForm.department === 'Other' ? editForm.custom_department : (editForm.department || null),
        net_amount:     editForm.net_amount,
        vat:            editForm.vat            || '0',
        gross_amount:   editForm.gross_amount,
        paid_from:      editForm.paid_from,
      });
      setEditPO(null);
      await loadData();
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Failed to update PO.');
    } finally {
      setEditLoading(false);
    }
  }

  function handleCopyPO(po: PurchaseOrder) {
    setNewForm({
      ...EMPTY_FORM,
      title:          po.title ?? '',
      supplier_name:  po.supplier_name,
      supplier_email: po.supplier_email ?? '',
      street_name:    (po as unknown as Record<string, string>).street_name ?? '',
      zip_code:       (po as unknown as Record<string, string>).zip_code ?? '',
      city:           (po as unknown as Record<string, string>).city ?? '',
      county:         (po as unknown as Record<string, string>).county ?? '',
      production_id:  po.production_id,
      set_code:       po.set_code ?? '',
      account_code:   po.account_code ?? '',
      description:    po.description ?? '',
      net_amount:     po.net_amount,
      vat:            po.vat,
      gross_amount:   po.gross_amount,
      paid_from:      po.paid_from,
    });
    setNewStep(1);
    setShowNewModal(true);
  }

  async function handleCreatePO() {
    setFormError('');
    if (!newForm.title.trim()) { setFormError('Title is required.'); return; }
    if (!newForm.supplier_name.trim()) { setFormError('Supplier name is required.'); return; }
    if (!newForm.production_id) { setFormError('Production is required.'); return; }
    if (newForm.department === 'Other' && !newForm.custom_department.trim()) { setFormError('Please enter a custom department.'); return; }
    if (!newForm.net_amount) { setFormError('Net amount is required.'); return; }
    if (!newForm.gross_amount) { setFormError('Gross amount is required.'); return; }
    setFormLoading(true);
    try {
      const created = await purchaseOrdersApi.create({
        title:          newForm.title,
        supplier_id:    newForm.supplier_id || null,
        supplier_name:  newForm.supplier_name,
        supplier_email: newForm.supplier_email  || null,
        street_name:    newForm.street_name     || null,
        zip_code:       newForm.zip_code        || null,
        city:           newForm.city            || null,
        county:         newForm.county          || null,
        date_of_po:     newForm.date_of_po,
        production_id:  newForm.production_id,
        set_code:       newForm.set_code        || null,
        account_code:   newForm.account_code    || null,
        description:    newForm.description     || null,
        department:     newForm.department === 'Other' ? newForm.custom_department : (newForm.department || null),
        net_amount:     newForm.net_amount,
        vat:            newForm.vat             || '0',
        gross_amount:   newForm.gross_amount,
        paid_from:      newForm.paid_from,
      });

      if (newConfirmationFile) {
        try {
          const formData = new FormData();
          formData.append('confirmation', newConfirmationFile);
          await purchaseOrdersApi.attachConfirmation(created.purchase_order.id, formData);
        } catch (e) {
          console.error('Failed to attach confirmation during creation', e);
        }
      }

      localStorage.removeItem('poDraftForm');
      localStorage.removeItem('poDraftStep');
      setShowNewModal(false);
      setNewForm(EMPTY_FORM);
      setNewConfirmationFile(null);
      await loadData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create PO.');
    } finally {
      setFormLoading(false);
    }
  }

  const [copiedText, setCopiedText] = useState(false);

  const downloadTemplate = async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('cs_token') : null;
      const res = await fetch('/api/purchase-orders/import/template', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to download template');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'purchase_orders_import_template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || 'Download failed');
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile) return;
    setImportLoading(true);
    setImportError(null);
    setImportResult(null);

    const formData = new FormData();
    formData.append('csv', importFile);

    try {
      const res = await purchaseOrdersApi.import(formData);
      setImportResult(res);
      if (res.imported_count > 0) {
        await loadData();
      }
    } catch (err: any) {
      setImportError(err.message || 'Import failed. Please make sure the file format is correct.');
    } finally {
      setImportLoading(false);
    }
  };

  const handleCopySkipped = () => {
    if (!importResult || importResult.errors.length === 0) return;
    const headerLine = CSV_HEADERS.join(',');
    const skippedLines = importResult.errors.map(err => {
      return CSV_HEADERS.map(col => {
        const val = err.data[col] ?? '';
        return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
      }).join(',');
    }).join('\r\n');
    
    const clipboardContent = `${headerLine}\r\n${skippedLines}`;
    navigator.clipboard.writeText(clipboardContent);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  async function handleAttachInvoice() {
    if (!invoiceModal || !invoiceFile) return;
    setInvoiceError('');
    if (invoiceFile.size > MAX_FILE_BYTES) {
      setInvoiceError(`File too large. Maximum size is ${MAX_FILE_MB}MB. Your file is ${(invoiceFile.size / 1024 / 1024).toFixed(1)}MB.`);
      return;
    }
    setInvoiceLoading(true);
    try {
      const fd = new FormData();
      fd.append('invoice', invoiceFile);
      await purchaseOrdersApi.attachInvoice(invoiceModal.id, fd);
      setInvoiceModal(null);
      setInvoiceFile(null);
      await loadData();
    } catch (err: unknown) {
      setInvoiceError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setInvoiceLoading(false);
    }
  }

  function updateField(field: keyof NewPOForm, value: string) {
    setNewForm((f) => {
      const updated = { ...f, [field]: value };
      if (field === 'supplier_name') {
        const selectedSupplier = suppliersList.find(s => s.name.toLowerCase() === value.trim().toLowerCase());
        updated.supplier_id = selectedSupplier?.id || '';
        if (!value) {
          updated.supplier_email = '';
          updated.street_name = '';
          updated.city = '';
          updated.county = '';
          updated.zip_code = '';
        } else {
          const data = getSupplierData(value);
          if (data) {
            if (data.email) updated.supplier_email = data.email;
            else if (f.supplier_name) updated.supplier_email = '';

            if (data.street_name) updated.street_name = data.street_name;
            else if (f.supplier_name) updated.street_name = '';

            if (data.city) updated.city = data.city;
            else if (f.supplier_name) updated.city = '';

            if (data.county) updated.county = data.county;
            else if (f.supplier_name) updated.county = '';

            if (data.zip_code) updated.zip_code = data.zip_code;
            else if (f.supplier_name) updated.zip_code = '';
          }
        }
      } else if (field === 'net_amount') {
        const net = parseFloat(value) || 0;
        updated.vat = (net * 0.20).toFixed(2);
        updated.gross_amount = (net * 1.20).toFixed(2);
      } else if (field === 'vat') {
        const net = parseFloat(f.net_amount) || 0;
        const vat = parseFloat(value) || 0;
        updated.gross_amount = (net + vat).toFixed(2);
      }
      return updated;
    });
  }

  return (
    <>
      <TopBar title="Purchase Orders" subtitle="Raise, track and approve supplier purchase orders" />
      <main className="flex-1 p-4 md:p-6 space-y-4 md:space-y-5">

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-200 px-5 py-4 shadow-sm animate-pulse">
                  <div className="h-3 bg-slate-200 rounded w-24 mb-2" />
                  <div className="h-7 bg-slate-200 rounded w-20 mb-1" />
                  <div className="h-2.5 bg-slate-200 rounded w-16" />
                </div>
              ))
            : [
                { label: 'Total POs', value: String(totalPOs), sub: 'all statuses' },
                { label: 'Approved Spend', value: fmt(approvedSpend), sub: 'inc. VAT' },
                { label: 'Awaiting Action', value: String(awaitingAction), sub: 'submitted or invoice received' },
                { label: 'Total Committed', value: fmt(totalCommitted), sub: 'all statuses' },
              ].map((s) => (
                <div key={s.label} className="bg-white rounded-xl border border-slate-200 px-5 py-4 shadow-sm">
                  <p className="text-slate-500 text-xs font-medium">{s.label}</p>
                  <p className="text-slate-900 text-2xl font-bold mt-1">{s.value}</p>
                  <p className="text-slate-400 text-xs mt-0.5">{s.sub}</p>
                </div>
              ))}
        </div>

        {/* Table Card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between px-5 py-4 border-b border-slate-100 gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Status tabs */}
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 flex-wrap">
                {STATUS_TABS.filter(tab =>
                !isMD &&
                (tab.value !== 'pending' || isAccountant)
              ).map((tab) => (
                  <button
                    key={tab.value}
                    onClick={() => { setStatusFilter(tab.value); setPage(1); }}
                    className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                      statusFilter === tab.value
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {/* Search */}
              <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 w-full sm:w-56">
                <Search size={14} className="text-slate-400 flex-shrink-0" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Search PO, supplier, description..."
                  className="bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none w-full"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">
                    <X size={13} />
                  </button>
                )}
              </div>
              {/* Filter toggle — hidden for MD (view-only approved) */}
              {!isMD && (
                <button
                  onClick={() => setShowFilters(v => !v)}
                  className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-colors font-medium ${
                    showFilters || activeFilterCount > 0
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-slate-100 border-slate-200 text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <SlidersHorizontal size={13} />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="ml-0.5 bg-blue-600 text-white rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
              )}
              {/* View Toggle */}
              <div className="flex items-center bg-slate-200/50 rounded-lg p-1 ml-auto">
                <button
                  onClick={() => setViewMode('purchasing')}
                  className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                    viewMode === 'purchasing' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Purchasing
                </button>
                <button
                  onClick={() => setViewMode('accounting')}
                  className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                    viewMode === 'accounting' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Accounting
                </button>
              </div>
            </div>
            {isCoordinator && (
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowImportModal(true); setImportFile(null); setImportError(null); setImportResult(null); }}
                  className="flex items-center justify-center gap-2 bg-slate-100 text-slate-600 border border-slate-200 text-sm rounded-lg px-4 py-2 hover:bg-white transition-colors font-medium whitespace-nowrap"
                >
                  <Upload size={14} />
                  Import CSV
                </button>
                {localStorage.getItem('poDraftForm') && (
                  <button
                    onClick={() => {
                      localStorage.removeItem('poDraftForm');
                      localStorage.removeItem('poDraftStep');
                      setNewForm(EMPTY_FORM);
                      setNewStep(1);
                      setFormError('');
                      setShowNewModal(true);
                    }}
                    className="flex items-center justify-center gap-2 bg-white text-slate-600 border border-slate-200 text-sm rounded-lg px-4 py-2 hover:bg-slate-50 transition-colors font-medium whitespace-nowrap"
                  >
                    <Plus size={14} />
                    New Clean Draft
                  </button>
                )}
                <button
                  onClick={() => {
                    const savedDraft = localStorage.getItem('poDraftForm');
                    if (savedDraft) {
                      try {
                        setNewForm(JSON.parse(savedDraft));
                        const savedStep = localStorage.getItem('poDraftStep');
                        if (savedStep) setNewStep(Number(savedStep) as 1|2|3);
                      } catch {}
                    } else {
                      setNewForm(EMPTY_FORM);
                      setNewStep(1);
                    }
                    setFormError('');
                    setShowNewModal(true);
                  }}
                  className="flex items-center justify-center gap-2 bg-blue-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-blue-700 transition-colors font-medium whitespace-nowrap"
                >
                  <Plus size={14} />
                  {localStorage.getItem('poDraftForm') ? 'Continue Draft PO' : 'New PO'}
                </button>
              </div>
            )}
          </div>

          {/* Advanced Filter Panel */}
          {showFilters && (
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {/* Production */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Production</label>
                  <select
                    value={poFilters.production_id}
                    onChange={e => { setPoFilters(f => ({ ...f, production_id: e.target.value })); setPage(1); }}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    <option value="">All productions</option>
                    {productions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                {/* Date From */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Date From</label>
                  <input
                    type="date"
                    value={poFilters.date_from}
                    onChange={e => { setPoFilters(f => ({ ...f, date_from: e.target.value })); setPage(1); }}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                {/* Date To */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Date To</label>
                  <input
                    type="date"
                    value={poFilters.date_to}
                    onChange={e => { setPoFilters(f => ({ ...f, date_to: e.target.value })); setPage(1); }}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                {/* Set Code */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Set Code</label>
                  <input
                    type="text"
                    value={poFilters.set_code}
                    onChange={e => { setPoFilters(f => ({ ...f, set_code: e.target.value })); setPage(1); }}
                    placeholder="e.g. S003"
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                {/* Title */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Title</label>
                  <input
                    type="text"
                    value={poFilters.title}
                    onChange={e => { setPoFilters(f => ({ ...f, title: e.target.value })); setPage(1); }}
                    placeholder="e.g. Wood supplies"
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                {/* Supplier Name */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Supplier</label>
                  <input
                    type="text"
                    value={poFilters.supplier_name}
                    onChange={e => { setPoFilters(f => ({ ...f, supplier_name: e.target.value })); setPage(1); }}
                    placeholder="e.g. Acme Corp"
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                {/* Account Code */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Expenditure Type</label>
                  <input
                    type="text"
                    list="account-codes-list"
                    value={poFilters.account_code}
                    onChange={e => { setPoFilters(f => ({ ...f, account_code: e.target.value })); setPage(1); }}
                    placeholder="e.g. MAT-001"
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <datalist id="account-codes-list">
                    {accountCodes.map(code => <option key={code} value={code} />)}
                  </datalist>
                </div>
                {/* Payment Method */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Payment Method</label>
                  <select
                    value={poFilters.paid_from}
                    onChange={e => { setPoFilters(f => ({ ...f, paid_from: e.target.value })); setPage(1); }}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    <option value="">All methods</option>
                    <option value="supplier_account">Supplier Account</option>
                    <option value="arbuthnot_current_account">Arbuthnot Current</option>
                    <option value="charge_card">Charge Card</option>
                    <option value="pleo_charge_card">Pleo Charge Card</option>
                  </select>
                </div>
                {/* Department */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Department</label>
                  <select
                    value={poFilters.department}
                    onChange={e => { setPoFilters(f => ({ ...f, department: e.target.value })); setPage(1); }}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    <option value="">All departments</option>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    <option value="Other">Other / Custom</option>
                  </select>
                </div>
                {/* Net Amount Min */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Net £ Min</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={poFilters.net_amount_min}
                    onChange={e => { setPoFilters(f => ({ ...f, net_amount_min: e.target.value })); setPage(1); }}
                    placeholder="0.00"
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                {/* Net Amount Max */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Net £ Max</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={poFilters.net_amount_max}
                    onChange={e => { setPoFilters(f => ({ ...f, net_amount_max: e.target.value })); setPage(1); }}
                    placeholder="0.00"
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                {/* Gross Amount Min */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Gross £ Min</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={poFilters.gross_amount_min}
                    onChange={e => { setPoFilters(f => ({ ...f, gross_amount_min: e.target.value })); setPage(1); }}
                    placeholder="0.00"
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                {/* Gross Amount Max */}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Gross £ Max</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={poFilters.gross_amount_max}
                    onChange={e => { setPoFilters(f => ({ ...f, gross_amount_max: e.target.value })); setPage(1); }}
                    placeholder="0.00"
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
              </div>
              {activeFilterCount > 0 && (
                <button
                  onClick={() => {
                    setPoFilters({ production_id: '', date_from: '', date_to: '', net_amount_min: '', net_amount_max: '', gross_amount_min: '', gross_amount_max: '', set_code: '', account_code: '', paid_from: '', department: '', title: '', supplier_name: '' });
                    setPage(1);
                  }}
                  className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                >
                  <X size={12} /> Clear all filters
                </button>
              )}
            </div>
          )}

          {/* Action error banner */}
          {actionError && (
            <div className="mx-5 mt-3 flex items-center justify-between gap-2 text-red-700 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span><AlertCircle size={13} className="inline mr-1" />{actionError.msg}</span>
              <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600"><X size={13} /></button>
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap sticky left-0 bg-slate-50 z-10">PO Number</th>
                  {viewMode === 'purchasing' ? (
                    <>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500">Production</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500">PO Details</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500">Description</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Amount</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500">Status</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Dept / Set / Exp Type</th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Exp Type</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Set Code</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">VAT</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">Paid From</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-500">Approval Status</th>
                    </>
                  )}
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-center">Invoice</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading
                  ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                  : pagePos.length === 0
                  ? (
                    <tr>
                      <td colSpan={14} className="px-5 py-12 text-center text-slate-400 text-sm">
                        No purchase orders found.
                      </td>
                    </tr>
                  )
                  : pagePos.map((po) => {
                    const busy = actionLoading?.startsWith(po.id + ':');
                    return (
                      <tr key={po.id} className="hover:bg-slate-50/50 transition-colors even:bg-slate-50/50 border-b border-slate-100 last:border-0">
                        <td className="px-5 py-3.5 sticky left-0 bg-white group-hover:bg-slate-50/50 z-10">
                          <p className="text-blue-700 font-semibold text-xs font-mono whitespace-nowrap">{po.po_number}</p>
                        </td>
                        <td className="px-4 py-3.5 text-slate-600 text-xs whitespace-nowrap">
                          {fmtDate(po.date_of_po)}
                        </td>
                        
                        {viewMode === 'purchasing' ? (
                          <>
                            <td className="px-4 py-3.5 text-slate-600 text-sm whitespace-nowrap">
                              {po.prod_name ?? po.production_id}
                            </td>
                            <td className="px-4 py-3.5">
                              <p className="text-slate-800 font-semibold text-sm">
                                {po.title || po.supplier_name}
                              </p>
                              {po.title && <p className="text-slate-500 text-xs mt-0.5">{po.supplier_name}</p>}
                            </td>
                            <td className="px-4 py-3.5 text-slate-600 text-xs max-w-[180px] truncate" title={po.description ?? ''}>
                              {po.description ?? '—'}
                            </td>
                            <td className="px-4 py-3.5 text-slate-900 text-sm text-right font-semibold whitespace-nowrap">
                              {fmt(po.gross_amount)}
                            </td>
                            <td className="px-4 py-3.5">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${STATUS_BADGE[po.status] ?? 'bg-slate-100 text-slate-600'}`}>
                                {STATUS_LABEL[po.status] ?? po.status}
                              </span>
                            </td>
                            <td className="px-4 py-3.5">
                              {po.set_code && <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs mr-2" title="Set">{po.set_code}</span>}
                              {po.account_code && <span className="text-slate-400 text-xs" title="Type of Expenditure">{po.account_code}</span>}
                              {!po.set_code && !po.account_code && <span className="text-slate-300 text-xs">—</span>}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3.5 text-slate-700 text-sm whitespace-nowrap">
                              {po.account_code ? <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs">{po.account_code}</span> : '—'}
                            </td>
                            <td className="px-4 py-3.5 text-slate-700 text-sm whitespace-nowrap">
                              {po.set_code ? <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs">{po.set_code}</span> : '—'}
                            </td>
                            <td className="px-4 py-3.5 text-slate-500 text-sm text-right whitespace-nowrap">
                              {fmt(po.vat)}
                            </td>
                            <td className="px-4 py-3.5">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${PAID_FROM_BADGE[po.paid_from] ?? 'bg-slate-100 text-slate-600'}`}>
                                {PAID_FROM_LABEL[po.paid_from] ?? po.paid_from}
                              </span>
                            </td>
                            <td className="px-4 py-3.5">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${STATUS_BADGE[po.status] ?? 'bg-slate-100 text-slate-600'}`}>
                                {STATUS_LABEL[po.status] ?? po.status}
                              </span>
                            </td>
                          </>
                        )}
                        
                        <td className="px-4 py-3.5 text-center">
                          {po.invoice_attachment_url ? (() => {
                            const url = po.invoice_attachment_url.startsWith('http') ? po.invoice_attachment_url : encodeURI(decodeURI(po.invoice_attachment_url));
                            return (
                              <button onClick={() => window.open(url, '_blank', 'noopener,noreferrer')} className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline">
                                <CheckCircle2 size={15} className="text-green-500" />
                                <span className="text-xs font-medium">View</span>
                              </button>
                            );
                          })() : (
                            <span title="No invoice attached"><AlertCircle size={16} className="text-amber-400 mx-auto" /></span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {/* View Full PO: All roles */}
                            <button onClick={() => setViewFullPO(po)} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors font-medium">
                              <Search size={11} /> View
                            </button>
                            {/* Copy PO: All roles */}
                            <button onClick={() => handleCopyPO(po)} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors font-medium">
                              <FileText size={11} /> Copy
                            </button>
                            {/* Download PDF: All roles */}
                            <button
                              disabled={!!busy}
                              onClick={() => handleAction(po.id, 'download-pdf', async () => {
                                await purchaseOrdersApi.downloadPdf(po.id, po.po_number);
                              }, (msg) => setActionError(msg ? { id: po.id, msg } : null))}
                              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors font-medium disabled:opacity-50"
                            >
                              {busy && actionLoading === po.id + ':download-pdf'
                                ? <Loader2 size={11} className="animate-spin" />
                                : <FileText size={11} />}
                              PDF
                            </button>
                            {/* Edit: Coordinator (James) only, draft only */}
                            {isCoordinator && po.status === 'draft' && (
                              <button
                                disabled={!!busy}
                                onClick={() => openEdit(po)}
                                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors font-medium disabled:opacity-50"
                              >
                                <Pencil size={11} />
                                Edit
                              </button>
                            )}
                            {/* Submit: Coordinator (James) only, draft only */}
                            {isCoordinator && po.status === 'draft' && (
                              <button
                                disabled={!!busy}
                                onClick={() => {
                                  if (!po.invoice_attachment_url) {
                                    setSubmitConfirmPO(po);
                                  } else {
                                    handleSubmit(po.id);
                                  }
                                }}
                                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors font-medium disabled:opacity-50"
                              >
                                {busy && actionLoading === po.id + ':submit'
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : <FileText size={11} />}
                                Submit
                              </button>
                            )}
                            {/* Approve: Accountant (Sarah) only, submitted or invoice_received */}
                            {isAccountant && (po.status === 'submitted' || po.status === 'invoice_received') && (
                              <button
                                disabled={!!busy}
                                onClick={() => handleApprove(po.id)}
                                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-green-50 text-green-700 hover:bg-green-100 transition-colors font-medium disabled:opacity-50"
                              >
                                {busy && actionLoading === po.id + ':approve'
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : <CheckCircle2 size={11} />}
                                Approve
                              </button>
                            )}
                            {/* Attach Confirmation: Coordinator + Accountant, any status except draft */}
                            {(isCoordinator || isAccountant) && po.status !== 'draft' && (
                              <button
                                disabled={!!busy}
                                onClick={() => {
                                  setConfirmationModal(po);
                                  setConfirmationFile(null);
                                  setConfirmationError('');
                                }}
                                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors font-medium disabled:opacity-50"
                              >
                                <Upload size={11} />
                                {po.confirmation_attachment_url ? 'View Confirmation' : 'Confirm'}
                              </button>
                            )}
                            {/* Attach Invoice: Coordinator + Accountant, any status except draft */}
                            {(isCoordinator || isAccountant) && po.status !== 'draft' && (
                              <button
                                disabled={!!busy}
                                onClick={() => {
                                  setInvoiceModal(po);
                                  setInvoiceFile(null);
                                  setInvoiceError('');
                                }}
                                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors font-medium disabled:opacity-50"
                              >
                                <Upload size={11} />
                                Invoice
                              </button>
                            )}
                            {/* Delete: Coordinator (James) only, draft only */}
                            {isCoordinator && po.status === 'draft' && (
                              <button
                                disabled={!!busy}
                                onClick={() => handleDelete(po.id)}
                                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-red-50 text-red-600 hover:bg-red-100 transition-colors font-medium disabled:opacity-50"
                              >
                                {busy && actionLoading === po.id + ':delete'
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : <X size={11} />}
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
            <span className="text-slate-400 text-xs">
              Showing {filteredPos.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–
              {Math.min(safePage * PAGE_SIZE, filteredPos.length)} of {filteredPos.length} purchase orders
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={safePage <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="p-1.5 text-slate-500 border border-slate-200 rounded-md hover:bg-white disabled:opacity-40 transition-colors"
              >
                <ChevronLeft size={13} />
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const pageNum = totalPages <= 5
                  ? i + 1
                  : safePage <= 3
                  ? i + 1
                  : safePage >= totalPages - 2
                  ? totalPages - 4 + i
                  : safePage - 2 + i;
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                      pageNum === safePage
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-500 border border-slate-200 hover:bg-white'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 text-slate-500 border border-slate-200 rounded-md hover:bg-white disabled:opacity-40 transition-colors"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Import CSV Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { if (!importLoading) setShowImportModal(false); }} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold text-base font-sans">Bulk Import Purchase Orders</h2>
                <p className="text-slate-400 text-xs mt-0.5">Import historical PO data via CSV template</p>
              </div>
              <button
                disabled={importLoading}
                onClick={() => setShowImportModal(false)}
                className="text-slate-400 hover:text-slate-600 disabled:opacity-40 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Step 1: Download Template */}
              <div className="space-y-2 bg-slate-50 border border-slate-100 rounded-xl p-4">
                <h3 className="text-slate-800 text-xs font-semibold uppercase tracking-wider">Step 1: Download CSV Template</h3>
                <p className="text-slate-500 text-xs leading-relaxed">
                  Prepare your purchase order data using our official CSV template. We've included a demo row with expected formats (e.g. YYYY-MM-DD dates, numeric amounts).
                </p>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="mt-2 text-xs text-blue-600 font-semibold hover:text-blue-800 transition-colors flex items-center gap-1.5 cursor-pointer underline"
                >
                  Download CSV Template with Demo Row
                </button>
              </div>

              {/* Step 2: Upload CSV */}
              <form onSubmit={handleImportSubmit} className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-slate-800 text-xs font-semibold uppercase tracking-wider">Step 2: Upload CSV File</h3>
                  <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center bg-slate-50/50 hover:bg-slate-50 transition-colors relative">
                    <input
                      type="file"
                      accept=".csv"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setImportFile(file);
                        setImportResult(null);
                        setImportError(null);
                      }}
                      disabled={importLoading}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                    <Upload className="text-slate-400 mb-2" size={24} />
                    <p className="text-slate-600 text-sm font-medium">
                      {importFile ? importFile.name : 'Select or drag CSV file'}
                    </p>
                    <p className="text-slate-400 text-xs mt-1">
                      {importFile ? `${(importFile.size / 1024).toFixed(1)} KB` : 'Only .csv files supported'}
                    </p>
                  </div>
                </div>

                {importError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl p-3">
                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                    <span>{importError}</span>
                  </div>
                )}

                {importLoading && (
                  <div className="flex items-center justify-center gap-2 text-blue-600 text-xs bg-blue-50 border border-blue-100 rounded-xl p-3 font-medium">
                    <Loader2 className="animate-spin" size={14} />
                    Processing CSV rows...
                  </div>
                )}

                {importResult && (
                  <div className="space-y-4 bg-slate-50 border border-slate-100 rounded-xl p-4">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <h4 className="text-slate-800 text-xs font-semibold uppercase tracking-wider">Import Result</h4>
                      <span className="text-[10px] text-slate-400 font-mono">Total rows: {importResult.total_rows}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-center">
                      <div className="bg-green-50 border border-green-200 rounded-lg p-2.5">
                        <p className="text-green-700 font-bold text-lg leading-none">{importResult.imported_count}</p>
                        <p className="text-green-600 text-[10px] uppercase font-semibold mt-1">Imported</p>
                      </div>
                      <div className="bg-red-50 border border-red-200 rounded-lg p-2.5">
                        <p className="text-red-700 font-bold text-lg leading-none">{importResult.skipped_count}</p>
                        <p className="text-red-600 text-[10px] uppercase font-semibold mt-1">Skipped</p>
                      </div>
                    </div>

                    {importResult.errors.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-slate-600 text-xs font-semibold">Skipped Rows Details ({importResult.errors.length})</p>
                          <button
                            type="button"
                            onClick={handleCopySkipped}
                            className="text-[11px] text-blue-600 hover:text-blue-800 font-medium cursor-pointer underline"
                          >
                            {copiedText ? 'Copied CSV!' : 'Copy all to clipboard'}
                          </button>
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-2 border border-slate-100 bg-white rounded-lg p-2">
                          {importResult.errors.map((err, i) => (
                            <div key={i} className="text-xs border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                              <p className="font-semibold text-slate-800">Row {err.row}</p>
                              <p className="text-red-600 text-[11px] mt-0.5">{err.error}</p>
                              <pre className="text-[10px] text-slate-500 bg-slate-50 rounded p-1.5 mt-1 overflow-x-auto font-mono">
                                {JSON.stringify(err.data, null, 2)}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={importLoading}
                    onClick={() => setShowImportModal(false)}
                    className="px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50 disabled:opacity-40 transition-colors font-medium cursor-pointer font-sans"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={importLoading || !importFile}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg disabled:opacity-40 transition-colors font-medium flex items-center gap-1.5 cursor-pointer font-sans"
                  >
                    {importLoading && <Loader2 className="animate-spin" size={13} />}
                    Upload and Import
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* New PO Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowNewModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold text-base">New Purchase Order</h2>
                <p className="text-slate-400 text-xs mt-0.5">
                  {newStep === 1 && 'Step 1 of 2: Production & Supplier'}
                  {newStep === 2 && 'Step 2 of 2: Order Details'}
                  {newStep === 3 && 'Review: Confirm Purchase Order'}
                </p>
              </div>
              <button
                onClick={() => setShowNewModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-5">
              {newStep === 1 && (
                <>
                  {/* Production */}
                  <div className="space-y-3">
                    <h3 className="text-slate-700 text-xs font-semibold uppercase tracking-wide">Production Details</h3>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-medium text-slate-600">Production <span className="text-red-500">*</span></label>
                        {(isMD || isAccountant || isCoordinator) && (
                          <button
                            type="button"
                            onClick={() => { setQuickProdError(''); setShowQuickProdModal(true); }}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 cursor-pointer"
                          >
                            <Plus size={12} /> Add New Production
                          </button>
                        )}
                      </div>
                      <select
                        value={newForm.production_id}
                        onChange={(e) => { updateField('production_id', e.target.value); updateField('set_code', ''); loadSetsForProduction(e.target.value); }}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white"
                      >
                        <option value="">Select production…</option>
                        {productions.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Supplier */}
                  <div className="space-y-3">
                    <h3 className="text-slate-700 text-xs font-semibold uppercase tracking-wide">Supplier Details</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-xs font-medium text-slate-600">Supplier Name <span className="text-red-500">*</span></label>
                          {(isMD || isAccountant || isCoordinator) && (
                            <button
                              type="button"
                              onClick={() => { setQuickSupplierError(''); setShowQuickSupplierModal(true); }}
                              className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 cursor-pointer"
                            >
                              <Plus size={12} /> Add New Supplier
                            </button>
                          )}
                        </div>
                        <select
                          value={newForm.supplier_name}
                          onChange={(e) => updateField('supplier_name', e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white"
                        >
                          <option value="">Select a supplier...</option>
                          {suppliers.map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-600 mb-1">Supplier Email</label>
                        <input
                          type="email"
                          value={newForm.supplier_email}
                          onChange={(e) => updateField('supplier_email', e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                          placeholder="orders@supplier.com"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Address */}
                  <div className="space-y-3">
                    <h3 className="text-slate-700 text-xs font-semibold uppercase tracking-wide">Address</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-600 mb-1">Street Name</label>
                        <input
                          type="text"
                          value={newForm.street_name}
                          onChange={(e) => updateField('street_name', e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                          placeholder="e.g. 12 Industrial Way"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">City</label>
                        <input
                          type="text"
                          value={newForm.city}
                          onChange={(e) => updateField('city', e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                          placeholder="e.g. Manchester"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">County</label>
                        <input
                          type="text"
                          value={newForm.county}
                          onChange={(e) => updateField('county', e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                          placeholder="e.g. Greater Manchester"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Zip / Post Code</label>
                        <input
                          type="text"
                          value={newForm.zip_code}
                          onChange={(e) => updateField('zip_code', e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                          placeholder="e.g. M1 2AB"
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {newStep === 2 && (
                <>
                  {/* PO Details */}
                  <div className="space-y-3">
                    <h3 className="text-slate-700 text-xs font-semibold uppercase tracking-wide">PO Details</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Date of PO</label>
                        <input
                          type="date"
                          value={newForm.date_of_po}
                          onChange={(e) => updateField('date_of_po', e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Type of Expenditure</label>
                        <input
                          type="text"
                          list="account-codes-list"
                          value={newForm.account_code}
                          onChange={(e) => updateField('account_code', e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                          placeholder="e.g. MAT-001"
                        />
                        <datalist id="account-codes-list">
                          {accountCodes.map(code => <option key={code} value={code} />)}
                        </datalist>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Set Code</label>
                        <input
                          type="text"
                          list="new-po-sets-list"
                          value={newForm.set_code}
                          onChange={(e) => updateField('set_code', e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                          placeholder="e.g. S003"
                        />
                        <datalist id="new-po-sets-list">
                          {setsCache[newForm.production_id]?.filter(s => s.set_number).map(s => (
                            <option key={s.id} value={s.set_number!}>{s.set_number} — {s.set_name}</option>
                          ))}
                        </datalist>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-600 mb-1">Title <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={newForm.title}
                          onChange={(e) => updateField('title', e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                          placeholder="e.g. Paint supplies for Stage 1"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                        <textarea
                          value={newForm.description}
                          onChange={(e) => updateField('description', e.target.value)}
                          rows={4}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 resize-y"
                          placeholder="Generous space for description..."
                        />
                      </div>
                    </div>
                  </div>

                  {/* Financials */}
                  <div className="space-y-3">
                    <h3 className="text-slate-700 text-xs font-semibold uppercase tracking-wide">Financials</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Net Amount (£) <span className="text-red-500">*</span></label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={newForm.net_amount}
                          onChange={(e) => updateField('net_amount', e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">VAT (£)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={newForm.vat}
                          onChange={(e) => updateField('vat', e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Gross Amount (£) <span className="text-slate-400 font-normal">(auto)</span></label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={newForm.gross_amount}
                          readOnly
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-600 bg-slate-50 outline-none cursor-default"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Paid From</label>
                      <select
                        value={newForm.paid_from}
                        onChange={(e) => updateField('paid_from', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white"
                      >
                        <option value="supplier_account">Supplier Account</option>
                        <option value="arbuthnot_current_account">Arbuthnot Current Account</option>
                        <option value="charge_card">Charge Card</option>
                        <option value="pleo_charge_card">Pleo Charge Card</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              {newStep === 3 && (
                <div className="space-y-6 text-sm text-slate-700 bg-slate-50 p-5 rounded-xl border border-slate-100">
                  <div className="grid grid-cols-2 gap-y-4 gap-x-6">
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Production</p>
                      <p className="font-medium text-slate-900 mt-1">{productions.find(p => p.id === newForm.production_id)?.name || newForm.production_id}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Supplier</p>
                      <p className="font-medium text-slate-900 mt-1">{newForm.supplier_name}</p>
                      <p className="text-xs text-slate-500">{[newForm.street_name, newForm.city, newForm.zip_code].filter(Boolean).join(', ') || 'No address provided'}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Title</p>
                      <p className="font-medium text-slate-900 mt-1">{newForm.title}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Description</p>
                      <p className="mt-1 whitespace-pre-wrap">{newForm.description || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Coding</p>
                      <p className="mt-1">Exp Type: <span className="font-mono">{newForm.account_code || '—'}</span></p>
                      <p>Set: <span className="font-mono">{newForm.set_code || '—'}</span></p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Financials</p>
                      <p className="mt-1">Net: {fmt(newForm.net_amount)}</p>
                      <p>VAT: {fmt(newForm.vat)}</p>
                      <p className="font-bold text-slate-900">Gross: {fmt(newForm.gross_amount)}</p>
                      <p className="text-xs mt-1">Paid From: {PAID_FROM_LABEL[newForm.paid_from] || newForm.paid_from}</p>
                    </div>
                    <div className="col-span-2 pt-4 border-t border-slate-200 mt-2">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Order Confirmation (Optional)</p>
                      <label className="block w-full border border-dashed border-slate-300 rounded-lg p-3 text-center cursor-pointer hover:bg-white transition-colors">
                        <span className="text-slate-500 text-sm font-medium">
                          {newConfirmationFile ? newConfirmationFile.name : 'Click to upload confirmation document'}
                        </span>
                        <input
                          type="file"
                          className="hidden"
                          accept=".pdf,.png,.jpg,.jpeg"
                          onChange={e => setNewConfirmationFile(e.target.files?.[0] || null)}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {formError && (
                <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <AlertCircle size={13} />
                  {formError}
                </div>
              )}
            </div>
            
            <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50">
              <div>
                {newStep > 1 && (
                  <button
                    onClick={() => setNewStep(s => (s - 1) as 1|2|3)}
                    className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-white transition-colors"
                  >
                    Back
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-white transition-colors"
                >
                  Cancel
                </button>
                {newStep < 3 ? (
                  <button
                    onClick={() => {
                      setFormError('');
                      if (newStep === 1 && (!newForm.production_id || !newForm.supplier_name.trim())) {
                        setFormError('Production and Supplier Name are required.');
                        return;
                      }
                      if (newStep === 2 && (!newForm.title.trim() || !newForm.net_amount || !newForm.gross_amount)) {
                        setFormError('Title, Net amount and Gross amount are required.');
                        return;
                      }
                      setNewStep(s => (s + 1) as 1|2|3);
                    }}
                    className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    disabled={formLoading}
                    onClick={handleCreatePO}
                    className="flex items-center gap-2 px-5 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium disabled:opacity-60"
                  >
                    {formLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    Create PO
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Attach Invoice Modal */}
      {invoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setInvoiceModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold text-base">Attach Invoice</h2>
                <p className="text-slate-400 text-xs mt-0.5">{invoiceModal.po_number}</p>
              </div>
              <button
                onClick={() => setInvoiceModal(null)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {invoiceModal.invoice_attachment_url ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-white rounded-lg border border-slate-200">
                        <FileText size={20} className="text-slate-600" />
                      </div>
                      <div className="flex flex-col overflow-hidden max-w-[200px] sm:max-w-[250px]">
                        <span className="text-sm font-medium text-slate-700 truncate" title={invoiceModal.invoice_attachment_name || 'Attached Invoice'}>
                          {invoiceModal.invoice_attachment_name || 'Attached Invoice'}
                        </span>
                        <span className="text-xs text-slate-400">Already attached</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          try {
                            const res = await purchaseOrdersApi.downloadInvoice(invoiceModal.id);
                            if (res.url) window.open(res.url, '_blank');
                          } catch (err: unknown) {
                            setInvoiceError(err instanceof Error ? err.message : 'Download failed');
                          }
                        }}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Download Invoice"
                      >
                        <Download size={16} />
                      </button>
                      <button
                        disabled={invoiceLoading}
                        onClick={async () => {
                          setInvoiceLoading(true);
                          setInvoiceError('');
                          try {
                            await purchaseOrdersApi.deleteInvoice(invoiceModal.id);
                            setInvoiceModal({ ...invoiceModal, invoice_attachment_url: null, invoice_attachment_name: null } as PurchaseOrder);
                            await loadData();
                          } catch (err: unknown) {
                            setInvoiceError(err instanceof Error ? err.message : 'Delete failed');
                          } finally {
                            setInvoiceLoading(false);
                          }
                        }}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        title="Remove Invoice"
                      >
                        {invoiceLoading ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors">
                  <Upload size={22} className="text-slate-400 mb-2" />
                  <span className="text-slate-500 text-sm font-medium">
                    {invoiceFile ? invoiceFile.name : 'Click to upload invoice'}
                  </span>
                  <span className="text-slate-400 text-xs mt-1">PDF, PNG, JPG up to 25MB</span>
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setInvoiceFile(f);
                      setInvoiceError('');
                    }}
                  />
                </label>
              )}
              {invoiceError && (
                <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <AlertCircle size={13} />
                  {invoiceError}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50">
              <button
                onClick={() => setInvoiceModal(null)}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-white transition-colors"
              >
                {invoiceModal.invoice_attachment_url ? 'Close' : 'Cancel'}
              </button>
              {!invoiceModal.invoice_attachment_url && (
                <button
                  disabled={!invoiceFile || invoiceLoading}
                  onClick={handleAttachInvoice}
                  className="flex items-center gap-2 px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-60"
                >
                  {invoiceLoading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  Upload Invoice
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Attach Confirmation Modal */}
      {confirmationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmationModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold text-base">Attach Order Confirmation</h2>
                <p className="text-slate-400 text-xs mt-0.5">{confirmationModal.po_number}</p>
              </div>
              <button
                onClick={() => setConfirmationModal(null)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {confirmationModal.confirmation_attachment_url && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-emerald-800">Confirmation already attached</p>
                    <p className="text-xs text-emerald-700 truncate">{confirmationModal.confirmation_attachment_name || 'Order confirmation'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => purchaseOrdersApi.downloadConfirmation(confirmationModal.id, confirmationModal.confirmation_attachment_name || 'order-confirmation')}
                    className="flex-shrink-0 text-xs font-medium text-emerald-700 hover:text-emerald-900"
                  >
                    Download
                  </button>
                </div>
              )}
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors">
                <Upload size={22} className="text-slate-400 mb-2" />
                <span className="text-slate-500 text-sm font-medium">
                  {confirmationFile ? confirmationFile.name : confirmationModal.confirmation_attachment_url ? 'Click to replace confirmation' : 'Click to upload confirmation'}
                </span>
                <input type="file" className="hidden" onChange={e => { setConfirmationFile(e.target.files?.[0] || null); setConfirmationError(''); }} />
              </label>
              {confirmationError && (
                <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 p-2 rounded-lg">
                  <AlertCircle size={13} /> {confirmationError}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setConfirmationModal(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors font-medium">
                  Cancel
                </button>
                <button
                  disabled={!confirmationFile || actionLoading === confirmationModal.id + ':attach-confirm'}
                  onClick={async () => {
                    if (!confirmationFile) return;
                    handleAction(confirmationModal.id, 'attach-confirm', async () => {
                      const formData = new FormData();
                      formData.append('confirmation', confirmationFile);
                      await purchaseOrdersApi.attachConfirmation(confirmationModal.id, formData);
                      setConfirmationModal(null);
                      await loadData();
                    }, (msg) => setConfirmationError(msg));
                  }}
                  className="flex items-center gap-2 px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
                >
                  {actionLoading === confirmationModal.id + ':attach-confirm' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {confirmationModal.confirmation_attachment_url ? 'Replace Confirmation' : 'Upload Confirmation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit PO Modal — draft only */}
      {editPO && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditPO(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col my-8">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-white rounded-t-2xl shrink-0">
              <div>
                <h2 className="text-slate-900 font-semibold text-base">Edit Purchase Order</h2>
                <p className="text-slate-400 text-xs mt-0.5">{editPO.po_number} — Draft</p>
              </div>
              <button onClick={() => setEditPO(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-5 overflow-y-auto">
              {editError && (
                <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <AlertCircle size={13} />{editError}
                </div>
              )}
              {/* Supplier */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Supplier Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Supplier Name *</label>
                    <select
                      value={editForm.supplier_name}
                      onChange={e => {
                        const val = e.target.value;
                        const data = getSupplierData(val);
                        const supplierRecord = suppliersList.find(s => s.name.toLowerCase() === val.trim().toLowerCase());
                        setEditForm(f => ({
                          ...f,
                          supplier_id: supplierRecord?.id || '',
                          supplier_name: val,
                          supplier_email: data?.email ? data.email : f.supplier_email,
                          street_name: data?.street_name ? data.street_name : f.street_name,
                          city: data?.city ? data.city : f.city,
                          county: data?.county ? data.county : f.county,
                          zip_code: data?.zip_code ? data.zip_code : f.zip_code,
                        }));
                      }}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">Select a supplier...</option>
                      {suppliers.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Supplier Email</label>
                    <input type="email" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={editForm.supplier_email} onChange={e => setEditForm(f => ({ ...f, supplier_email: e.target.value }))} />
                  </div>
                </div>
              </div>
              {/* Address */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Address</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Street Name</label>
                    <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={editForm.street_name} onChange={e => setEditForm(f => ({ ...f, street_name: e.target.value }))} placeholder="e.g. 12 Industrial Way" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">City</label>
                    <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={editForm.city} onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))} placeholder="e.g. Manchester" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">County</label>
                    <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={editForm.county} onChange={e => setEditForm(f => ({ ...f, county: e.target.value }))} placeholder="e.g. Greater Manchester" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Zip / Post Code</label>
                    <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={editForm.zip_code} onChange={e => setEditForm(f => ({ ...f, zip_code: e.target.value }))} placeholder="e.g. M1 2AB" />
                  </div>
                </div>
              </div>
              {/* PO Details */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">PO Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
                    <input type="date" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={editForm.date_of_po} onChange={e => setEditForm(f => ({ ...f, date_of_po: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Production *</label>
                    <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={editForm.production_id} onChange={e => { setEditForm(f => ({ ...f, production_id: e.target.value, set_code: '' })); loadSetsForProduction(e.target.value); }}>
                      <option value="">— Select —</option>
                      {productions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Set Code</label>
                    <input list="edit-po-sets-list" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={editForm.set_code} onChange={e => setEditForm(f => ({ ...f, set_code: e.target.value }))} />
                    <datalist id="edit-po-sets-list">
                      {setsCache[editForm.production_id]?.filter(s => s.set_number).map(s => (
                        <option key={s.id} value={s.set_number!}>{s.set_number} — {s.set_name}</option>
                      ))}
                    </datalist>
                  </div>
                  <div className="col-span-1">
                    <label className="block text-xs font-medium text-slate-500 mb-1 uppercase tracking-wider">Type of Expenditure</label>
                    <input list="account-codes-list" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={editForm.account_code} onChange={e => setEditForm(f => ({ ...f, account_code: e.target.value }))} />
                    <datalist id="account-codes-list">
                      {accountCodes.map(code => <option key={code} value={code} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Department</label>
                    <select
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      value={editForm.department}
                      onChange={e => setEditForm(f => ({ ...f, department: e.target.value, custom_department: e.target.value === 'Other' ? f.custom_department : '' }))}
                    >
                      <option value="">— Select department —</option>
                      {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                      <option value="Other">Other / Custom</option>
                    </select>
                  </div>
                  {editForm.department === 'Other' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Custom Department *</label>
                      <input
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={editForm.custom_department}
                        onChange={e => setEditForm(f => ({ ...f, custom_department: e.target.value }))}
                        placeholder="Enter department name"
                      />
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
                    <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                    <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                </div>
              </div>
              {/* Financials */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Financials</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Net (£) *</label>
                    <input type="number" step="0.01" min="0" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={editForm.net_amount} onChange={e => setEditForm(f => {
                      const net = parseFloat(e.target.value) || 0;
                      return { ...f, net_amount: e.target.value, vat: (net * 0.20).toFixed(2), gross_amount: (net * 1.20).toFixed(2) };
                    })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">VAT (£)</label>
                    <input type="number" step="0.01" min="0" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={editForm.vat} onChange={e => setEditForm(f => {
                      const net = parseFloat(f.net_amount) || 0;
                      const vat = parseFloat(e.target.value) || 0;
                      return { ...f, vat: e.target.value, gross_amount: (net + vat).toFixed(2) };
                    })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Gross (£) <span className="text-slate-400 font-normal">(auto)</span></label>
                    <input type="number" step="0.01" min="0" readOnly className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-600 bg-slate-50 cursor-default" value={editForm.gross_amount} />
                  </div>
                </div>
                <div className="mt-4">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Paid From</label>
                  <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={editForm.paid_from} onChange={e => setEditForm(f => ({ ...f, paid_from: e.target.value }))}>
                    <option value="supplier_account">Supplier Account</option>
                    <option value="arbuthnot_current_account">Arbuthnot Current Account</option>
                    <option value="charge_card">Charge Card</option>
                    <option value="pleo_charge_card">Pleo Charge Card</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl shrink-0">
              <button onClick={() => setEditPO(null)} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-white transition-colors">
                Cancel
              </button>
              <button
                disabled={editLoading}
                onClick={handleSaveEdit}
                className="flex items-center gap-2 px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-60"
              >
                {editLoading ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit without invoice confirmation modal */}
      {submitConfirmPO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setSubmitConfirmPO(null); setSubmitConfirmInvoiceFile(null); }} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 pt-6 pb-2">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-50 mb-4 mx-auto">
                <AlertCircle size={24} className="text-amber-500" />
              </div>
              <h2 className="text-slate-900 font-semibold text-base text-center">Submit Purchase Order</h2>
              <p className="text-slate-500 text-sm text-center mt-2">
                No invoice is attached to <span className="font-medium">{submitConfirmPO.po_number}</span>. Are you sure you want to submit? Or you can attach an invoice now.
              </p>
              
              <div className="mt-4 border border-slate-200 rounded-xl p-4 bg-slate-50">
                <label className="block text-xs font-semibold text-slate-700 mb-2">Attach Invoice (Optional)</label>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setSubmitConfirmInvoiceFile(e.target.files?.[0] || null)}
                  className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>

            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
              <button
                onClick={() => { setSubmitConfirmPO(null); setSubmitConfirmInvoiceFile(null); }}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-white transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={actionLoading === submitConfirmPO.id + ':submit'}
                onClick={() => {
                  const id = submitConfirmPO.id;
                  handleAction(id, 'submit', async () => {
                    if (submitConfirmInvoiceFile) {
                      const formData = new FormData();
                      formData.append('invoice', submitConfirmInvoiceFile);
                      await purchaseOrdersApi.attachInvoice(id, formData);
                    }
                    await purchaseOrdersApi.submit(id);
                    setSubmitConfirmPO(null);
                    setSubmitConfirmInvoiceFile(null);
                    await loadData();
                  }, (msg) => setActionError(msg ? { id, msg } : null));
                }}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-60"
              >
                {actionLoading === submitConfirmPO.id + ':submit' ? <Loader2 size={14} className="animate-spin" /> : 'Yes, Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Supplier Overview Modal */}
      {supplierOverviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSupplierOverviewModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <h2 className="text-slate-900 font-semibold text-base">Supplier Overview</h2>
              <button onClick={() => setSupplierOverviewModal(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-600">Quick snapshot for <strong>{supplierOverviewModal}</strong></p>
              <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-100">
                <p className="text-xs text-slate-500 mb-2">Total POs:</p>
                <p className="font-semibold text-slate-900">{pos.filter(p => p.supplier_name === supplierOverviewModal).length}</p>
                
                <p className="text-xs text-slate-500 mt-4 mb-2">Total Spent (Gross):</p>
                <p className="font-semibold text-slate-900">
                  {fmt(pos.filter(p => p.supplier_name === supplierOverviewModal).reduce((acc, p) => acc + parseFloat(p.gross_amount), 0).toFixed(2))}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View Full PO Modal */}
      {viewFullPO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setViewFullPO(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold text-base">Purchase Order {viewFullPO.po_number}</h2>
                <p className="text-slate-400 text-xs mt-0.5">{viewFullPO.status.toUpperCase()}</p>
              </div>
              <button onClick={() => setViewFullPO(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 bg-white space-y-8">
              <div>
                <h3 className="text-lg font-bold text-slate-800 mb-1">
                  {viewFullPO.title || viewFullPO.supplier_name}
                </h3>
                {viewFullPO.title && (
                  <p className="text-sm text-slate-500">{viewFullPO.supplier_name}</p>
                )}
                <p className="text-sm text-slate-700 whitespace-pre-wrap mt-2">{viewFullPO.description || 'No description provided'}</p>
              </div>
              <div className="grid grid-cols-2 gap-y-4 gap-x-6 bg-slate-50 p-5 rounded-xl border border-slate-100">
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Production</p>
                  <p className="font-medium text-slate-900 mt-1">{viewFullPO.prod_name || viewFullPO.production_id}</p>
                  <p className="text-xs text-slate-500 mt-1">Date: {fmtDate(viewFullPO.date_of_po)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Supplier</p>
                  <p className="font-medium text-slate-900 mt-1">{viewFullPO.supplier_name}</p>
                  {viewFullPO.supplier_address && <p className="text-xs text-slate-500">{viewFullPO.supplier_address}</p>}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Coding</p>
                  <p className="mt-1">Exp Type: <span className="font-mono">{viewFullPO.account_code || '—'}</span></p>
                  <p className="mt-1">Set: <span className="font-mono">{viewFullPO.set_code || '—'}</span></p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Financials</p>
                  <p className="mt-1">Net: {fmt(viewFullPO.net_amount)}</p>
                  <p>VAT: {fmt(viewFullPO.vat)}</p>
                  <p className="font-bold text-slate-900">Gross: {fmt(viewFullPO.gross_amount)}</p>
                  <p className="text-xs mt-1">Paid From: {PAID_FROM_LABEL[viewFullPO.paid_from] || viewFullPO.paid_from}</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button onClick={() => setViewFullPO(null)} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-white transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Add Production Modal */}
      {showQuickProdModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" onClick={() => { if (!quickProdLoading) setShowQuickProdModal(false); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 flex-shrink-0">
              <h2 className="text-slate-900 font-semibold text-sm">New Production</h2>
              <button onClick={() => setShowQuickProdModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={16} /></button>
            </div>
            <form onSubmit={handleQuickAddProduction} className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
              {quickProdError && <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">{quickProdError}</p>}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Production Name *</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Meridian"
                  value={quickProdForm.name}
                  onChange={(e) => setQuickProdForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Production Company</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. Lionsgate UK"
                    value={quickProdForm.production_company}
                    onChange={(e) => setQuickProdForm(f => ({ ...f, production_company: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Production Designer</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. Helena Portman"
                    value={quickProdForm.production_designer}
                    onChange={(e) => setQuickProdForm(f => ({ ...f, production_designer: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Production Type</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. Feature Film"
                    value={quickProdForm.production_type}
                    onChange={(e) => setQuickProdForm(f => ({ ...f, production_type: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Initial Status</label>
                  <select
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    value={quickProdForm.status}
                    onChange={(e) => setQuickProdForm(f => ({ ...f, status: e.target.value as ProductionStatus }))}
                  >
                    <option value="pre_production">Pre-Production</option>
                    <option value="active_build">Active Build</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Start Date</label>
                  <input
                    type="date"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={quickProdForm.start_date}
                    onChange={(e) => setQuickProdForm(f => ({ ...f, start_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">End Date</label>
                  <input
                    type="date"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={quickProdForm.end_date}
                    onChange={(e) => setQuickProdForm(f => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
              </div>

              {/* Contract Type Selector */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">Contract Type *</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { type: 'on_a_price' as ContractType, label: 'On a Price', desc: 'Fixed fee agreed with production. Internal cost tracking only.' },
                    { type: 'cost_plus' as ContractType, label: 'Cost Plus', desc: 'All costs recharged with margin. Cost report shared with production.' },
                  ].map(ct => (
                    <button
                      key={ct.type}
                      type="button"
                      onClick={() => setQuickProdForm(f => ({ ...f, contract_type: ct.type }))}
                      className={`text-left px-3 py-2 rounded-lg border-2 transition-all ${
                        quickProdForm.contract_type === ct.type
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-semibold text-slate-800">{ct.label}</span>
                        {quickProdForm.contract_type === ct.type && <span className="text-[9px] text-blue-600 font-semibold bg-blue-100 px-1 py-0.5 rounded">✓</span>}
                      </div>
                      <p className="text-[11px] text-slate-500 leading-snug">{ct.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setShowQuickProdModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">Cancel</button>
                <button type="submit" disabled={quickProdLoading}
                  className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
                >
                  {quickProdLoading && <Loader2 size={14} className="animate-spin" />}
                  Create Production
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Add Supplier Modal */}
      {showQuickSupplierModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" onClick={() => { if (!quickSupplierLoading) setShowQuickSupplierModal(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div>
                <h2 className="text-slate-900 font-semibold text-base">Add New Supplier</h2>
                <p className="text-slate-400 text-xs mt-0.5">Add a new supplier to the database and auto-populate this order</p>
              </div>
              <button onClick={() => setShowQuickSupplierModal(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg transition-colors">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleQuickAddSupplier} className="px-6 py-5 space-y-4 max-h-[85vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Supplier Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={quickSupplierForm.supplier_name}
                  onChange={(e) => setQuickSupplierForm(f => ({ ...f, supplier_name: e.target.value }))}
                  placeholder="e.g. Treeline Timber Co."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Supplier Email</label>
                  <input
                    type="email"
                    value={quickSupplierForm.supplier_email}
                    onChange={(e) => setQuickSupplierForm(f => ({ ...f, supplier_email: e.target.value }))}
                    placeholder="orders@supplier.com"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={quickSupplierForm.phone}
                    onChange={(e) => setQuickSupplierForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="e.g. +44 20 1234 5678"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Street Name</label>
                <input
                  type="text"
                  value={quickSupplierForm.street_name}
                  onChange={(e) => setQuickSupplierForm(f => ({ ...f, street_name: e.target.value }))}
                  placeholder="e.g. 12 Industrial Way"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">City</label>
                  <input
                    type="text"
                    value={quickSupplierForm.city}
                    onChange={(e) => setQuickSupplierForm(f => ({ ...f, city: e.target.value }))}
                    placeholder="e.g. Manchester"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">County</label>
                  <input
                    type="text"
                    value={quickSupplierForm.county}
                    onChange={(e) => setQuickSupplierForm(f => ({ ...f, county: e.target.value }))}
                    placeholder="e.g. Greater Manchester"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Zip / Post Code</label>
                  <input
                    type="text"
                    value={quickSupplierForm.zip_code}
                    onChange={(e) => setQuickSupplierForm(f => ({ ...f, zip_code: e.target.value }))}
                    placeholder="e.g. M1 2AB"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={quickSupplierForm.notes}
                  onChange={(e) => setQuickSupplierForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional notes or contact details"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              <hr className="border-slate-100" />
              <div>
                <h3 className="text-sm font-medium text-slate-800 mb-3">Catalogue Entry (Optional)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Product Description</label>
                    <input
                      type="text"
                      value={quickSupplierForm.product_description}
                      onChange={(e) => setQuickSupplierForm(f => ({ ...f, product_description: e.target.value }))}
                      placeholder="e.g. 18mm Plywood"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Unit of Measure</label>
                    <input
                      type="text"
                      value={quickSupplierForm.unit_of_measure}
                      onChange={(e) => setQuickSupplierForm(f => ({ ...f, unit_of_measure: e.target.value }))}
                      placeholder="e.g. Sheet, Lin M, Each"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Unit Price (£)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={quickSupplierForm.unit_price}
                      onChange={(e) => setQuickSupplierForm(f => ({ ...f, unit_price: e.target.value }))}
                      placeholder="0.00"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {quickSupplierError && (
                <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <AlertCircle size={13} />
                  {quickSupplierError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowQuickSupplierModal(false)}
                  className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={quickSupplierLoading}
                  className="flex items-center gap-2 px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-60"
                >
                  {quickSupplierLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Add Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Datalist for reusable options */}
      <datalist id="account-codes-list">
        {accountCodes.map((code) => (
          <option key={code} value={code} />
        ))}
      </datalist>
    </>
  );
}
