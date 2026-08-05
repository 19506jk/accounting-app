import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type {
  DonationReceiptAccount,
  DonationReceiptAccountsResponse,
  DonationReceiptGeneratePdfResponse,
  DonationReceiptPreviewResponse,
  DonationReceiptTemplateResponse,
} from '@shared/contracts';
import { getDonationLines, type DonationLine } from './donorDonations.js';
import {
  DEFAULT_HTML_TEMPLATE,
  DEFAULT_TEMPLATE,
  TEMPLATE_VARIABLES,
  convertLegacyMarkdown,
  prepareTemplate,
  substituteTemplate,
  substituteTree,
  type PreparedTemplate,
} from './donationReceiptHtml.js';

const db = require('../db') as Knex;

type SettingRow = { key: string; value: string | null };

interface TemplateRow {
  id: number;
  html_body: string | null;
  markdown_body: string | null;
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

/**
 * Returns the canonical sanitized HTML template, converting a legacy
 * `markdown_body` lazily if `html_body` is null. The conversion persists only
 * when no other writer has stored `html_body` first (conditional update); if
 * the update affects no rows, a concurrent save won and its value is used.
 * `markdown_body` is preserved unchanged for rollback.
 *
 * Exported for unit-testing the lazy-conversion race: `dbClient` lets a test
 * script the conditional update returning zero rows followed by a refetch.
 */
export async function getTemplateHtml(row?: TemplateRow, dbClient: Knex = db): Promise<string> {
  if (!row) {
    row = await dbClient('donation_receipt_templates').orderBy('id', 'asc').first() as TemplateRow | undefined;
  }
  if (!row) return DEFAULT_HTML_TEMPLATE;
  if (row.html_body) return row.html_body;

  const legacyMarkdown = row.markdown_body || DEFAULT_TEMPLATE;
  let prepared = prepareTemplate(convertLegacyMarkdown(legacyMarkdown), { legacy: true, allowEmpty: true });
  if (!prepared.tree) {
    // Converted legacy content had no supported visible content — use the default.
    prepared = prepareTemplate(DEFAULT_HTML_TEMPLATE);
  }

  const updated = await dbClient('donation_receipt_templates')
    .where({ id: row.id })
    .whereNull('html_body')
    .update({ html_body: prepared.html });
  if (!updated) {
    // A concurrent template save won the race — use its value.
    const fresh = await dbClient('donation_receipt_templates').where({ id: row.id }).first() as TemplateRow | undefined;
    return fresh?.html_body || prepared.html;
  }
  return prepared.html;
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

function buildTemplateValues(
  receipt: ReceiptData,
  settings: Record<string, string | null>,
  fiscalYear: number
): Record<string, string> {
  const donorAddress = compactJoin([receipt.contact.address_line1, receipt.contact.address_line2], '\n');
  const churchAddress = compactJoin([settings.church_address_line1, settings.church_address_line2], '\n');
  return {
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
}

function renderReceiptHtml(prepared: PreparedTemplate, receipt: ReceiptData, settings: Record<string, string | null>, fiscalYear: number) {
  return substituteTemplate(prepared.tree!, buildTemplateValues(receipt, settings, fiscalYear));
}

function renderReceiptTree(prepared: PreparedTemplate, receipt: ReceiptData, settings: Record<string, string | null>, fiscalYear: number) {
  return substituteTree(prepared.tree!, buildTemplateValues(receipt, settings, fiscalYear));
}

async function buildReceipts(fiscalYear: number, accountIds: number[], htmlBody?: string) {
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
  // Re-validate the template on every request, matching the previous
  // markdown behavior; the saved/converted html_body is always canonical.
  const template = prepareTemplate(htmlBody !== undefined ? htmlBody : await getTemplateHtml());

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
      html_body: await getTemplateHtml(row),
      updated_at: row ? String(row.updated_at) : null,
    },
    variables: [...TEMPLATE_VARIABLES],
  };
}

export async function saveReceiptTemplate(htmlBody: string, userId: number): Promise<DonationReceiptTemplateResponse> {
  // Throws 400 for unknown variables, placeholders inside attributes, and
  // templates with no supported content after sanitization.
  const prepared = prepareTemplate(htmlBody);

  const existing = await db('donation_receipt_templates')
    .orderBy('id', 'asc')
    .first() as TemplateRow | undefined;

  if (existing) {
    await db('donation_receipt_templates')
      .where({ id: existing.id })
      .update({ html_body: prepared.html, updated_by: userId, updated_at: db.fn.now() });
  } else {
    await db('donation_receipt_templates')
      .insert({ html_body: prepared.html, updated_by: userId, created_at: db.fn.now(), updated_at: db.fn.now() });
  }

  return getReceiptTemplate();
}

export async function previewReceipt(
  fiscalYear: number,
  accountIds: number[],
  htmlBody?: string
): Promise<DonationReceiptPreviewResponse> {
  const data = await buildReceipts(fiscalYear, accountIds, htmlBody);
  const firstReceipt = data.receipts[0];
  if (!firstReceipt) {
    return {
      html: null,
      warnings: data.warnings,
      donor_count: 0,
    };
  }

  return {
    html: renderReceiptHtml(data.template, firstReceipt, data.settings, data.fiscalYear),
    warnings: data.warnings,
    donor_count: data.receipts.length,
  };
}

export async function generateReceiptPdf(
  fiscalYear: number,
  accountIds: number[],
  htmlBody?: string
): Promise<DonationReceiptGeneratePdfResponse> {
  const data = await buildReceipts(fiscalYear, accountIds, htmlBody);
  // Pass substituted trees (not serialized HTML) so the renderer walks the
  // same sanitized DOM without re-parsing per receipt.
  const receipts = data.receipts.map((receipt) =>
    renderReceiptTree(data.template, receipt, data.settings, data.fiscalYear)
  );
  const { renderDonationReceiptsPdfBase64 } =
    require('./donationReceiptPdf.js') as typeof import('./donationReceiptPdf.js');
  const pdfBase64 = await renderDonationReceiptsPdfBase64(receipts);

  return {
    pdf_base64: pdfBase64,
    filename: `donation_receipts_fy${fiscalYear}.pdf`,
    meta: {
      fiscal_year: data.fiscalYear,
      period_start: data.periodStart,
      period_end: data.periodEnd,
      donor_count: data.receipts.length,
      warnings: data.warnings,
    },
  };
}
