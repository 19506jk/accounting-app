import Button from '../../components/ui/Button';
import type React from 'react';
import type { ReportDiagnostic } from '@shared/contracts';

interface DiagnosticsPanelProps {
  diagnostics: ReportDiagnostic[];
  onInvestigate?: (item: ReportDiagnostic) => void;
}

interface DiagnosticGroupStyle {
  border: string;
  background: string;
  headingColor: string;
  textColor: string;
  title: string;
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

interface LineItemProps {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
  valueColor?: string;
}

export function DiagnosticsPanel({ diagnostics, onInvestigate }: DiagnosticsPanelProps) {
  const warnings = (diagnostics || []).filter((d) => d.severity === 'warning')
  const infos = (diagnostics || []).filter((d) => d.severity === 'info')

  const renderGroup = (items: ReportDiagnostic[], { border, background, headingColor, textColor, title }: DiagnosticGroupStyle) => {
    if (!items.length) return null
    return (
      <div style={{
        border: `1px solid ${border}`,
        background,
        borderRadius: '8px',
        padding: '0.75rem 0.9rem',
        marginBottom: '0.6rem',
      }}>
        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: headingColor, marginBottom: '0.4rem' }}>
          {title}
        </div>
        {items.map((item, idx) => (
          <div key={`${item.code}-${item.fund_id ?? 'none'}-${idx}`} style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            padding: '0.3rem 0',
          }}>
            <div style={{ fontSize: '0.82rem', color: textColor }}>{item.message}</div>
            {item.investigate_filters && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onInvestigate?.(item)}
              >
                Investigate
              </Button>
            )}
          </div>
        ))}
      </div>
    )
  }

  if (!warnings.length && !infos.length) return null

  return (
    <div style={{ marginBottom: '0.9rem' }}>
      {renderGroup(warnings, {
        border: '#fde68a',
        background: '#fffbeb',
        headingColor: '#92400e',
        textColor: '#78350f',
        title: 'Warnings',
      })}
      {renderGroup(infos, {
        border: '#bfdbfe',
        background: '#eff6ff',
        headingColor: '#1d4ed8',
        textColor: '#1e40af',
        title: 'Notes',
      })}
    </div>
  )
}

export function Section({ title, children }: SectionProps) {
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div style={{ fontWeight: 700, fontSize: '0.75rem', color: '#6b7280',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        borderBottom: '1px solid #e5e7eb', paddingBottom: '0.35rem', marginBottom: '0.5rem' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export function LineItem({ label, value, bold = false, valueColor }: LineItemProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between',
      padding: '0.3rem 0', fontSize: '0.875rem' }}>
      <span style={{ fontWeight: bold ? 600 : 400, color: '#374151' }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 400, color: valueColor || '#1e293b' }}>{value}</span>
    </div>
  );
}
