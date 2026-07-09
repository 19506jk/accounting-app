import type { ReportType } from '@shared/contracts';

export interface ReportMeta {
  reportType: ReportType;
  title: string;
  tabName: string;
  filenamePrefix: string;
}

export const REPORT_META: Record<ReportType, ReportMeta> = {
  'pl': {
    reportType: 'pl',
    title: 'Profit & Loss',
    tabName: 'Profit & Loss',
    filenamePrefix: 'pl',
  },
  'balance-sheet': {
    reportType: 'balance-sheet',
    title: 'Balance Sheet',
    tabName: 'Balance Sheet',
    filenamePrefix: 'balance_sheet',
  },
  'ledger': {
    reportType: 'ledger',
    title: 'General Ledger',
    tabName: 'General Ledger',
    filenamePrefix: 'ledger',
  },
  'trial-balance': {
    reportType: 'trial-balance',
    title: 'Trial Balance',
    tabName: 'Trial Balance',
    filenamePrefix: 'trial_balance',
  },
  'donors-summary': {
    reportType: 'donors-summary',
    title: 'Income by Donor — Summary',
    tabName: 'Donor Summary',
    filenamePrefix: 'donor_summary',
  },
  'donors-detail': {
    reportType: 'donors-detail',
    title: 'Income by Donor — Detail',
    tabName: 'Donor Detail',
    filenamePrefix: 'donor_detail',
  },
};

export function getReportMeta(type: ReportType): ReportMeta {
  return REPORT_META[type];
}

export function getReportTypeOptions(): { value: ReportType; label: string }[] {
  return Object.values(REPORT_META).map((m) => ({
    value: m.reportType,
    label: m.title,
  }));
}
