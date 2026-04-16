import React from 'react';
import type { TableColumn, TableRow } from './types';

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} style={{ padding: '0.75rem 1rem' }}>
          <div style={{
            height:       '0.85rem',
            background:   'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
            backgroundSize: '200% 100%',
            borderRadius: '4px',
            width:        i === 0 ? '60%' : '80%',
            animation:    'shimmer 1.4s infinite',
          }} />
        </td>
      ))}
    </tr>
  );
}

interface TableProps<Row extends TableRow> {
  columns?: TableColumn<Row>[];
  rows?: Row[];
  isLoading?: boolean;
  emptyText?: React.ReactNode;
  skeletonRows?: number;
  onRowClick?: ((row: Row) => void) | null;
  expandedId?: string | number | null;
  renderExpanded?: ((row: Row) => React.ReactNode) | null;
  rowStyle?: (row: Row) => React.CSSProperties;
}

export default function Table<Row extends TableRow>({
  columns      = [],
  rows         = [],
  isLoading    = false,
  emptyText    = 'No data found.',
  skeletonRows = 4,
  onRowClick   = null,   // (row) => void  — makes rows clickable
  expandedId   = null,   // row.id currently expanded
  renderExpanded = null, // (row) => ReactNode — inline detail panel
  rowStyle,
}: TableProps<Row>) {
  const colCount = columns.length;
  const clickable = typeof onRowClick === 'function';

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{
        width:          '100%',
        borderCollapse: 'collapse',
        fontSize:       '0.875rem',
      }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{
                  padding:       '0.65rem 1rem',
                  textAlign:     col.align || 'left',
                  fontWeight:    600,
                  color:         '#6b7280',
                  fontSize:      '0.775rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  whiteSpace:    'nowrap',
                }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: skeletonRows }).map((_, i) => (
                <SkeletonRow key={i} cols={colCount} />
              ))
            : rows.length === 0
              ? (
                <tr>
                  <td
                    colSpan={colCount}
                    style={{
                      padding:   '2.5rem',
                      textAlign: 'center',
                      color:     '#9ca3af',
                      fontSize:  '0.875rem',
                    }}
                  >
                    {emptyText}
                  </td>
                </tr>
              )
              : rows.map((row, i) => {
                  const rowId = 'id' in row ? row.id as string | number | undefined : undefined;
                  const isExpanded = expandedId === (rowId ?? i);
                  return (
                    <React.Fragment key={rowId ?? i}>
                      <tr
                        onClick={clickable ? () => onRowClick(row) : undefined}
                        style={{
                          borderBottom: isExpanded ? 'none' : '1px solid #f3f4f6',
                          transition:   'background 0.1s',
                          cursor:       clickable ? 'pointer' : 'default',
                          ...rowStyle?.(row),
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#fafafa'}
                        onMouseLeave={(e) => e.currentTarget.style.background = isExpanded ? '#f8fafc' : 'transparent'}
                      >
                        {columns.map((col) => (
                          <td
                            key={col.key}
                            style={{
                              padding:   '0.75rem 1rem',
                              color:     '#1e293b',
                              textAlign: col.align || 'left',
                              whiteSpace: col.wrap ? 'normal' : 'nowrap',
                            }}
                          >
                            {col.render
                              ? col.render(row)
                              : (row as Record<string, React.ReactNode>)[col.key]}
                          </td>
                        ))}
                      </tr>

                      {/* Inline expanded detail row */}
                      {isExpanded && renderExpanded && (
                        <tr>
                          <td
                            colSpan={colCount}
                            style={{ padding: 0, borderBottom: '1px solid #f3f4f6' }}
                          >
                            {renderExpanded(row)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
          }
        </tbody>
      </table>
      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
