import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
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

/** One flat inline unit: styled text, or a hard break from `<br>`. */
export type InlineToken =
  | { kind: 'text'; text: string; ctx: InlineContext; extra: InlineStyle }
  | { kind: 'break' }

const styles = StyleSheet.create({
  page: {
    paddingTop: 72,
    paddingBottom: 72,
    paddingHorizontal: 90,
    fontFamily: 'Times-Roman',
    fontSize: 12,
    color: '#000000',
    lineHeight: 1.2,
  },
  heading1: {
    fontFamily: 'Times-Bold',
    fontSize: 16,
    marginBottom: 5,
    lineHeight: 1.2,
  },
  heading2: {
    fontFamily: 'Times-Bold',
    fontSize: 16,
    marginTop: 8,
    marginBottom: 3,
    lineHeight: 1.2,
  },
  heading3: {
    fontFamily: 'Times-Bold',
    fontSize: 14,
    marginTop: 6,
    marginBottom: 3,
    lineHeight: 1.2,
  },
  paragraph: {
    fontSize: 12,
    marginBottom: 6,
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
    borderColor: '#ffffff',
    backgroundColor: '#ced7e7',
    marginTop: 9,
    marginBottom: 9,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff',
  },
  tableLastRow: {
    borderBottomWidth: 0,
  },
  tableCell: {
    borderRightWidth: 1,
    borderRightColor: '#ffffff',
    padding: 5,
  },
  tableLastCell: {
    borderRightWidth: 0,
  },
  tableHeaderCell: {
    backgroundColor: 'transparent',
  },
  tableCellText: {
    fontSize: 12,
    lineHeight: 1.2,
  },
  tableHeaderText: {
    fontFamily: 'Times-Bold',
  },
  empty: {
    fontSize: 12,
  },
  hr: {
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    marginTop: 3,
    marginBottom: 8,
  },
})

function resolveInlineFontFamily(ctx: InlineContext): string {
  if (ctx.bold && ctx.italic) return 'Times-BoldItalic'
  if (ctx.bold) return 'Times-Bold'
  if (ctx.italic) return 'Times-Italic'
  return 'Times-Roman'
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

function percentageWidthOf(node: Element): `${number}%` | undefined {
  const match = /(?:^|;)\s*width\s*:\s*((?:100|[1-9]?\d)%)(?:;|$)/i.exec(node.attribs.style || '')
  return match?.[1] as `${number}%` | undefined
}

function backgroundColorOf(node: Element): string | undefined {
  const match = /(?:^|;)\s*background-color\s*:\s*(#[0-9a-f]{6})(?:;|$)/i.exec(node.attribs.style || '')
  return match?.[1]
}

const INLINE_TAGS = new Set(['strong', 'em', 'del', 'code', 'br', 'a'])

function isInlineNode(node: AnyNode): boolean {
  if (isText(node)) return true
  return isElement(node) && INLINE_TAGS.has(node.name)
}

/** Flattens an inline run into styled text tokens, unwrapping inline elements. */
function flattenInline(nodes: AnyNode[] | undefined, ctx: InlineContext, extra: InlineStyle = {}): InlineToken[] {
  const tokens: InlineToken[] = []
  for (const node of nodes ?? []) {
    if (isText(node)) {
      tokens.push({ kind: 'text', text: node.data, ctx, extra })
    } else if (isElement(node)) {
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

function renderInlineNodes(
  nodes: AnyNode[] | undefined,
  keyPrefix: string,
  ctx: InlineContext = { bold: false, italic: false }
): React.ReactNode {
  if (!Array.isArray(nodes)) return null

  const tokens = normalizeTokens(flattenInline(nodes, ctx))
  if (!tokens.length) return null

  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`
    if (token.kind === 'break') return '\n'
    return (
      <Text key={key} style={tokenStyle(token.ctx, token.extra)}>
        {token.text}
      </Text>
    )
  })
}

/** Renders a run of inline content as one paragraph; null when it is empty after normalization. */
function renderParagraph(
  nodes: AnyNode[] | undefined,
  key: string,
  inList: boolean,
  blockCtx: BlockContext
): React.ReactNode {
  const inline = renderInlineNodes(nodes, `${key}-inline`)
  if (inline == null) return null
  return (
    <Text key={key} style={[inList ? styles.listParagraph : styles.paragraph, { textAlign: blockCtx.textAlign }]}>
      {inline}
    </Text>
  )
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
): React.ReactNode[] {
  if (!Array.isArray(nodes)) return []
  const views: React.ReactNode[] = []
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

  return (
    <Text style={[...style, { textAlign: align }]}>
      {renderInlineNodes(cell.children, `${key}-inline`, { bold: isHeader, italic: false })}
    </Text>
  )
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
  width?: `${number}%`;
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
      width: cell ? percentageWidthOf(cell) : undefined,
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
  return tableRowModel(cells, columnCount, row, section, tableAlign).map(({ cell, isHeader, align, width }, index) => {
    const cellKey = `${keyPrefix}-cell-${index}`
    const base: Style[] = isHeader ? [styles.tableCell, styles.tableHeaderCell] : [styles.tableCell]
    const sizing: Style = width
      ? { width, flexGrow: 0, flexShrink: 0 }
      : { flexGrow: 1, flexBasis: 0 }
    const cellBackground = cell ? backgroundColorOf(cell) : undefined
    const background: Style = cellBackground ? { backgroundColor: cellBackground } : {}
    const style = index === columnCount - 1
      ? [...base, styles.tableLastCell, sizing, background]
      : [...base, sizing, background]
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
): React.ReactNode[] {
  if (!Array.isArray(nodes)) return []

  return nodes.flatMap((node, index) => {
    const key = `${keyPrefix}-${index}`

    if (isText(node)) {
      if (!node.data.trim()) return []
      return [renderParagraph([node], key, inList, blockCtx)]
    }

    if (!isElement(node)) return []

    const align = textAlignOf(node) ?? blockCtx.textAlign

    if (node.name === 'h1' || node.name === 'h2' || node.name === 'h3') {
      const headingStyle = node.name === 'h1' ? styles.heading1 : node.name === 'h2' ? styles.heading2 : styles.heading3
      return [(
        <Text key={key} style={[headingStyle, { textAlign: align }]}>
          {renderInlineNodes(node.children, `${key}-inline`, { bold: true, italic: false })}
        </Text>
      )]
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
        <View key={key} style={[styles.table, { backgroundColor: backgroundColorOf(node) ?? '#ced7e7' }]}>
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
