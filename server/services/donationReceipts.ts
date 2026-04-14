import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type {
  DonationReceiptAccount,
  DonationReceiptAccountsResponse,
  DonationReceiptGenerateMeta,
  DonationReceiptPreviewResponse,
  DonationReceiptTemplateResponse,
} from '@shared/contracts';
import { getDonationLines, type DonationLine } from './donorDonations.js';

const db = require('../db') as Knex;

const TEMPLATE_VARIABLES = [
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
  'cra_charitable_registration_number',
  'fiscal_year',
  'fiscal_year_start_date',
  'fiscal_year_end_date',
  'total_amount',
  'donation_lines',
  'generated_date',
] as const;

const VARIABLE_SET = new Set<string>(TEMPLATE_VARIABLES);
const DEFAULT_TEMPLATE = `# Official Donation Receipt

**{{church_name}}**  
{{church_address}}  
{{church_city}}, {{church_province}} {{church_postal_code}}  
CRA Charitable Registration No: {{cra_charitable_registration_number}}

Receipt for fiscal year {{fiscal_year}}  
Period: {{fiscal_year_start_date}} to {{fiscal_year_end_date}}  
Generated: {{generated_date}}

## Donor

{{donor_name}}  
Donor ID: {{donor_id}}  
{{donor_address}}  
{{donor_city}}, {{donor_province}} {{donor_postal_code}}

## Donations

{{donation_lines}}

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

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function markdownToHtml(markdown: string) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];
  let tableBuffer: string[] = [];
  let listBuffer: Array<{ type: 'ul' | 'ol'; item: string }> = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.join('<br>')}</p>`);
    paragraph = [];
  }

  function flushTable() {
    if (!tableBuffer.length) return;
    if (tableBuffer.length >= 2 && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(tableBuffer[1] || '')) {
      const rows = tableBuffer.filter((_, index) => index !== 1).map((row) =>
        row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
      );
      const [header, ...body] = rows;
      if (header) {
        html.push('<table>');
        html.push(`<thead><tr>${header.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead>`);
        html.push('<tbody>');
        for (const row of body) html.push(`<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`);
        html.push('</tbody></table>');
      }
    } else {
      html.push(...tableBuffer.map((line) => `<p>${line}</p>`));
    }
    tableBuffer = [];
  }

  function flushList() {
    if (!listBuffer.length) return;
    let currentType = listBuffer[0]?.type || 'ul';
    html.push(`<${currentType}>`);
    for (const entry of listBuffer) {
      if (entry.type !== currentType) {
        html.push(`</${currentType}>`);
        html.push(`<${entry.type}>`);
        currentType = entry.type;
      }
      html.push(`<li>${entry.item}</li>`);
    }
    html.push(`</${currentType}>`);
    listBuffer = [];
  }

  function inline(text: string) {
    return escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|')) {
      flushParagraph();
      flushList();
      tableBuffer.push(inline(trimmed));
      continue;
    }
    flushTable();

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    const numberedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (bulletMatch?.[1] || numberedMatch?.[1]) {
      flushParagraph();
      listBuffer.push({
        type: bulletMatch ? 'ul' : 'ol',
        item: inline(bulletMatch?.[1] || numberedMatch?.[1] || ''),
      });
      continue;
    }
    flushList();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (trimmed.startsWith('### ')) {
      flushParagraph();
      html.push(`<h3>${inline(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushParagraph();
      html.push(`<h2>${inline(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith('# ')) {
      flushParagraph();
      html.push(`<h1>${inline(trimmed.slice(2))}</h1>`);
      continue;
    }

    paragraph.push(inline(trimmed.replace(/\s{2}$/, '')));
  }

  flushParagraph();
  flushList();
  flushTable();
  return html.join('\n');
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
    receipts.push({ contact, total, lines: donorLines, warnings });
  }

  receipts.sort((a, b) => a.contact.name.localeCompare(b.contact.name));
  return receipts;
}

function donationLinesMarkdown(lines: DonationLine[]) {
  const includeReference = lines.some((line) => Boolean(line.reference_no));
  const headers = includeReference
    ? ['Date', 'Account', 'Reference', 'Amount']
    : ['Date', 'Account', 'Amount'];
  const rows = lines.map((line) => includeReference
    ? [line.date, line.account_name, line.reference_no || '', money(line.amount)]
    : [line.date, line.account_name, money(line.amount)]);

  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function renderReceiptMarkdown(
  template: string,
  receipt: ReceiptData,
  settings: Record<string, string | null>,
  fiscalYear: number,
  periodStart: string,
  periodEnd: string
) {
  const donorAddress = compactJoin([receipt.contact.address_line1, receipt.contact.address_line2], '\n');
  const churchAddress = compactJoin([settings.church_address_line1, settings.church_address_line2], '\n');
  const values: Record<string, string> = {
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
    cra_charitable_registration_number: settings.church_registration_no || '',
    fiscal_year: String(fiscalYear),
    fiscal_year_start_date: periodStart,
    fiscal_year_end_date: periodEnd,
    total_amount: money(receipt.total),
    donation_lines: donationLinesMarkdown(receipt.lines),
    generated_date: new Date().toISOString().slice(0, 10),
  };

  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, variable: string) => values[variable] ?? '');
}

function renderReceiptHtml(
  template: string,
  receipt: ReceiptData,
  settings: Record<string, string | null>,
  fiscalYear: number,
  periodStart: string,
  periodEnd: string
) {
  return markdownToHtml(renderReceiptMarkdown(template, receipt, settings, fiscalYear, periodStart, periodEnd));
}

function wrapDocument(receiptHtml: string[], title: string) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { color: #111827; font-family: Georgia, "Times New Roman", serif; margin: 0; background: #f3f4f6; }
    .receipt { box-sizing: border-box; width: 8.5in; min-height: 11in; margin: 0 auto 24px; padding: 0.75in; background: white; }
    h1 { font-size: 22px; margin: 0 0 18px; }
    h2 { font-size: 16px; margin: 22px 0 10px; }
    h3 { font-size: 14px; margin: 18px 0 8px; }
    p { line-height: 1.45; margin: 0 0 12px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 20px; font-size: 13px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 7px 6px; text-align: left; vertical-align: top; }
    th:last-child, td:last-child { text-align: right; }
    @media print {
      body { background: white; }
      .receipt { width: auto; min-height: auto; margin: 0; padding: 0.5in; break-after: page; }
      .receipt:last-child { break-after: auto; }
    }
  </style>
</head>
<body>
${receiptHtml.map((html) => `<section class="receipt">${html}</section>`).join('\n')}
</body>
</html>`;
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
      html: '<p>No donors found for the selected fiscal year and accounts.</p>',
      warnings: data.warnings,
      donor_count: 0,
    };
  }

  return {
    html: renderReceiptHtml(data.template, firstReceipt, data.settings, data.fiscalYear, data.periodStart, data.periodEnd),
    warnings: data.warnings,
    donor_count: data.receipts.length,
  };
}

export async function generateReceipts(
  fiscalYear: number,
  accountIds: number[],
  markdownBody?: string
): Promise<{ html: string; meta: DonationReceiptGenerateMeta }> {
  const data = await buildReceipts(fiscalYear, accountIds, markdownBody);
  const receipts = data.receipts.map((receipt) =>
    renderReceiptHtml(data.template, receipt, data.settings, data.fiscalYear, data.periodStart, data.periodEnd)
  );

  return {
    html: wrapDocument(receipts, `Donation Receipts ${fiscalYear}`),
    meta: {
      fiscal_year: data.fiscalYear,
      period_start: data.periodStart,
      period_end: data.periodEnd,
      donor_count: data.receipts.length,
      warnings: data.warnings,
    },
  };
}
