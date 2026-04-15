import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { marked } from 'marked'
import type React from 'react'
import type { Tokens } from 'marked'
import type { Style } from '@react-pdf/types'

type InlineContext = {
  bold: boolean
  italic: boolean
}

type BlockContext = {
  textAlign: 'left' | 'center'
}

type CenterToken = {
  type: 'center'
  tokens: MarkdownToken[]
}

type MarkdownToken = {
  type?: string
  text?: string
  raw?: string
  href?: string
  depth?: number
  tokens?: MarkdownToken[]
  ordered?: boolean
  start?: number
  items?: MarkdownToken[]
  header?: TableCell[]
  rows?: TableCell[][]
}

type BlockToken = MarkdownToken | CenterToken
type InlineToken = MarkdownToken | string
type TableCell = Tokens.TableCell | string | { text?: string; tokens?: MarkdownToken[] }

const styles = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingBottom: 54,
    paddingHorizontal: 54,
    fontFamily: 'Helvetica',
    fontSize: 11,
    color: '#111827',
    lineHeight: 1.45,
  },
  heading1: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 22,
    marginBottom: 14,
    lineHeight: 1.25,
  },
  heading2: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 16,
    marginTop: 10,
    marginBottom: 8,
    lineHeight: 1.25,
  },
  heading3: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 6,
    lineHeight: 1.25,
  },
  paragraph: {
    fontSize: 11,
    marginBottom: 8,
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
    borderColor: '#d1d5db',
    marginBottom: 10,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#d1d5db',
  },
  tableLastRow: {
    borderBottomWidth: 0,
  },
  tableCell: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: '#d1d5db',
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  tableLastCell: {
    borderRightWidth: 0,
  },
  tableHeaderCell: {
    backgroundColor: '#f3f4f6',
  },
  tableCellText: {
    fontSize: 10,
    lineHeight: 1.4,
  },
  tableHeaderText: {
    fontFamily: 'Helvetica-Bold',
  },
  empty: {
    fontSize: 12,
  },
  hr: {
    borderBottomWidth: 1,
    borderBottomColor: '#9ca3af',
    marginTop: 6,
    marginBottom: 10,
  },
})

function splitTextWithBreaks(text: unknown): string[] {
  const value = String(text || '')
  const lines = value.split('\n')
  const chunks: string[] = []

  lines.forEach((line, index) => {
    if (index > 0) chunks.push('\n')
    chunks.push(line)
  })

  return chunks
}

function resolveInlineFontFamily(ctx: InlineContext): string {
  if (ctx.bold && ctx.italic) return 'Helvetica-BoldOblique'
  if (ctx.bold) return 'Helvetica-Bold'
  if (ctx.italic) return 'Helvetica-Oblique'
  return 'Helvetica'
}

function renderInlineText(
  text: unknown,
  keyPrefix: string,
  ctx: InlineContext,
  extraStyle?: Style
): React.ReactNode[] {
  const chunks = splitTextWithBreaks(text)
  return chunks.map((chunk, index) => (
    <Text
      key={`${keyPrefix}-${index}`}
      style={extraStyle
        ? [{ fontFamily: resolveInlineFontFamily(ctx) }, extraStyle]
        : { fontFamily: resolveInlineFontFamily(ctx) }}
    >
      {chunk}
    </Text>
  ))
}

function renderInlineTokens(
  tokens: InlineToken[] | undefined,
  keyPrefix: string,
  ctx: InlineContext = { bold: false, italic: false }
): React.ReactNode {
  if (!Array.isArray(tokens)) return null

  return tokens.flatMap((token, index) => {
    const key = `${keyPrefix}-${index}`

    if (!token || typeof token !== 'object') {
      return renderInlineText(String(token || ''), key, ctx)
    }

    if (token.type === 'text' || token.type === 'escape') {
      return renderInlineText(token.text || '', key, ctx)
    }

    if (token.type === 'strong') {
      return renderInlineTokens(
        token.tokens || [{ type: 'text', text: token.text || '' }],
        `${key}-strong`,
        { bold: true, italic: ctx.italic },
      )
    }

    if (token.type === 'em') {
      return renderInlineTokens(
        token.tokens || [{ type: 'text', text: token.text || '' }],
        `${key}-em`,
        { bold: ctx.bold, italic: true },
      )
    }

    if (token.type === 'del') {
      return (
        <Text key={key} style={styles.del}>
          {renderInlineTokens(token.tokens || [{ type: 'text', text: token.text || '' }], `${key}-del`, ctx)}
        </Text>
      )
    }

    if (token.type === 'codespan') {
      return (
        <Text key={key} style={styles.code}>
          {token.text || ''}
        </Text>
      )
    }

    if (token.type === 'br') {
      return '\n'
    }

    if (token.type === 'link') {
      return (
        <Text key={key} style={styles.link}>
          {renderInlineTokens(token.tokens || [{ type: 'text', text: token.text || token.href || '' }], `${key}-link`, ctx)}
        </Text>
      )
    }

    return renderInlineText(token.text || '', key, ctx)
  })
}

function renderTableCell(cell: TableCell, key: string, isHeader: boolean) {
  const tokens = typeof cell === 'object' && Array.isArray(cell?.tokens)
    ? cell.tokens as unknown as MarkdownToken[]
    : typeof cell === 'object' && cell !== null && typeof cell.text === 'string'
      ? [{ type: 'text', text: cell.text }]
      : typeof cell === 'string'
        ? [{ type: 'text', text: cell }]
        : [{ type: 'text', text: '' }]

  const style = isHeader ? [styles.tableCellText, styles.tableHeaderText] : styles.tableCellText

  return (
    <Text style={style}>
      {renderInlineTokens(tokens, `${key}-inline`, { bold: isHeader, italic: false })}
    </Text>
  )
}

function parseMarkdownBlocks(markdown: unknown): BlockToken[] {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n')
  const tokens: BlockToken[] = []
  let buffer: string[] = []
  let centerBuffer: string[] | null = null

  function flushBuffer() {
    if (!buffer.length) return
    tokens.push(...marked.lexer(buffer.join('\n'), { gfm: true, breaks: false }) as unknown as MarkdownToken[])
    buffer = []
  }

  for (const line of lines) {
    if (line.trim() === ':::center') {
      flushBuffer()
      centerBuffer = []
      continue
    }

    if (line.trim() === ':::' && centerBuffer !== null) {
      tokens.push({
        type: 'center',
        tokens: marked.lexer(centerBuffer.join('\n'), { gfm: true, breaks: false }) as unknown as MarkdownToken[],
      })
      centerBuffer = null
      continue
    }

    if (centerBuffer !== null) {
      centerBuffer.push(line)
    } else {
      buffer.push(line)
    }
  }

  if (centerBuffer !== null) {
    buffer.push(':::center', ...centerBuffer)
  }
  flushBuffer()
  return tokens
}

function renderBlocks(
  tokens: BlockToken[] | undefined,
  keyPrefix: string,
  inList = false,
  blockCtx: BlockContext = { textAlign: 'left' }
): React.ReactNode {
  if (!Array.isArray(tokens)) return null

  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`

    if (!token || token.type === 'space') return null

    if (token.type === 'center') {
      return (
        <View key={key} style={styles.centerBlock}>
          {renderBlocks(token.tokens || [], `${key}-center`, inList, { textAlign: 'center' })}
        </View>
      )
    }

    if (token.type === 'heading') {
      const headingStyle = token.depth === 1 ? styles.heading1 : token.depth === 2 ? styles.heading2 : styles.heading3
      return (
        <Text key={key} style={[headingStyle, { textAlign: blockCtx.textAlign }]}>
          {renderInlineTokens(token.tokens || [{ type: 'text', text: token.text || '' }], `${key}-inline`, { bold: true, italic: false })}
        </Text>
      )
    }

    if (token.type === 'paragraph' || token.type === 'text') {
      return (
        <Text key={key} style={[inList ? styles.listParagraph : styles.paragraph, { textAlign: blockCtx.textAlign }]}>
          {renderInlineTokens(token.tokens || [{ type: 'text', text: token.text || '' }], `${key}-inline`, { bold: false, italic: false })}
        </Text>
      )
    }

    if (token.type === 'list') {
      return (
        <View key={key} style={styles.list}>
          {(token as Tokens.List).items?.map((item, itemIndex) => {
            const bulletLabel = token.ordered ? `${itemIndex + (token.start || 1)}.` : '\u2022'
            const itemTokens = Array.isArray(item?.tokens) && item.tokens.length
              ? item.tokens as unknown as MarkdownToken[]
              : [{ type: 'text', text: item?.text || '' }]

            return (
              <View key={`${key}-item-${itemIndex}`} style={styles.listItem}>
                <Text style={styles.listBullet}>{bulletLabel}</Text>
                <View style={styles.listContent}>{renderBlocks(itemTokens, `${key}-item-${itemIndex}`, true, { textAlign: 'left' })}</View>
              </View>
            )
          })}
        </View>
      )
    }

    if (token.type === 'table') {
      const tableToken = token as Tokens.Table
      const headerCells = Array.isArray(tableToken.header) ? tableToken.header : []
      const rows = Array.isArray(tableToken.rows) ? tableToken.rows : []
      const columnCount = Math.max(1, headerCells.length, ...rows.map((row) => Array.isArray(row) ? row.length : 0))

      const normalizeRow = (row: TableCell[]) => Array.from({ length: columnCount }, (_, cellIndex) => row[cellIndex] || { text: '' })
      const normalizedHeader = normalizeRow(headerCells)
      const normalizedRows = rows.map((row) => normalizeRow(Array.isArray(row) ? row : []))

      return (
        <View key={key} style={styles.table}>
          <View style={styles.tableRow}>
            {normalizedHeader.map((cell, cellIndex) => (
              <View
                key={`${key}-header-${cellIndex}`}
                style={cellIndex === columnCount - 1
                  ? [styles.tableCell, styles.tableHeaderCell, styles.tableLastCell]
                  : [styles.tableCell, styles.tableHeaderCell]}
              >
                {renderTableCell(cell, `${key}-header-${cellIndex}`, true)}
              </View>
            ))}
          </View>
          {normalizedRows.map((row, rowIndex) => (
            <View
              key={`${key}-row-${rowIndex}`}
              style={rowIndex === normalizedRows.length - 1 ? [styles.tableRow, styles.tableLastRow] : styles.tableRow}
            >
              {row.map((cell, cellIndex) => (
                <View
                  key={`${key}-row-${rowIndex}-cell-${cellIndex}`}
                  style={cellIndex === columnCount - 1 ? [styles.tableCell, styles.tableLastCell] : styles.tableCell}
                >
                  {renderTableCell(cell, `${key}-row-${rowIndex}-cell-${cellIndex}`, false)}
                </View>
              ))}
            </View>
          ))}
        </View>
      )
    }

    if (token.type === 'blockquote') {
      return (
        <View key={key} style={{ borderLeftWidth: 3, borderLeftColor: '#9ca3af', paddingLeft: 8, marginBottom: 8 }}>
          {renderBlocks(token.tokens || [], `${key}-blockquote`, inList, blockCtx)}
        </View>
      )
    }

    if (token.type === 'hr') {
      return <View key={key} style={styles.hr} />
    }

    return (
      <Text key={key} style={[inList ? styles.listParagraph : styles.paragraph, { textAlign: blockCtx.textAlign }]}>
        {renderInlineTokens((token as MarkdownToken).tokens || [{ type: 'text', text: (token as MarkdownToken).text || '' }], `${key}-inline`, { bold: false, italic: false })}
      </Text>
    )
  })
}

function ReceiptPage({ markdown, index }: { markdown: string; index: number }) {
  const tokens = parseMarkdownBlocks(markdown)
  return <Page size="LETTER" style={styles.page}>{renderBlocks(tokens, `page-${index}`)}</Page>
}

export default function DonationReceiptsPdfDocument({ receipts }: { receipts?: string[] }) {
  const items = Array.isArray(receipts) ? receipts : []

  return (
    <Document>
      {items.length
        ? items.map((markdown, index) => <ReceiptPage key={`receipt-${index}`} markdown={markdown} index={index} />)
        : (
          <Page size="LETTER" style={styles.page}>
            <Text style={styles.empty}>No donor receipts available.</Text>
          </Page>
        )}
    </Document>
  )
}
