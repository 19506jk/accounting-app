// Types imported for compile-time only — erased from JS output.
// The runtime ExcelJS module is loaded via dynamic import() on first export.
import type { Workbook, Worksheet, Cell } from 'exceljs';

// ---------------------------------------------------------------------------
// Public value types (re‑used across reports)
// ---------------------------------------------------------------------------
export type XlsxValue = string | number | boolean | null;

export type ColumnType = 'text' | 'amount' | 'date';

export interface ColumnConfig {
  width?: number;
  type?: ColumnType;
}

// ---------------------------------------------------------------------------
// Style tokens — the single source of truth for workbook appearance
// ---------------------------------------------------------------------------
export const STYLE = {
  font: {
    body: { name: 'Arial', size: 10 } as const,
    bodyBold: { name: 'Arial', size: 10, bold: true } as const,
    title: { name: 'Arial', size: 14, bold: true } as const,
  },
  fill: {
    header: {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFD6E4F0' },
    },
    section: {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFE8EEF4' },
    },
  },
  align: {
    left: {
      horizontal: 'left' as const,
      vertical: 'middle' as const,
      wrapText: false,
    },
    center: {
      horizontal: 'center' as const,
      vertical: 'middle' as const,
      wrapText: false,
    },
    right: {
      horizontal: 'right' as const,
      vertical: 'middle' as const,
      wrapText: false,
    },
  },
  border: {
    bottomThin: { bottom: { style: 'thin' as const } },
    topThin: { top: { style: 'thin' as const } },
    topMedium: { top: { style: 'medium' as const } },
  },
  numFmt: {
    accounting: '#,##0.00;(#,##0.00)',
  },
} as const;

// Muted‑gray override for metadata lines
const MUTED_COLOR = { argb: 'FF808080' };

// ---------------------------------------------------------------------------
// Lazy ExcelJS loader
// ---------------------------------------------------------------------------
let _ExcelJS: any = null;

async function getExcelJS(): Promise<any> {
  if (_ExcelJS) return _ExcelJS;
  const mod = await import('exceljs');
  _ExcelJS = (mod as any).default ?? mod;
  return _ExcelJS;
}

// ---------------------------------------------------------------------------
// ReportSheetBuilder
// ---------------------------------------------------------------------------
export class ReportSheetBuilder {
  private ws: Worksheet;
  private row = 1; // ExcelJS rows are 1‑indexed
  private colCount: number;
  private colTypes: ColumnType[];
  private frozenRow: number | null = null;

  constructor(
    ws: Worksheet,
    colCount: number,
    colConfigs: (ColumnConfig | null)[] = [],
  ) {
    this.ws = ws;
    this.colCount = colCount;
    this.colTypes = Array.from(
      { length: colCount },
      (_, i) => colConfigs[i]?.type ?? 'text',
    );
  }

  // ---- Layout control ------------------------------------------------

  /**
   * Mark the *next* row as the freeze split point. Call right before the
   * first data row (i.e. after title + metadata + column headers).
   */
  freezeHere(): void {
    this.frozenRow = this.row;
  }

  /**
   * Apply column widths and frozen‑pane settings.  Must be called once after
   * all rows have been added.
   */
  finish(colWidths?: number[]): void {
    if (colWidths) {
      for (let c = 0; c < colWidths.length && c < this.colCount; c++) {
        const w = colWidths[c];
        if (w !== undefined && w > 0) {
          this.ws.getColumn(c + 1).width = w;
        }
      }
    }
    if (this.frozenRow !== null && this.frozenRow > 1) {
      this.ws.views = [
        { state: 'frozen', xSplit: 0, ySplit: this.frozenRow - 1 },
      ];
    }
  }

  getWorksheet(): Worksheet {
    return this.ws;
  }

  getCurrentRow(): number {
    return this.row;
  }

  // ---- Row helpers ---------------------------------------------------

  /**
   * Title row — 14pt bold Arial, merged across all columns.
   */
  title(text: string): void {
    const cell = this.ws.getCell(this.row, 1);
    cell.value = text;
    cell.font = { ...STYLE.font.title };
    cell.alignment = { ...STYLE.align.left };
    this.ws.mergeCells(this.row, 1, this.row, this.colCount);
    this.row++;
  }

  /**
   * Metadata row e.g. "Period: 2026-01-01 to 2026-03-31".
   * 10pt Arial with muted colour.
   */
  metadata(text: string): void {
    const cell = this.ws.getCell(this.row, 1);
    cell.value = text;
    cell.font = { ...STYLE.font.body, color: MUTED_COLOR };
    cell.alignment = { ...STYLE.align.left };
    this.row++;
  }

  blankRow(): void {
    this.row++;
  }

  /**
   * Column header row — bold, shaded fill, bottom border.
   */
  headerRow(headers: (string | null)[]): void {
    for (let c = 0; c < this.colCount; c++) {
      const cell = this.ws.getCell(this.row, c + 1);
      cell.value = headers[c] ?? '';
      cell.font = { ...STYLE.font.bodyBold };
      cell.fill = { ...STYLE.fill.header };
      cell.alignment = { ...STYLE.align.center };
      cell.border = { ...STYLE.border.bottomThin };
    }
    this.row++;
  }

  /**
   * Section header (e.g. INCOME, EXPENSES).  Bold, uppercase, shaded band.
   */
  sectionHeader(text: string): void {
    const cell = this.ws.getCell(this.row, 1);
    cell.value = text.toUpperCase();
    cell.font = { ...STYLE.font.bodyBold };
    cell.fill = { ...STYLE.fill.section };
    cell.alignment = { ...STYLE.align.left };
    this.ws.mergeCells(this.row, 1, this.row, this.colCount);
    this.row++;
  }

  /**
   * A regular data / transaction row.
   *
   * `opts.indent` applies Excel cell‑level indentation to the column at
   * `opts.indentCol` (0‑based).  Useful for synthetic accounts and indented
   * account lines.
   */
  dataRow(
    values: XlsxValue[],
    opts?: { indentCol?: number; indent?: number },
  ): void {
    for (let c = 0; c < this.colCount; c++) {
      const cell = this.ws.getCell(this.row, c + 1);
      const value = values[c] ?? '';
      cell.value = value;
      cell.font = { ...STYLE.font.body };
      this.applyCellFormat(cell, c, value);
      if (
        opts?.indentCol !== undefined &&
        c === opts.indentCol &&
        opts?.indent !== undefined
      ) {
        cell.alignment = { ...cell.alignment, indent: opts.indent };
      }
    }
    this.row++;
  }

  /**
   * A total or subtotal row.  Bold with a top border.
   * Set `grandTotal: true` for a double‑strength (medium) top border.
   */
  totalRow(values: XlsxValue[], opts?: { grandTotal?: boolean }): void {
    for (let c = 0; c < this.colCount; c++) {
      const cell = this.ws.getCell(this.row, c + 1);
      const value = values[c] ?? '';
      cell.value = value;
      cell.font = { ...STYLE.font.bodyBold };
      cell.border = opts?.grandTotal
        ? { ...STYLE.border.topMedium }
        : { ...STYLE.border.topThin };
      this.applyCellFormat(cell, c, value);
    }
    this.row++;
  }

  /**
   * Status row (e.g. "Balanced YES").  Bold, no extra border.
   */
  statusRow(values: XlsxValue[]): void {
    for (let c = 0; c < this.colCount; c++) {
      const cell = this.ws.getCell(this.row, c + 1);
      cell.value = values[c] ?? '';
      cell.font = { ...STYLE.font.bodyBold };
    }
    this.row++;
  }

  // ---- Internal ------------------------------------------------------

  private applyCellFormat(cell: Cell, colIndex: number, value: XlsxValue): void {
    const colType = this.colTypes[colIndex];
    if (colType === 'amount') {
      if (typeof value === 'number') {
        cell.numFmt = STYLE.numFmt.accounting;
      }
      cell.alignment = { ...STYLE.align.right };
    } else if (colType === 'date') {
      cell.alignment = { ...STYLE.align.center };
    } else {
      cell.alignment = { ...STYLE.align.left };
    }
  }
}

// ---------------------------------------------------------------------------
// Workbook factory (async – lazy‑loads ExcelJS)
// ---------------------------------------------------------------------------

/**
 * Create a new ExcelJS Workbook.  The ExcelJS module is loaded on the first
 * call and cached thereafter.
 */
export async function createWorkbook(): Promise<Workbook> {
  const ExcelJS = await getExcelJS();
  return new ExcelJS.Workbook();
}

/**
 * Add a styled worksheet to an existing workbook.
 *
 * `buildFn` receives a {@link ReportSheetBuilder} to populate the sheet.
 * Returns the builder so callers can inspect it (e.g. in tests).
 */
export function addSheetToWorkbook(
  workbook: Workbook,
  sheetName: string,
  colCount: number,
  colConfigs: (ColumnConfig | null)[],
  buildFn: (builder: ReportSheetBuilder) => void,
  colWidths?: number[],
): ReportSheetBuilder {
  const ws = workbook.addWorksheet(sheetName);
  const builder = new ReportSheetBuilder(ws, colCount, colConfigs);
  buildFn(builder);
  builder.finish(colWidths);
  return builder;
}

// ---------------------------------------------------------------------------
// Serialization & download
// ---------------------------------------------------------------------------

/**
 * Serialize a workbook to an ArrayBuffer (useful for tests).
 */
export async function workbookToBuffer(
  workbook: Workbook,
): Promise<ArrayBuffer> {
  return (workbook as any).xlsx.writeBuffer();
}

/**
 * Write the workbook to an .xlsx Blob and trigger a browser download.
 */
export async function downloadWorkbook(
  workbook: Workbook,
  filename: string,
): Promise<void> {
  const buffer = await workbookToBuffer(workbook);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
