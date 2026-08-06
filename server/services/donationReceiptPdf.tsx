import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import type { AnyNode, Document as DomDocument, Element, Text as DomText } from 'domhandler'
import type React from 'react'
import type { Style } from '@react-pdf/types'

type InlineContext = {
  bold: boolean
  italic: boolean
}

type BlockContext = {
  textAlign: 'left' | 'center' | 'right'
}

/** Extra inline styling carried through flattening (del/code/link wrappers). */
type InlineStyle = {
  del?: boolean
  code?: boolean
  link?: boolean
}

export type TextInlineToken = {
  kind: 'text'
  text: string
  ctx: InlineContext
  extra: InlineStyle
}

/** A trusted signature image injected by template substitution. */
export type ImageInlineToken = {
  kind: 'image'
  src: string
  width: number
  height: number
}

/**
 * One flat inline unit: styled text, a hard break from `<br>`, or a trusted
 * signature image. Images are only ever produced by the sanitizer's
 * substitution (authored `<img>` tags are stripped), and their numeric
 * dimensions are the single source of truth for rendering size.
 */
export type InlineToken = TextInlineToken | ImageInlineToken | { kind: 'break' }

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 52,
    fontFamily: 'Helvetica',
    fontSize: 10.5,
    color: '#243247',
    lineHeight: 1.5,
  },
  heading1: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 20,
    color: '#173b57',
    marginTop: 2,
    marginBottom: 10,
    lineHeight: 1.2,
  },
  heading2: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 18,
    color: '#173b57',
    marginTop: 2,
    marginBottom: 6,
    lineHeight: 1.2,
  },
  heading3: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 6,
    lineHeight: 1.25,
  },
  paragraph: {
    fontSize: 10.5,
    marginBottom: 9,
  },
  centerBlock: {
    textAlign: 'center',
  },
  list: {
    marginBottom: 8,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  listBullet: {
    fontFamily: 'Helvetica',
    width: 16,
    fontSize: 11,
    lineHeight: 1.45,
  },
  listContent: {
    flex: 1,
  },
  listParagraph: {
    fontSize: 11,
    marginBottom: 4,
  },
  del: {
    textDecoration: 'line-through',
  },
  code: {
    fontFamily: 'Courier',
    fontSize: 10,
  },
  link: {
    textDecoration: 'underline',
    color: '#1d4ed8',
  },
  table: {
    display: 'flex',
    width: '100%',
    borderWidth: 1,
    borderColor: '#b9c8d4',
    borderRadius: 3,
    marginTop: 2,
    marginBottom: 12,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#d8e1e8',
  },
  tableLastRow: {
    borderBottomWidth: 0,
  },
  tableCell: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: '#d8e1e8',
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  tableLastCell: {
    borderRightWidth: 0,
  },
  tableHeaderCell: {
    backgroundColor: '#e9f0f5',
  },
  tableCellText: {
    fontSize: 10,
    lineHeight: 1.45,
  },
  tableHeaderText: {
    fontFamily: 'Helvetica-Bold',
  },
  empty: {
    fontSize: 12,
  },
  hr: {
    borderBottomWidth: 2,
    borderBottomColor: '#2f6f89',
    marginTop: 8,
    marginBottom: 12,
  },
})

function resolveInlineFontFamily(ctx: InlineContext): string {
  if (ctx.bold && ctx.italic) return 'Helvetica-BoldOblique'
  if (ctx.bold) return 'Helvetica-Bold'
  if (ctx.italic) return 'Helvetica-Oblique'
  return 'Helvetica'
}

function isText(node: AnyNode | undefined): node is DomText {
  return Boolean(node) && node!.type === 'text'
}

function isElement(node: AnyNode | undefined, name?: string): node is Element {
  if (!node || node.type !== 'tag') return false
  return name === undefined || node.name === name
}

function textOf(node: AnyNode | undefined): string {
  if (isText(node)) return node.data
  if (isElement(node)) return node.children.map(textOf).join('')
  return ''
}

function textAlignOf(node: Element): 'left' | 'center' | 'right' | undefined {
  const style = node.attribs.style
  if (!style) return undefined
  const match = /text-align\s*:\s*(left|center|right)/i.exec(style)
  return match ? (match[1] as 'left' | 'center' | 'right') : undefined
}

const INLINE_TAGS = new Set(['strong', 'em', 'del', 'code', 'br', 'a'])

function isInlineNode(node: AnyNode): boolean {
  if (isText(node)) return true
  return isElement(node) && (INLINE_TAGS.has(node.name) || node.name === 'img')
}

const TRUSTED_IMAGE_SRC_RE = /^data:image\/(png|jpeg);base64,/

/**
 * Converts a trusted image node into an image token. Only images injected by
 * the sanitizer's substitution reach the walker; authored `<img>` tags are
 * stripped before substitution. The data-URI source is re-validated and the
 * numeric node dimensions are read as the authoritative size.
 */
function trustedImageToken(node: Element): ImageInlineToken | undefined {
  const src = node.attribs.src
  if (!src || !TRUSTED_IMAGE_SRC_RE.test(src)) return undefined
  const width = Number(node.attribs.width)
  const height = Number(node.attribs.height)
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return undefined
  return { kind: 'image', src, width, height }
}

/**
 * Flattens an inline run into styled text tokens, unwrapping inline elements.
 * Image nodes are detected before the ordinary inline/default recursion so
 * leaf image nodes are never silently dropped.
 */
function flattenInline(nodes: AnyNode[] | undefined, ctx: InlineContext, extra: InlineStyle = {}): InlineToken[] {
  const tokens: InlineToken[] = []
  for (const node of nodes ?? []) {
    if (isText(node)) {
      tokens.push({ kind: 'text', text: node.data, ctx, extra })
    } else if (isElement(node)) {
      if (node.name === 'img') {
        const image = trustedImageToken(node)
        if (image) tokens.push(image)
        continue
      }
      switch (node.name) {
        case 'strong':
          tokens.push(...flattenInline(node.children, { bold: true, italic: ctx.italic }, extra))
          break
        case 'em':
          tokens.push(...flattenInline(node.children, { bold: ctx.bold, italic: true }, extra))
          break
        case 'del':
          tokens.push(...flattenInline(node.children, ctx, { ...extra, del: true }))
          break
        case 'code':
          tokens.push({ kind: 'text', text: textOf(node), ctx, extra: { ...extra, code: true } })
          break
        case 'a':
          tokens.push(...flattenInline(node.children, ctx, { ...extra, link: true }))
          break
        case 'br':
          tokens.push({ kind: 'break' })
          break
        default:
          // Unknown inline tags are unwrapped, preserving their content.
          tokens.push(...flattenInline(node.children, ctx, extra))
      }
    }
  }
  return tokens
}

/**
 * Applies HTML whitespace semantics to a flat inline run: runs of whitespace
 * collapse to a single space, whitespace at the run's edges or around a hard
 * break disappears, and line breaks come only from `<br>` tokens. Whitespace
 * between inline elements (e.g. `Hello<strong> world</strong>`) is preserved.
 */
export function normalizeTokens(tokens: InlineToken[]): InlineToken[] {
  const out: InlineToken[] = []
  let pendingSpace = false
  let atEdge = true // start of the run or directly after a hard break
  for (const token of tokens) {
    if (token.kind === 'break') {
      // Whitespace adjacent to a hard break collapses away (HTML semantics),
      // so `<br>\n` in the template cannot produce a blank line.
      pendingSpace = false
      atEdge = true
      out.push(token)
      continue
    }
    if (token.kind === 'image') {
      // Images are content: whitespace before/after is normalized by the
      // surrounding text tokens, not the image itself.
      out.push(token)
      atEdge = false
      continue
    }
    const collapsed = token.text.replace(/[ \t\n\r\f]+/g, ' ')
    const trimmed = collapsed.trim()
    if (!trimmed) {
      // Whitespace-only text contributes a collapsible space between content.
      if (!atEdge) pendingSpace = true
      continue
    }
    let text = trimmed
    if (pendingSpace) {
      text = ` ${text}`
    } else if (!atEdge && collapsed.startsWith(' ')) {
      // Leading whitespace on this token (e.g. `Hello<strong> world</strong>`)
      // survives mid-run; only block edges and hard breaks drop it.
      text = ` ${text}`
    }
    out.push({ ...token, text })
    pendingSpace = collapsed.endsWith(' ')
    atEdge = false
  }
  // A trailing pending space sits at the block edge and disappears.
  return out
}

function tokenStyle(ctx: InlineContext, extra: InlineStyle): Style[] {
  const style: Style[] = [{ fontFamily: resolveInlineFontFamily(ctx) }]
  if (extra.del) style.push(styles.del)
  if (extra.code) style.push(styles.code)
  if (extra.link) style.push(styles.link)
  return style
}

const ALIGN_TO_MAIN: Record<'left' | 'center' | 'right', 'flex-start' | 'center' | 'flex-end'> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
}

/** Strips block margins so they apply once on the image container, not per segment. */
function withoutBlockMargins(style: Style): Style {
  const { marginTop, marginBottom, marginVertical, margin, ...rest } = style as Record<string, unknown>
  return rest as Style
}

/** Splits a token run at hard breaks, dropping empty leading/trailing lines. */
function splitInlineLines(tokens: InlineToken[]): InlineToken[][] {
  const lines: InlineToken[][] = []
  let current: InlineToken[] = []
  const flush = () => {
    if (current.length) {
      lines.push(current)
    } else if (lines.length) {
      lines.push([]) // preserve a middle blank line
    }
    current = []
  }
  for (const token of tokens) {
    if (token.kind === 'break') flush()
    else current.push(token)
  }
  if (current.length) flush()
  if (!lines.length) lines.push([])
  return lines
}

export type LineSegment =
  | { kind: 'text'; tokens: TextInlineToken[] }
  | { kind: 'image'; token: ImageInlineToken }

function textToken(text: string, ctx: InlineContext = { bold: false, italic: false }, extra: InlineStyle = {}): TextInlineToken {
  return { kind: 'text', text, ctx, extra }
}

/**
 * Normalizes one text run of an image-bearing line. Whitespace at the run's
 * outer edges drops like block-edge whitespace, but whitespace adjacent to an
 * image is a real separator and is kept as a single space on the image side.
 */
function normalizeTextRun(tokens: TextInlineToken[], imageBefore: boolean, imageAfter: boolean): TextInlineToken[] {
  const normalized = normalizeTokens(tokens).filter((token): token is TextInlineToken => token.kind === 'text')
  if (!normalized.length) {
    // Whitespace-only run: only meaningful between two images.
    return imageBefore && imageAfter ? [textToken(' ')] : []
  }
  const startsWithWhitespace = /^\s/.test(tokens[0]?.text ?? '')
  const endsWithWhitespace = /\s$/.test(tokens[tokens.length - 1]?.text ?? '')
  const first = normalized[0]!
  const last = normalized[normalized.length - 1]!
  let out = normalized
  if (imageBefore && startsWithWhitespace) out = [textToken(' ', first.ctx, first.extra), ...out]
  if (imageAfter && endsWithWhitespace) out = [...out, textToken(' ', last.ctx, last.extra)]
  return out
}

/**
 * Orders a line's content into text segments and images in the original
 * token order. Each text run between images is normalized independently, so
 * whitespace stays on its own side of an adjacent image. Exported for unit
 * tests.
 */
export function orderLineSegments(tokens: InlineToken[]): LineSegment[] {
  const parts: Array<{ kind: 'text'; tokens: TextInlineToken[] } | { kind: 'image'; token: ImageInlineToken }> = []
  let textRun: TextInlineToken[] = []
  const flushText = () => {
    if (textRun.length) {
      parts.push({ kind: 'text', tokens: textRun })
      textRun = []
    }
  }
  for (const token of tokens) {
    if (token.kind === 'image') {
      flushText()
      parts.push({ kind: 'image', token })
    } else if (token.kind === 'text') {
      // Lines never contain breaks (they are split before this), so only
      // text tokens can reach the run.
      textRun.push(token)
    }
  }
  flushText()

  return parts.flatMap((part, index): LineSegment[] => {
    if (part.kind === 'image') return [part]
    const imageBefore = index > 0 && parts[index - 1]!.kind === 'image'
    const imageAfter = index < parts.length - 1 && parts[index + 1]!.kind === 'image'
    const tokens = normalizeTextRun(part.tokens, imageBefore, imageAfter)
    return tokens.length ? [{ kind: 'text', tokens }] : []
  })
}

/**
 * Renders one line of an image-bearing run: `<Text>` segments and sibling
 * `<Image>` elements in a row, aligned per the inherited text-align, in the
 * original token order (text before and after an image stays in place). The
 * images never sit inside a `<Text>`.
 */
function renderImageLine(
  tokens: InlineToken[],
  keyPrefix: string,
  textStyle: Style[],
  align: 'left' | 'center' | 'right'
): React.ReactNode | null {
  const segments = orderLineSegments(tokens)
  if (!segments.length) return null

  const children = segments.map((segment, index) => {
    if (segment.kind === 'image') {
      return (
        <Image
          key={`${keyPrefix}-image-${index}`}
          src={segment.token.src}
          style={{ width: segment.token.width, height: segment.token.height, objectFit: 'contain' }}
        />
      )
    }
    return (
      <Text key={`${keyPrefix}-text-${index}`} style={[...textStyle, { textAlign: align }]}>
        {segment.tokens.map((token, tokenIndex) => (
          <Text key={`${keyPrefix}-seg-${tokenIndex}`} style={tokenStyle(token.ctx, token.extra)}>
            {token.text}
          </Text>
        ))}
      </Text>
    )
  })
  return (
    <View key={keyPrefix} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: ALIGN_TO_MAIN[align], flexWrap: 'wrap' }}>
      {children}
    </View>
  )
}

/**
 * Renders a flattened inline run. Text-only runs render exactly as before —
 * one `<Text>` with `\n` for hard breaks. Runs containing trusted images
 * render as a container of per-line rows: `<Text>` segments and sibling
 * `<Image>` elements, with the node-derived dimensions and the inherited
 * text-align mapped to row alignment.
 */
function renderInlineTokens(
  tokens: InlineToken[],
  keyPrefix: string,
  textStyle: Style[],
  align: 'left' | 'center' | 'right',
  containerStyle: Style[] = [],
  outerKey?: string
): React.ReactElement | null {
  if (!tokens.some((token) => token.kind === 'image')) {
    const normalized = normalizeTokens(tokens)
    if (!normalized.length) return null
    return (
      <Text key={outerKey} style={[...textStyle, { textAlign: align }]}>
        {normalized.map((token, index) => {
          // Text-only runs never contain images; anything that is not text is a break.
          if (token.kind !== 'text') return '\n'
          return (
            <Text key={`${keyPrefix}-${index}`} style={tokenStyle(token.ctx, token.extra)}>
              {token.text}
            </Text>
          )
        })}
      </Text>
    )
  }

  const segmentStyle = textStyle.map(withoutBlockMargins)
  const lines = splitInlineLines(tokens)
  const rendered: React.ReactNode[] = []
  lines.forEach((line, index) => {
    const lineNode = renderImageLine(line, `${keyPrefix}-line-${index}`, segmentStyle, align)
    if (lineNode !== null) rendered.push(lineNode)
  })
  if (!rendered.length) return null
  return (
    <View key={outerKey} style={containerStyle}>
      {rendered}
    </View>
  )
}

/** Renders a run of inline content as one paragraph; null when it is empty after normalization. */
function renderParagraph(
  nodes: AnyNode[] | undefined,
  key: string,
  inList: boolean,
  blockCtx: BlockContext
): React.ReactElement | null {
  const paragraphStyle = inList ? styles.listParagraph : styles.paragraph
  const tokens = flattenInline(nodes ?? [], { bold: false, italic: false })
  return renderInlineTokens(tokens, `${key}-inline`, [paragraphStyle], blockCtx.textAlign, [paragraphStyle], key)
}

/**
 * Renders a block container's children, grouping consecutive inline children
 * into a single paragraph so inline formatting (strong/em/...) is preserved.
 */
function renderBlockChildren(
  nodes: AnyNode[] | undefined,
  keyPrefix: string,
  inList: boolean,
  blockCtx: BlockContext
): React.ReactElement[] {
  if (!Array.isArray(nodes)) return []
  const views: React.ReactElement[] = []
  let inlineRun: AnyNode[] = []
  const flush = () => {
    if (!inlineRun.length) return
    const paragraph = renderParagraph(inlineRun, `${keyPrefix}-inline-${views.length}`, inList, blockCtx)
    if (paragraph != null) views.push(paragraph)
    inlineRun = []
  }
  for (const node of nodes) {
    if (isInlineNode(node)) {
      inlineRun.push(node)
    } else {
      flush()
      views.push(...renderBlocks([node], `${keyPrefix}-block-${views.length}`, inList, blockCtx))
    }
  }
  flush()
  return views
}

function renderTableCell(cell: Element, key: string, isHeader: boolean, align: 'left' | 'center' | 'right') {
  const style: Style[] = isHeader
    ? [styles.tableCellText, styles.tableHeaderText]
    : [styles.tableCellText]

  const tokens = flattenInline(cell.children ?? [], { bold: isHeader, italic: false })
  return renderInlineTokens(tokens, `${key}-inline`, style, align)
}

/**
 * Collects table rows with their containing section (thead/tbody/tfoot), so
 * the section's inherited text-align is not lost when rendering cells.
 */
function collectTableRows(table: Element): Array<{ row: Element; section: Element | undefined }> {
  const rows: Array<{ row: Element; section: Element | undefined }> = []
  for (const child of table.children) {
    if (isElement(child)) {
      if (child.name === 'tr') {
        rows.push({ row: child, section: undefined })
      } else if (child.name === 'thead' || child.name === 'tbody' || child.name === 'tfoot') {
        for (const row of child.children) {
          if (isElement(row, 'tr')) rows.push({ row, section: child })
        }
      }
    }
  }
  return rows
}

function cellsOf(row: Element): Element[] {
  return row.children.filter((cell) => isElement(cell) && (cell.name === 'th' || cell.name === 'td')) as Element[]
}

export type TableCellModel = {
  cell: Element | null;
  isHeader: boolean;
  align: 'left' | 'center' | 'right';
};

/**
 * Pure row model for one table row: pads the row to `columnCount` (short rows
 * get null cells so uneven rows keep consistent column widths), styles cells
 * by their own tag (`<th>` is a header wherever it appears, `<td>` never is),
 * and resolves text alignment through the HTML inheritance chain:
 * cell → row → section (thead/tbody/tfoot) → table.
 */
export function tableRowModel(
  cells: Element[],
  columnCount: number,
  row: Element,
  section: Element | undefined,
  tableAlign: 'left' | 'center' | 'right'
): TableCellModel[] {
  const rowAlign = textAlignOf(row) ?? (section ? textAlignOf(section) ?? tableAlign : tableAlign)
  return Array.from({ length: columnCount }, (_, index) => {
    const cell = cells[index] ?? null
    return {
      cell,
      isHeader: cell !== null && cell.name === 'th',
      align: cell ? textAlignOf(cell) ?? rowAlign : rowAlign,
    }
  })
}

/** Renders one table row from its `tableRowModel` entries. */
function renderRowCells(
  cells: Element[],
  columnCount: number,
  keyPrefix: string,
  row: Element,
  section: Element | undefined,
  tableAlign: 'left' | 'center' | 'right'
): React.ReactNode[] {
  return tableRowModel(cells, columnCount, row, section, tableAlign).map(({ cell, isHeader, align }, index) => {
    const cellKey = `${keyPrefix}-cell-${index}`
    const base: Style[] = isHeader ? [styles.tableCell, styles.tableHeaderCell] : [styles.tableCell]
    const style = index === columnCount - 1 ? [...base, styles.tableLastCell] : base
    if (!cell) return <View key={cellKey} style={style} />
    return (
      <View key={cellKey} style={style}>
        {renderTableCell(cell, cellKey, isHeader, align)}
      </View>
    )
  })
}

function renderBlocks(
  nodes: AnyNode[] | undefined,
  keyPrefix: string,
  inList = false,
  blockCtx: BlockContext = { textAlign: 'left' }
): React.ReactElement[] {
  if (!Array.isArray(nodes)) return []

  return nodes.flatMap((node, index): React.ReactElement[] => {
    const key = `${keyPrefix}-${index}`

    if (isText(node)) {
      if (!node.data.trim()) return []
      const rendered = renderParagraph([node], key, inList, blockCtx)
      return rendered ? [rendered] : []
    }

    if (!isElement(node)) return []

    const align = textAlignOf(node) ?? blockCtx.textAlign

    if (node.name === 'h1' || node.name === 'h2' || node.name === 'h3') {
      const headingStyle = node.name === 'h1' ? styles.heading1 : node.name === 'h2' ? styles.heading2 : styles.heading3
      const tokens = flattenInline(node.children ?? [], { bold: true, italic: false })
      const content = renderInlineTokens(tokens, `${key}-inline`, [headingStyle], align, [headingStyle], key)
      return content ? [content] : []
    }

    if (node.name === 'p') {
      const rendered = renderParagraph(node.children, key, inList, { textAlign: align })
      return rendered ? [rendered] : []
    }

    if (node.name === 'div') {
      return [(
        <View key={key} style={align === 'center' ? styles.centerBlock : undefined}>
          {renderBlockChildren(node.children, `${key}-div`, inList, { textAlign: align })}
        </View>
      )]
    }

    if (node.name === 'ul' || node.name === 'ol') {
      const ordered = node.name === 'ol'
      const start = ordered ? parseInt(node.attribs.start || '', 10) || 1 : 1
      const items = node.children.filter((item) => isElement(item, 'li')) as Element[]

      return [(
        <View key={key} style={styles.list}>
          {items.map((item, itemIndex) => {
            const bulletLabel = ordered ? `${itemIndex + start}.` : '•'
            // Items inherit the list's calculated alignment (like text-align in HTML).
            const itemAlign = textAlignOf(item) ?? align
            return (
              <View key={`${key}-item-${itemIndex}`} style={styles.listItem}>
                <Text style={styles.listBullet}>{bulletLabel}</Text>
                <View style={styles.listContent}>
                  {renderBlockChildren(item.children, `${key}-item-${itemIndex}`, true, { textAlign: itemAlign })}
                </View>
              </View>
            )
          })}
        </View>
      )]
    }

    if (node.name === 'table') {
      const rows = collectTableRows(node)
      if (!rows.length) return []
      const columnCount = Math.max(1, ...rows.map(({ row }) => cellsOf(row).length))

      return [(
        <View key={key} style={styles.table}>
          {rows.map(({ row, section }, rowIndex) => (
            <View
              key={`${key}-row-${rowIndex}`}
              style={rowIndex === rows.length - 1 ? [styles.tableRow, styles.tableLastRow] : styles.tableRow}
            >
              {renderRowCells(cellsOf(row), columnCount, `${key}-row-${rowIndex}`, row, section, align)}
            </View>
          ))}
        </View>
      )]
    }

    if (node.name === 'blockquote') {
      return [(
        <View key={key} style={{ borderLeftWidth: 3, borderLeftColor: '#9ca3af', paddingLeft: 8, marginBottom: 8 }}>
          {renderBlockChildren(node.children, `${key}-blockquote`, inList, { textAlign: align })}
        </View>
      )]
    }

    if (node.name === 'hr') {
      return [<View key={key} style={styles.hr} />]
    }

    // Unknown block-level tags: walk children, grouping inline runs, and
    // inherit the element's calculated alignment.
    return renderBlockChildren(node.children, key, inList, { textAlign: align })
  })
}

function ReceiptPage({ document, index }: { document: DomDocument; index: number }) {
  return <Page size="LETTER" style={styles.page}>{renderBlockChildren(document.children, `page-${index}`, false, { textAlign: 'left' })}</Page>
}

export default function DonationReceiptsPdfDocument({ receipts }: { receipts?: DomDocument[] }) {
  const items = Array.isArray(receipts) ? receipts : []

  return (
    <Document>
      {items.length
        ? items.map((document, index) => <ReceiptPage key={`receipt-${index}`} document={document} index={index} />)
        : (
          <Page size="LETTER" style={styles.page}>
            <Text style={styles.empty}>No donor receipts available.</Text>
          </Page>
        )}
    </Document>
  )
}

export async function renderDonationReceiptsPdfBase64(receipts: DomDocument[]) {
  const buffer = await renderToBuffer(<DonationReceiptsPdfDocument receipts={receipts} />)
  return buffer.toString('base64')
}
