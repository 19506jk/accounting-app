import { parseDocument } from 'htmlparser2';
import { Document, Element, Text, type AnyNode } from 'domhandler';
import render from 'dom-serializer';
import { marked } from 'marked';

/**
 * Sanitized HTML handling for donation receipt templates.
 *
 * Templates are HTML fragments, not complete documents. They are parsed once
 * into a DOM tree, sanitized, serialized for storage/preview, and walked
 * directly by the PDF renderer. Variables are substituted by cloning the
 * sanitized tree and inserting text/`br` nodes — never by interpolating raw
 * HTML — so donor/settings values can never inject markup.
 */

export const TEMPLATE_VARIABLES = [
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

/** Legacy Markdown default, used only to seed lazy conversion of old rows. */
export const DEFAULT_TEMPLATE = `# Official Donation Receipt

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

/** Equivalent of the supplied tax receipt sample, authored as an HTML fragment. */
export const DEFAULT_HTML_TEMPLATE = `<p style="text-align:right"><strong>Receipt No. {{receipt_serial_number}}</strong></p>
<h1 style="text-align:center">Official Receipt for Income Tax Purposes</h1>
<hr>
<h2 style="text-align:center">{{church_name}}</h2>
<p style="text-align:center">{{church_address}}<br>
{{church_city}}, {{church_province}} {{church_postal_code}}<br>
Tel: {{church_phone}}<br>
<strong>Registration Number: {{cra_charitable_registration_number}}</strong></p>
<p style="text-align:center">Donations Received: January 1 – December 31, {{fiscal_year}}</p>
<table>
<tbody>
<tr>
<td><strong>Donated By:</strong><br>
{{donor_name}}<br>
{{donor_address}}<br>
{{donor_city}}, {{donor_province}} {{donor_postal_code}}</td>
<td><strong>Account No.</strong><br>{{donor_id}}</td>
</tr>
</tbody>
</table>
<p>Thank you very much for your continued support and your donation to {{church_name}}.</p>
<table>
<tbody>
<tr>
<th>Eligible amount of gift for tax purposes</th>
<td style="text-align:right"><strong>{{total_amount}}</strong></td>
</tr>
</tbody>
</table>
<table>
<tbody>
<tr>
<td>Location receipt issued: {{church_city}}</td>
<td>Date receipt issued: {{generated_date}}</td>
</tr>
</tbody>
</table>
<p><strong>Authorized Signature:</strong></p>
<p style="text-align:right">__________________________________________<br>
Authorized representative</p>
<p>For information on all registered charities in Canada under the Income Tax Act, visit the Canada Revenue Agency at <a href="https://www.canada.ca/en/services/taxes/charities.html">canada.ca/charities-giving</a>.</p>`;

const BLOCK_TAGS = new Set([
  'h1', 'h2', 'h3', 'p', 'div', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'blockquote', 'hr',
]);

const INLINE_TAGS = new Set(['strong', 'em', 'del', 'code', 'br', 'a']);

const ALLOWED_TAGS = new Set([...BLOCK_TAGS, ...INLINE_TAGS]);

/** Elements removed entirely, including their subtree. */
const DROPPED_TAGS = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'img', 'picture', 'source', 'video', 'audio', 'track', 'svg', 'math',
  'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select',
  'option', 'optgroup', 'label', 'fieldset', 'legend', 'template', 'noscript',
  'canvas', 'map', 'area', 'dialog', 'datalist', 'output', 'progress', 'meter',
  'marquee', 'slot',
]);

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

const TEXT_ALIGN_RE = /^\s*text-align\s*:\s*(left|center|right)\s*;?\s*$/i;

export class TemplateValidationError extends Error {
  status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'TemplateValidationError';
  }
}

export interface PreparedTemplate {
  /** Sanitized, validated tree; null when legacy content was empty (allowEmpty). */
  tree: Document | null;
  /** Canonical serialized HTML. */
  html: string;
}

/** Fresh regex per call so the shared `/g` flag cannot leak `lastIndex`. */
function findVariables(text: string): Array<{ name: string; index: number; length: number }> {
  const pattern = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
  const matches: Array<{ name: string; index: number; length: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    matches.push({ name: match[1] ?? '', index: match.index, length: match[0].length });
  }
  return matches;
}

function isText(node: AnyNode): node is Text {
  return node.type === 'text';
}

function isElement(node: AnyNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

/**
 * Elements that are visible on their own, even with no text content. All
 * other elements count as content only if they contain meaningful text, so
 * structural shells like `<p></p>`, `<div></div>`, or `<p><br></p>` do not
 * satisfy the empty-after-sanitization check.
 */
const SELF_VISIBLE_TAGS = new Set(['hr']);

function hasVisibleContent(nodes: AnyNode[]): boolean {
  for (const node of nodes) {
    if (isText(node)) {
      if (node.data.trim()) return true;
    } else if (isElement(node)) {
      if (SELF_VISIBLE_TAGS.has(node.name.toLowerCase())) return true;
      if (hasVisibleContent(node.children)) return true;
    }
  }
  return false;
}

function assertNoAttributePlaceholders(nodes: AnyNode[]): void {
  for (const node of nodes) {
    if (isElement(node)) {
      for (const [name, value] of Object.entries(node.attribs)) {
        if (findVariables(value).length) {
          throw new TemplateValidationError(
            `Template variables are not allowed inside HTML attributes: <${node.name} ${name}=...>`
          );
        }
      }
      assertNoAttributePlaceholders(node.children);
    }
  }
}

function findUnknownVariables(nodes: AnyNode[]): string[] {
  const unknown = new Set<string>();
  for (const node of nodes) {
    if (isText(node)) {
      for (const variable of findVariables(node.data)) {
        if (!VARIABLE_SET.has(variable.name)) unknown.add(variable.name);
      }
    } else if (isElement(node)) {
      for (const inner of findUnknownVariables(node.children)) unknown.add(inner);
    }
  }
  return [...unknown];
}

function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return false;
  // Fragment/relative links have no scheme.
  const colon = trimmed.indexOf(':');
  if (colon === -1) return true;
  const protocol = trimmed.slice(0, colon + 1).toLowerCase();
  return SAFE_LINK_PROTOCOLS.has(protocol);
}

/** Percent-decodes an href; `marked` URL-encodes braces, e.g. `{{x}}` → `%7B%7Bx%7D%7D`. */
function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function sanitizeAttribs(attribs: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  const style = attribs.style;
  if (style !== undefined) {
    const match = style.match(TEXT_ALIGN_RE);
    if (match) sanitized.style = `text-align:${match[1]}`;
  }
  return sanitized;
}

function sanitizeChildren(nodes: AnyNode[], legacy: boolean): AnyNode[] {
  const out: AnyNode[] = [];
  for (const node of nodes) {
    out.push(...sanitizeNode(node, legacy));
  }
  return out;
}

/**
 * Returns the sanitized replacement nodes for one source node.
 * - Text nodes are kept verbatim.
 * - Dropped tags (script, img, form, ...) are removed with their subtree.
 * - Allowed tags keep only `style` (text-align only) and link `href`.
 * - Unknown benign tags are unwrapped, preserving their children.
 * - Legacy links whose href contains a template variable are unwrapped and the
 *   templated URL is appended as visible text, so the variable stays
 *   substitutable without becoming an unsafe attribute.
 */
function sanitizeNode(node: AnyNode, legacy: boolean): AnyNode[] {
  if (isText(node)) return [new Text(node.data)];
  if (!isElement(node)) return [];

  const tag = node.name.toLowerCase();
  if (DROPPED_TAGS.has(tag)) return [];

  if (tag === 'a') {
    const href = node.attribs.href;
    const children = sanitizeChildren(node.children, legacy);
    if (href !== undefined) {
      // `marked` percent-encodes braces in URLs, so decode before checking
      // for placeholders — this also catches encoded unsafe schemes.
      const decoded = decodeHref(href);
      const hasPlaceholder = findVariables(decoded).length > 0;
      if (hasPlaceholder) {
        if (legacy) return [...children, new Text(` (${decoded})`)];
        throw new TemplateValidationError(
          'Template variables are not allowed inside HTML attributes: <a href=...>'
        );
      }
      if (isSafeHref(decoded)) {
        return [new Element('a', { href }, children)];
      }
    }
    // No usable href — unwrap the link, keep its text.
    return children;
  }

  if (!ALLOWED_TAGS.has(tag)) {
    return sanitizeChildren(node.children, legacy);
  }

  return [new Element(tag, sanitizeAttribs(node.attribs), sanitizeChildren(node.children, legacy))];
}

/**
 * Parses a template fragment, sanitizes it, and validates it.
 * Throws TemplateValidationError (HTTP 400) for unknown variables,
 * placeholders inside attributes (new submissions), or templates with no
 * supported visible content (unless `allowEmpty`, used for legacy content).
 */
export function prepareTemplate(
  rawHtml: string,
  opts: { legacy?: boolean; allowEmpty?: boolean } = {}
): PreparedTemplate {
  const document = parseDocument(rawHtml);

  if (!opts.legacy) {
    assertNoAttributePlaceholders(document.children);
  }

  const sanitized = new Document(sanitizeChildren(document.children, Boolean(opts.legacy)));

  if (!hasVisibleContent(sanitized.children)) {
    if (opts.allowEmpty) return { tree: null, html: '' };
    throw new TemplateValidationError('Template is empty after sanitization');
  }

  const unknown = findUnknownVariables(sanitized.children);
  if (unknown.length) {
    throw new TemplateValidationError(`Unknown template variables: ${unknown.join(', ')}`);
  }

  return { tree: sanitized, html: render(sanitized) };
}

/**
 * Converts legacy Markdown to HTML for lazy migration. `:::center` blocks are
 * preprocessed into centered divs because `marked` does not know them; the
 * result is then sanitized by `prepareTemplate(..., { legacy: true })`.
 */
export function convertLegacyMarkdown(markdown: string): string {
  const centerBlocks: string[] = [];
  const withPlaceholders = markdown.replace(
    /^:::center\s*\n([\s\S]*?)^:::\s*$/gm,
    (_match, content: string) => {
      const token = `@@CENTER_BLOCK_${centerBlocks.length}@@`;
      centerBlocks.push(`<div style="text-align:center">${marked.parse(content.trim(), { gfm: true, breaks: false })}</div>`);
      return token;
    }
  );

  let html = marked.parse(withPlaceholders, { gfm: true, breaks: false }) as string;
  centerBlocks.forEach((block, index) => {
    html = html
      .replace(`<p>@@CENTER_BLOCK_${index}@@</p>`, () => block)
      .replace(`@@CENTER_BLOCK_${index}@@`, () => block);
  });
  return html;
}

function cloneNode(node: AnyNode): AnyNode {
  if (isText(node)) return new Text(node.data);
  if (node.type === 'root') return new Document(node.children.map(cloneNode));
  if (isElement(node)) {
    return new Element(node.name, { ...node.attribs }, node.children.map(cloneNode));
  }
  return new Text('');
}

function substituteChildren(nodes: AnyNode[], values: Record<string, string>): AnyNode[] {
  const out: AnyNode[] = [];
  for (const node of nodes) {
    if (isText(node)) {
      out.push(...substituteText(node.data, values));
    } else {
      if (isElement(node)) {
        node.children = substituteChildren(node.children, values);
      }
      out.push(node);
    }
  }
  return out;
}

function substituteText(data: string, values: Record<string, string>): AnyNode[] {
  const parts: AnyNode[] = [];
  let lastIndex = 0;
  for (const variable of findVariables(data)) {
    if (variable.index > lastIndex) {
      parts.push(new Text(data.slice(lastIndex, variable.index)));
    }
    const value = values[variable.name] ?? '';
    value.split('\n').forEach((part, index) => {
      if (index > 0) parts.push(new Element('br', {}));
      if (part) parts.push(new Text(part));
    });
    lastIndex = variable.index + variable.length;
  }
  if (lastIndex < data.length) {
    parts.push(new Text(data.slice(lastIndex)));
  }
  return parts;
}

/**
 * Substitutes template variables into a sanitized tree and returns the
 * substituted tree, cloned per receipt. Multiline values (e.g. addresses)
 * become `br`-separated text nodes, so values can never inject markup. The
 * PDF renderer walks this tree directly (parse-once design).
 */
export function substituteTree(tree: Document, values: Record<string, string>): Document {
  const clone = cloneNode(tree) as Document;
  clone.children = substituteChildren(clone.children, values);
  return clone;
}

/** Substitutes variables and serializes the result for preview/storage. */
export function substituteTemplate(tree: Document, values: Record<string, string>): string {
  return render(substituteTree(tree, values));
}
