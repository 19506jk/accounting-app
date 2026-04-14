import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type {
  DonationReceiptAccount,
  DonationReceiptAccountsResponse,
  DonationReceiptGenerateResponse,
  DonationReceiptPreviewResponse,
  DonationReceiptTemplateResponse,
} from '@shared/contracts';
import { getDonationLines, type DonationLine } from './donorDonations.js';

const db = require('../db') as Knex;

const TEMPLATE_VARIABLES = [
  'receipt_serial_number',
  'donor_name',
  'donor_id',
  'donor_address',
  'donor_address_line1',
  'donor_address_line2',
  'donor_city',
  'donor_province',
  'donor_postal_code',
  'church_name',
  'church_address',
  'church_address_line1',
  'church_address_line2',
  'church_city',
  'church_province',
  'church_postal_code',
  'church_phone',
  'cra_charitable_registration_number',
  'fiscal_year',
  'total_amount',
  'generated_date',
] as const;

const VARIABLE_SET = new Set<string>(TEMPLATE_VARIABLES);
const DEFAULT_TEMPLATE = `# Official Donation Receipt

**{{church_name}}**  
{{church_address}}  
{{church_city}}, {{church_province}} {{church_postal_code}}  
Phone: {{church_phone}}  
CRA Charitable Registration No: {{cra_charitable_registration_number}}

Receipt for fiscal year {{fiscal_year}}  
Receipt serial number: {{receipt_serial_number}}  
Generated: {{generated_date}}

## Donor

{{donor_name}}  
Donor ID: {{donor_id}}  
{{donor_address}}  
{{donor_city}}, {{donor_province}} {{donor_postal_code}}

**Total eligible amount: {{total_amount}}**
`;

type SettingRow = { key: string; value: string | null };

interface TemplateRow {
  id: number;
  markdown_body: string;
  updated_at: string | Date;
}

interface ContactReceiptRow {
  id: number;
  name: string;
  donor_id: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
}

interface ReceiptData {
  contact: ContactReceiptRow;
  total: Decimal;
  lines: DonationLine[];
  warnings: string[];
  serial_number: string;
}

function dec(value: string | number | Decimal | null | undefined) {
  return new Decimal(value ?? 0);
}

function money(value: string | number | Decimal) {
  return `$${dec(value).toNumber().toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function compactJoin(parts: Array<string | null | undefined>, separator = ' ') {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join(separator);
}

function validateTemplate(markdownBody: string) {
  const unknown = new Set<string>();
  const matches = markdownBody.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g);
  for (const match of matches) {
    const variable = match[1];
    if (variable && !VARIABLE_SET.has(variable)) unknown.add(variable);
  }
  return [...unknown];
}

async function getSettingsMap() {
  const rows = await db('settings').select('key', 'value') as SettingRow[];
  return Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, string | null>;
}

function resolveFiscalYearRange(fiscalYear: number, fiscalStartMonth: number) {
  const startYear = fiscalStartMonth === 1 ? fiscalYear : fiscalYear - 1;
  const startDate = `${startYear}-${String(fiscalStartMonth).padStart(2, '0')}-01`;
  const end = new Date(Date.UTC(startYear + 1, fiscalStartMonth - 1, 0));
  return {
    startDate,
    endDate: end.toISOString().slice(0, 10),
  };
}

async function getFiscalYearRange(fiscalYear: number) {
  const settings = await getSettingsMap();
  const fiscalStartMonth = Math.max(1, Math.min(12, parseInt(settings.fiscal_year_start ?? '1', 10) || 1));
  return resolveFiscalYearRange(fiscalYear, fiscalStartMonth);
}

async function getTemplateBody(markdownBody?: string) {
  if (markdownBody !== undefined) return markdownBody;
  const row = await db('donation_receipt_templates')
    .orderBy('id', 'asc')
    .first() as TemplateRow | undefined;
  return row?.markdown_body || DEFAULT_TEMPLATE;
}

async function validateIncomeAccountIds(accountIds: number[]) {
  const uniqueIds = [...new Set(accountIds)];
  const rows = await db('accounts')
    .whereIn('id', uniqueIds)
    .where('type', 'INCOME')
    .select('id') as Array<{ id: number }>;
  const validIds = new Set(rows.map((row) => row.id));
  const invalidIds = uniqueIds.filter((id) => !validIds.has(id));

  if (invalidIds.length) {
    const err = new Error(`Selected account IDs are not income accounts: ${invalidIds.join(', ')}`);
    (err as Error & { status?: number }).status = 400;
    throw err;
  }

  return uniqueIds;
}

async function getContactsById(contactIds: number[]) {
  if (!contactIds.length) return new Map<number, ContactReceiptRow>();
  const rows = await db('contacts')
    .whereIn('id', contactIds)
    .select('id', 'name', 'donor_id', 'address_line1', 'address_line2', 'city', 'province', 'postal_code') as ContactReceiptRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

function groupReceipts(lines: DonationLine[], contactsById: Map<number, ContactReceiptRow>) {
  const grouped = new Map<number, DonationLine[]>();
  for (const line of lines) {
    if (line.contact_id === null) continue;
    const donorLines = grouped.get(line.contact_id) || [];
    donorLines.push(line);
    grouped.set(line.contact_id, donorLines);
  }

  const receipts: ReceiptData[] = [];
  for (const [contactId, donorLines] of grouped) {
    const contact = contactsById.get(contactId);
    if (!contact) continue;
    const total = donorLines.reduce((sum, line) => sum.plus(dec(line.amount)), dec(0));
    if (total.lessThanOrEqualTo(0)) continue;
    const warnings: string[] = [];
    if (!contact.donor_id) warnings.push(`Missing donor_id for ${contact.name} (contact ${contact.id})`);
    if (!compactJoin([contact.address_line1, contact.address_line2])) warnings.push(`Missing donor address for ${contact.name}`);
    receipts.push({ contact, total, lines: donorLines, warnings, serial_number: '' });
  }

  receipts.sort((a, b) => a.contact.name.localeCompare(b.contact.name));
  receipts.forEach((receipt, index) => {
    receipt.serial_number = `5-${String(index + 1).padStart(3, '0')}`;
  });
  return receipts;
}

function renderReceiptMarkdown(
  template: string,
  receipt: ReceiptData,
  settings: Record<string, string | null>,
  fiscalYear: number
) {
  const donorAddress = compactJoin([receipt.contact.address_line1, receipt.contact.address_line2], '\n');
  const churchAddress = compactJoin([settings.church_address_line1, settings.church_address_line2], '\n');
  const values: Record<string, string> = {
    receipt_serial_number: receipt.serial_number,
    donor_name: receipt.contact.name,
    donor_id: receipt.contact.donor_id || '',
    donor_address: donorAddress,
    donor_address_line1: receipt.contact.address_line1 || '',
    donor_address_line2: receipt.contact.address_line2 || '',
    donor_city: receipt.contact.city || '',
    donor_province: receipt.contact.province || '',
    donor_postal_code: receipt.contact.postal_code || '',
    church_name: settings.church_name || '',
    church_address: churchAddress,
    church_address_line1: settings.church_address_line1 || '',
    church_address_line2: settings.church_address_line2 || '',
    church_city: settings.church_city || '',
    church_province: settings.church_province || '',
    church_postal_code: settings.church_postal_code || '',
    church_phone: settings.church_phone || '',
    cra_charitable_registration_number: settings.church_registration_no || '',
    fiscal_year: String(fiscalYear),
    total_amount: money(receipt.total),
    generated_date: new Date().toISOString().slice(0, 10),
  };

  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, variable: string) => values[variable] ?? '');
}

async function buildReceipts(fiscalYear: number, accountIds: number[], markdownBody?: string) {
  const validAccountIds = await validateIncomeAccountIds(accountIds);
  const { startDate, endDate } = await getFiscalYearRange(fiscalYear);
  const lines = await getDonationLines({
    from: startDate,
    to: endDate,
    accountIds: validAccountIds,
    includeAnonymous: false,
  });
  const contactIds = [...new Set(lines
    .map((line) => line.contact_id)
    .filter((id): id is number => id !== null))];
  const contactsById = await getContactsById(contactIds);
  const receipts = groupReceipts(lines, contactsById);
  const settings = await getSettingsMap();
  const template = await getTemplateBody(markdownBody);
  const unknownVariables = validateTemplate(template);
  if (unknownVariables.length) {
    const err = new Error(`Unknown template variables: ${unknownVariables.join(', ')}`);
    (err as Error & { status?: number }).status = 400;
    throw err;
  }

  const churchWarnings: string[] = [];
  if (!settings.church_name) churchWarnings.push('Missing church_name setting');
  if (!settings.church_registration_no) churchWarnings.push('Missing church_registration_no setting');

  const warnings = [...churchWarnings, ...receipts.flatMap((receipt) => receipt.warnings)];

  return {
    fiscalYear,
    periodStart: startDate,
    periodEnd: endDate,
    receipts,
    settings,
    template,
    warnings,
  };
}

export async function getReceiptAccounts(fiscalYear: number): Promise<DonationReceiptAccountsResponse> {
  const { startDate, endDate } = await getFiscalYearRange(fiscalYear);
  const accounts = await db('accounts')
    .where({ type: 'INCOME', is_active: true })
    .select('id', 'code', 'name')
    .orderBy('code', 'asc') as Array<{ id: number; code: string; name: string }>;

  const lines = await getDonationLines({ from: startDate, to: endDate, includeAnonymous: true });
  const totals = new Map<number, Decimal>();
  for (const line of lines) {
    totals.set(line.account_id, (totals.get(line.account_id) || dec(0)).plus(dec(line.amount)));
  }

  return {
    fiscal_year: fiscalYear,
    period_start: startDate,
    period_end: endDate,
    accounts: accounts.map((account): DonationReceiptAccount => ({
      ...account,
      total: parseFloat((totals.get(account.id) || dec(0)).toFixed(2)),
    })),
  };
}

export async function getReceiptTemplate(): Promise<DonationReceiptTemplateResponse> {
  const row = await db('donation_receipt_templates')
    .orderBy('id', 'asc')
    .first() as TemplateRow | undefined;

  return {
    template: {
      markdown_body: row?.markdown_body || DEFAULT_TEMPLATE,
      updated_at: row ? String(row.updated_at) : null,
    },
    variables: [...TEMPLATE_VARIABLES],
  };
}

export async function saveReceiptTemplate(markdownBody: string, userId: number): Promise<DonationReceiptTemplateResponse> {
  const unknownVariables = validateTemplate(markdownBody);
  if (unknownVariables.length) {
    const err = new Error(`Unknown template variables: ${unknownVariables.join(', ')}`);
    (err as Error & { status?: number }).status = 400;
    throw err;
  }

  const existing = await db('donation_receipt_templates')
    .orderBy('id', 'asc')
    .first() as TemplateRow | undefined;

  if (existing) {
    await db('donation_receipt_templates')
      .where({ id: existing.id })
      .update({ markdown_body: markdownBody, updated_by: userId, updated_at: db.fn.now() });
  } else {
    await db('donation_receipt_templates')
      .insert({ markdown_body: markdownBody, updated_by: userId, created_at: db.fn.now(), updated_at: db.fn.now() });
  }

  return getReceiptTemplate();
}

export async function previewReceipt(
  fiscalYear: number,
  accountIds: number[],
  markdownBody?: string
): Promise<DonationReceiptPreviewResponse> {
  const data = await buildReceipts(fiscalYear, accountIds, markdownBody);
  const firstReceipt = data.receipts[0];
  if (!firstReceipt) {
    return {
      markdown: null,
      warnings: data.warnings,
      donor_count: 0,
    };
  }

  return {
    markdown: renderReceiptMarkdown(data.template, firstReceipt, data.settings, data.fiscalYear),
    warnings: data.warnings,
    donor_count: data.receipts.length,
  };
}

export async function generateReceipts(
  fiscalYear: number,
  accountIds: number[],
  markdownBody?: string
): Promise<DonationReceiptGenerateResponse> {
  const data = await buildReceipts(fiscalYear, accountIds, markdownBody);
  const receipts = data.receipts.map((receipt) =>
    renderReceiptMarkdown(data.template, receipt, data.settings, data.fiscalYear)
  );

  return {
    receipts,
    meta: {
      fiscal_year: data.fiscalYear,
      period_start: data.periodStart,
      period_end: data.periodEnd,
      donor_count: data.receipts.length,
      warnings: data.warnings,
    },
  };
}
