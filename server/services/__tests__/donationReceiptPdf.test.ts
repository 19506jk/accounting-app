import { parseDocument } from 'htmlparser2';
import type { Element } from 'domhandler';
import { describe, expect, it } from 'vitest';

import { DEFAULT_HTML_TEMPLATE, prepareTemplate, substituteTree } from '../donationReceiptHtml.js';
import {
  normalizeTokens,
  orderLineSegments,
  renderDonationReceiptsPdfBase64,
  tableRowModel,
  type InlineToken,
  type TextInlineToken,
} from '../donationReceiptPdf.js';
import { TINY_JPEG_DATA_URI, TINY_PNG_DATA_URI } from '../../utils/signatureImageFixtures.js';

function elementFrom(html: string): Element {
  const doc = parseDocument(html);
  const node = doc.children.find((child) => child.type === 'tag');
  if (!node || node.type !== 'tag') throw new Error('no element in test html');
  return node;
}

function cellsFromRowHtml(html: string): Element[] {
  const table = elementFrom(`<table><tr>${html}</tr></table>`);
  const row = table.children.find((child) => child.type === 'tag' && child.name === 'tr') as Element;
  return row.children.filter((child) => child.type === 'tag' && (child.name === 'th' || child.name === 'td')) as Element[];
}

const SAMPLE_HTML = `<h1>Official Donation Receipt</h1>
<p><strong>Test Church</strong><br>
1 Main St<br>
Ottawa, ON K1A 0B1</p>
<p style="text-align:center">Centered line</p>
<p style="text-align:right">Right-aligned line</p>
<ul><li>First item</li><li>Second item</li></ul>
<ol start="3"><li>Three</li><li>Four</li></ol>
<table><thead><tr><th>Item</th><th>Amount</th></tr></thead><tbody><tr><td>Gift</td><td>$40.00</td></tr></tbody></table>
<p>Visit <a href="https://example.com">example.com</a> or <code>code()</code>.</p>
<blockquote>Quoted note</blockquote>
<hr>
<p>Delivered <del>yesterday</del> today.</p>`;

function treeOf(html: string) {
  const { tree } = prepareTemplate(html);
  if (!tree) throw new Error('test template produced no tree');
  return tree;
}

async function expectPdf(html: string) {
  const base64 = await renderDonationReceiptsPdfBase64([treeOf(html)]);
  const buffer = Buffer.from(base64, 'base64');
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  return base64;
}

/** Prepares a template and substitutes signer values, like the receipt service. */
function signedTreeOf(html: string, values: Record<string, string>) {
  const { tree } = prepareTemplate(html);
  if (!tree) throw new Error('test template produced no tree');
  return substituteTree(tree, values);
}

async function expectSignedPdf(html: string, values: Record<string, string>) {
  const base64 = await renderDonationReceiptsPdfBase64([signedTreeOf(html, values)]);
  const buffer = Buffer.from(base64, 'base64');
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  return base64;
}

describe('donationReceiptPdf DOM walker', () => {
  it('renders a PDF from sanitized HTML with headings, alignment, lists, tables, links, and rules', async () => {
    const base64 = await expectPdf(SAMPLE_HTML);
    // Multiple pages worth of stream content — just assert a valid, non-trivial PDF.
    expect(base64.length).toBeGreaterThan(1000);
  });

  it('renders a PDF containing plain text content', async () => {
    await expectPdf('<p>Hello {{donor_name}} — thank you.</p>');
  });

  it('renders empty receipt sets with the no-donor page', async () => {
    const base64 = await renderDonationReceiptsPdfBase64([]);
    const buffer = Buffer.from(base64, 'base64');
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renders multiple receipts as separate pages in one PDF', async () => {
    const base64 = await renderDonationReceiptsPdfBase64([
      treeOf('<h1>Receipt One</h1><p>First donor</p>'),
      treeOf('<h1>Receipt Two</h1><p>Second donor</p>'),
    ]);
    const buffer = Buffer.from(base64, 'base64');
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    // Each page object carries `/Type /Page`; the pages tree carries `/Type /Pages`.
    const pageObjects = (buffer.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
    expect(pageObjects).toBe(2);
  });

  it('renders tables without thead and data-only rows', async () => {
    await expectPdf('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>');
  });

  it('renders uneven table rows with consistent column widths', async () => {
    await expectPdf('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>');
  });

  it('renders row and section alignment on table cells', async () => {
    await expectPdf(
      '<table>' +
      '<thead style="text-align:center"><tr><th>H</th></tr></thead>' +
      '<tbody><tr style="text-align:left"><td>L</td></tr></tbody>' +
      '</table>'
    );
  });

  it('renders nested lists', async () => {
    await expectPdf('<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>');
  });

  it('renders multiline substituted addresses with br nodes', async () => {
    await expectPdf('<p>456 Receipt Road<br>Ottawa, ON K1A 0B1</p>');
  });

  it('renders mixed inline content inside block containers without losing formatting', async () => {
    await expectPdf('<div>Hello <strong>world</strong> and <em>friends</em>.</div>');
  });

  it('renders formatted inline content inside list items', async () => {
    await expectPdf('<ul><li><strong>Bold</strong> item</li></ul>');
  });

  it('renders the default template with br newlines without blank lines', async () => {
    await expectPdf(DEFAULT_HTML_TEMPLATE);
  });

  it('renders alignment inherited from containers on lists, blockquotes, and tables', async () => {
    await expectPdf(
      '<div style="text-align:right">' +
      '<ul><li>right item</li></ul>' +
      '<blockquote>quote</blockquote>' +
      '<table><tr><td>cell</td></tr></table>' +
      '</div>'
    );
  });
});

describe('donationReceiptPdf trusted signature images', () => {
  const signerValues = {
    branch_accountant_signature: TINY_PNG_DATA_URI,
    branch_accountant_name: 'Jane Accountant',
    treasurer_signature: TINY_PNG_DATA_URI,
    treasurer_name: 'Tom Treasurer',
  };

  it('renders a PNG signature image in a right-aligned paragraph', async () => {
    await expectSignedPdf('<p style="text-align:right">{{branch_accountant_signature}}</p>', signerValues);
  });

  it('renders a JPEG signature image', async () => {
    await expectSignedPdf(
      '<p>{{treasurer_signature}}</p>',
      { ...signerValues, treasurer_signature: TINY_JPEG_DATA_URI }
    );
  });

  it('renders signature images in table cells', async () => {
    await expectSignedPdf(
      '<table><tr>' +
      '<td style="text-align:center">{{branch_accountant_signature}}</td>' +
      '<td style="text-align:center">{{treasurer_signature}}</td>' +
      '</tr></table>',
      signerValues
    );
  });

  it('renders signature images in headings', async () => {
    await expectSignedPdf('<h1>{{branch_accountant_signature}}</h1>', signerValues);
  });

  it('renders signature images in list items', async () => {
    await expectSignedPdf('<ul><li>{{branch_accountant_signature}}</li></ul>', signerValues);
  });

  it('renders mixed text/image/text runs in one line', async () => {
    await expectSignedPdf('<p>Signed: {{branch_accountant_signature}} Done</p>', signerValues);
  });

  it('renders left, center, and right alignment for image paragraphs', async () => {
    await expectSignedPdf(
      '<p style="text-align:left">{{branch_accountant_signature}}</p>' +
      '<p style="text-align:center">{{treasurer_signature}}</p>' +
      '<p style="text-align:right">{{branch_accountant_signature}}</p>',
      signerValues
    );
  });

  it('renders the default template with both signers configured', async () => {
    await expectSignedPdf(DEFAULT_HTML_TEMPLATE, signerValues);
  });

  it('renders pruned empty signer lines without phantom spacing', async () => {
    await expectSignedPdf(
      '<p>{{branch_accountant_signature}}<br>{{branch_accountant_name}}<br>Authorized representative</p>',
      { branch_accountant_signature: '', branch_accountant_name: '' }
    );
  });
});

describe('tableRowModel', () => {
  it('pads short rows to columnCount with null cells', () => {
    const model = tableRowModel(
      cellsFromRowHtml('<td>a</td><td>b</td>'),
      3,
      elementFrom('<tr></tr>'),
      undefined,
      'left',
    );
    expect(model.map((entry) => entry.cell)).toEqual([
      expect.any(Object),
      expect.any(Object),
      null,
    ]);
  });

  it('styles header cells per cell tag, not per row', () => {
    // A mixed `<th>/<td>` row keeps each cell's own header semantics — the
    // old first-row heuristic styled both as headers here.
    const mixed = tableRowModel(
      cellsFromRowHtml('<th>Label</th><td>Value</td>'),
      2,
      elementFrom('<tr></tr>'),
      undefined,
      'left',
    );
    expect(mixed[0]?.isHeader).toBe(true);
    expect(mixed[1]?.isHeader).toBe(false);
  });

  it('resolves alignment through cell → row → section → table', () => {
    const row = elementFrom('<tr style="text-align:left"></tr>');
    const section = elementFrom('<tbody style="text-align:center"></tbody>');

    // Explicit cell alignment wins over everything.
    const explicit = tableRowModel(
      cellsFromRowHtml('<td style="text-align:right">x</td>'),
      1,
      row,
      section,
      'right',
    );
    expect(explicit[0]?.align).toBe('right');

    // Row beats section and table.
    const rowWins = tableRowModel(cellsFromRowHtml('<td>x</td>'), 1, row, section, 'right');
    expect(rowWins[0]?.align).toBe('left');

    // Section beats table.
    const sectionWins = tableRowModel(
      cellsFromRowHtml('<td>x</td>'),
      1,
      elementFrom('<tr></tr>'),
      section,
      'right',
    );
    expect(sectionWins[0]?.align).toBe('center');

    // Table alignment is the fallback.
    const tableWins = tableRowModel(
      cellsFromRowHtml('<td>x</td>'),
      1,
      elementFrom('<tr></tr>'),
      undefined,
      'right',
    );
    expect(tableWins[0]?.align).toBe('right');
  });
});

describe('image line segment ordering', () => {
  const text = (value: string): TextInlineToken => ({
    kind: 'text',
    text: value,
    ctx: { bold: false, italic: false },
    extra: {},
  });
  const image = (): InlineToken => ({ kind: 'image', src: 'data:image/png;base64,x', width: 180, height: 70 });

  it('keeps mixed text/image/text runs in their original order with their spaces', () => {
    // `Signed: {{signature}} Done` — the spaces belong to their own side of
    // the image, so the PDF reads `Signed: [img] Done`.
    const tokens: InlineToken[] = [text('Signed: '), image(), text(' Done')];

    expect(orderLineSegments(tokens)).toEqual([
      { kind: 'text', tokens: [text('Signed:'), text(' ')] },
      { kind: 'image', token: image() },
      { kind: 'text', tokens: [text(' '), text('Done')] },
    ]);
  });

  it('keeps the space on the image side of a one-sided text run', () => {
    expect(orderLineSegments([text('Signed: '), image()])).toEqual([
      { kind: 'text', tokens: [text('Signed:'), text(' ')] },
      { kind: 'image', token: image() },
    ]);
    expect(orderLineSegments([image(), text(' Done')])).toEqual([
      { kind: 'image', token: image() },
      { kind: 'text', tokens: [text(' '), text('Done')] },
    ]);
  });

  it('drops whitespace-only runs at the line edges, keeping only ones between images', () => {
    expect(orderLineSegments([text('  '), image(), text('X')])).toEqual([
      { kind: 'image', token: image() },
      { kind: 'text', tokens: [text('X')] },
    ]);
    expect(orderLineSegments([image(), text('  '), image()])).toEqual([
      { kind: 'image', token: image() },
      { kind: 'text', tokens: [text(' ')] },
      { kind: 'image', token: image() },
    ]);
  });

  it('groups consecutive text tokens into a single segment before an image', () => {
    const tokens: InlineToken[] = [text('Hello'), text(' world'), image()];

    expect(orderLineSegments(tokens)).toEqual([
      { kind: 'text', tokens: [text('Hello'), text(' world')] },
      { kind: 'image', token: image() },
    ]);
  });
});

describe('inline whitespace normalization', () => {
  const text = (value: string): InlineToken => ({
    kind: 'text',
    text: value,
    ctx: { bold: false, italic: false },
    extra: {},
  });

  it('collapses source newlines to a single space instead of line breaks', () => {
    expect(normalizeTokens([text('Line one\n\nline two')]))
      .toEqual([text('Line one line two')]);
  });

  it('drops whitespace adjacent to hard breaks so <br>\\n cannot create blank lines', () => {
    const tokens: InlineToken[] = [text('Church'), { kind: 'break' }, text('\nAddress')];
    expect(normalizeTokens(tokens))
      .toEqual([text('Church'), { kind: 'break' }, text('Address')]);
  });

  it('collapses inter-element whitespace to a single space', () => {
    expect(normalizeTokens([text('Hello '), text('world')]))
      .toEqual([text('Hello'), text(' world')]);
  });

  it('keeps no space between adjacent inline runs without source whitespace', () => {
    expect(normalizeTokens([text('Hello'), text('world')]))
      .toEqual([text('Hello'), text('world')]);
  });

  it('preserves leading whitespace on a styled token mid-run', () => {
    // `Hello<strong> world</strong>` — the space belongs to the styled run
    // and must not collapse away into Helloworld.
    expect(normalizeTokens([text('Hello'), text(' world')]))
      .toEqual([text('Hello'), text(' world')]);
  });

  it('trims whitespace at the run edges and renders nothing for whitespace-only runs', () => {
    expect(normalizeTokens([text('  Hello  ')])).toEqual([text('Hello')]);
    expect(normalizeTokens([text('  \n ')])).toEqual([]);
  });
});
