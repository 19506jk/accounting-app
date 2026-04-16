import { useState } from 'react';
import {
  usePLReport, useBalanceSheetReport, useLedgerReport,
  useTrialBalanceReport, useDonorSummaryReport, useDonorDetailReport,
} from '../api/useReports';
import { useAccounts }  from '../api/useAccounts';
import { useFunds }     from '../api/useFunds';
import { useContacts }  from '../api/useContacts';
import Card    from '../components/ui/Card';
import Button  from '../components/ui/Button';
import Select  from '../components/ui/Select';
import Combobox from '../components/ui/Combobox';
import MultiSelectCombobox from '../components/ui/MultiSelectCombobox';
import DateRangePicker from '../components/ui/DateRangePicker';
import HardCloseWizard from './HardClose';
import { currentMonthRange, getChurchToday } from '../utils/date';
import {
  exportBalanceSheet,
  exportDonorDetail,
  exportDonorSummary,
  exportLedger,
  exportPL,
  exportTrialBalance,
} from './reports/reportExports';
import {
  BalanceSheetReport,
  DonorDetailReport,
  DonorSummaryReport,
  LedgerReport,
  PLReport,
  TrialBalanceReport,
} from './reports/reportRenderers';
import type {
  BalanceSheetReportFilters,
  DonorDetailReportFilters,
  DonorSummaryReportFilters,
  LedgerReportFilters,
  PLReportFilters,
  ReportDiagnostic,
  ReportInvestigateFilters,
  ReportType,
  TrialBalanceReportFilters,
} from '@shared/contracts';
import type { OptionValue, SelectOption } from '../components/ui/types';

const REPORT_TYPES: SelectOption<ReportType>[] = [
  { value: 'pl',             label: 'Profit & Loss' },
  { value: 'balance-sheet',  label: 'Balance Sheet' },
  { value: 'ledger',         label: 'General Ledger' },
  { value: 'trial-balance',  label: 'Trial Balance' },
  { value: 'donors-summary', label: 'Income by Donor — Summary' },
  { value: 'donors-detail',  label: 'Income by Donor — Detail' },
];

export default function Reports() {
  const [type,    setType]    = useState<ReportType>('pl');
  const [range,   setRange]   = useState(currentMonthRange());
  const [asOf,    setAsOf]    = useState(getChurchToday());
  const [fundId,  setFundId]  = useState('');
  const [acctId,  setAcctId]  = useState('');
  const [ctcId,   setCtcId]   = useState('');
  const [donorAcctIds, setDonorAcctIds] = useState<OptionValue[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [hardCloseOpen, setHardCloseOpen] = useState(false);

  const { data: funds    } = useFunds();
  const { data: accounts } = useAccounts();
  const { data: incomeAccounts } = useAccounts({ type: 'INCOME' });
  const { data: contacts } = useContacts({ type: 'DONOR' });

  const fundOptions    = [{ value: '', label: 'All Funds' }, ...(funds || []).map((f) => ({ value: f.id, label: f.name }))];
  const accountOptions = [{ value: '', label: 'All Accounts' }, ...(accounts || []).map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }))];
  const incomeAccountOptions = (incomeAccounts || []).map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));
  const contactOptions = [{ value: '', label: 'All Donors' }, ...(contacts || []).map((c) => ({ value: c.id, label: c.name }))];
  const sortedAcctIds = [...donorAcctIds].sort((a, b) => Number(a) - Number(b));
  const acctIdsParam = sortedAcctIds.length ? sortedAcctIds.join(',') : undefined;

  const plFilters: PLReportFilters = { from: range.from, to: range.to, fund_id: fundId || undefined };
  const bsFilters: BalanceSheetReportFilters = { as_of: asOf, fund_id: fundId || undefined };
  const ledgerFilters: LedgerReportFilters = { from: range.from, to: range.to, fund_id: fundId || undefined, account_id: acctId || undefined };
  const tbFilters: TrialBalanceReportFilters = { as_of: asOf, fund_id: fundId || undefined };
  const dsFilters: DonorSummaryReportFilters = { from: range.from, to: range.to, fund_id: fundId || undefined, account_ids: acctIdsParam };
  const ddFilters: DonorDetailReportFilters = {
    from: range.from,
    to: range.to,
    fund_id: fundId || undefined,
    contact_id: ctcId || undefined,
    account_ids: acctIdsParam,
  };

  const plData  = usePLReport(plFilters,     enabled && type === 'pl');
  const bsData  = useBalanceSheetReport(bsFilters, enabled && type === 'balance-sheet');
  const lgData  = useLedgerReport(ledgerFilters,   enabled && type === 'ledger');
  const tbData  = useTrialBalanceReport(tbFilters, enabled && type === 'trial-balance');
  const dsData  = useDonorSummaryReport(dsFilters, enabled && type === 'donors-summary');
  const ddData  = useDonorDetailReport(ddFilters,  enabled && type === 'donors-detail');

  const activeQuery = { pl: plData, 'balance-sheet': bsData, ledger: lgData,
    'trial-balance': tbData, 'donors-summary': dsData, 'donors-detail': ddData }[type];

  const isLoading  = activeQuery?.isFetching ?? false;
  const hasReportData = Boolean(activeQuery?.data?.data);

  function handleRun() { setEnabled(false); setTimeout(() => setEnabled(true), 0); }

  function handleExport() {
    if (type === 'pl' && plData.data) exportPL(plData.data.data, plFilters);
    if (type === 'balance-sheet' && bsData.data) exportBalanceSheet(bsData.data.data, bsFilters);
    if (type === 'ledger' && lgData.data) exportLedger(lgData.data.data, ledgerFilters);
    if (type === 'trial-balance' && tbData.data) exportTrialBalance(tbData.data.data, tbFilters);
    if (type === 'donors-summary' && dsData.data) exportDonorSummary(dsData.data.data, dsFilters);
    if (type === 'donors-detail' && ddData.data) exportDonorDetail(ddData.data.data, ddFilters);
  }

  function handleInvestigate(item: ReportDiagnostic | ReportInvestigateFilters) {
    if ('code' in item && item.code === 'SUGGEST_HARD_CLOSE') {
      setHardCloseOpen(true)
      return
    }
    const filters = 'investigate_filters' in item ? item.investigate_filters : item
    if (!filters) return
    setType('ledger')
    setRange({ from: filters.from, to: filters.to })
    setAcctId(filters.account_id ? String(filters.account_id) : '')
    if (filters.fund_id) setFundId(String(filters.fund_id))
    setEnabled(false)
    setTimeout(() => setEnabled(true), 0)
  }

  const needsAsOf = type === 'balance-sheet' || type === 'trial-balance';

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', marginBottom: '1.5rem' }}>
        Reports
      </h1>

      <Card style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1rem', alignItems: 'end' }}>
            <Select label="Report Type" value={type}
              onChange={(e) => {
                const nextType = e.target.value as ReportType
                setType(nextType)
                if (nextType !== 'donors-summary' && nextType !== 'donors-detail') setDonorAcctIds([])
                setEnabled(false)
              }}
              options={REPORT_TYPES} />
            {!needsAsOf && (
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500,
                  color: '#374151', marginBottom: '0.3rem' }}>Date Range</label>
                <DateRangePicker from={range.from} to={range.to}
                  onChange={(r) => { setRange(r); setEnabled(false); }} />
              </div>
            )}
            {needsAsOf && (
              <div style={{ maxWidth: '180px' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500,
                  color: '#374151', marginBottom: '0.3rem' }}>As of Date</label>
                <input type="date" value={asOf}
                  onChange={(e) => { setAsOf(e.target.value); setEnabled(false); }}
                  style={{ padding: '0.45rem 0.75rem', border: '1px solid #d1d5db',
                    borderRadius: '6px', fontSize: '0.875rem' }} />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Select label="Fund" value={fundId}
              onChange={(e) => { setFundId(e.target.value); setEnabled(false); }}
              options={fundOptions} style={{ minWidth: '180px' }} />
            {(type === 'donors-summary' || type === 'donors-detail') && (
              <MultiSelectCombobox
                label="Income Accounts"
                options={incomeAccountOptions}
                value={donorAcctIds}
                onChange={(ids) => { setDonorAcctIds(ids); setEnabled(false); }}
                placeholder="All Accounts"
                style={{ minWidth: '240px' }}
              />
            )}
            {type === 'ledger' && (
              <Combobox label="Account" options={accountOptions} value={acctId}
                onChange={(v) => { setAcctId(String(v)); setEnabled(false); }}
                placeholder="All Accounts" style={{ minWidth: '240px' }} />
            )}
            {type === 'donors-detail' && (
              <Combobox label="Donor" options={contactOptions} value={ctcId}
                onChange={(v) => { setCtcId(String(v)); setEnabled(false); }}
                placeholder="All Donors" style={{ minWidth: '200px' }} />
            )}
            <Button onClick={handleRun} isLoading={isLoading} style={{ marginTop: 'auto' }}>
              Run Report
            </Button>
            {hasReportData && (
              <Button variant="secondary" onClick={handleExport} style={{ marginTop: 'auto' }}>
                Export Excel
              </Button>
            )}
          </div>
        </div>
      </Card>

      {isLoading && (
        <Card><div style={{ padding: '2rem', color: '#6b7280', textAlign: 'center' }}>
          Generating report…
        </div></Card>
      )}

      {!isLoading && hasReportData && (
        <Card>
          <div style={{ marginBottom: '1rem', paddingBottom: '0.75rem',
            borderBottom: '1px solid #e5e7eb' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
              {REPORT_TYPES.find((r) => r.value === type)?.label}
            </h2>
            <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
              {needsAsOf ? `As of ${asOf}` : `${range.from} — ${range.to}`}
              {fundId && ` · ${(funds || []).find((f) => f.id === Number(fundId))?.name}`}
              {(type === 'donors-summary' || type === 'donors-detail') && donorAcctIds.length > 0 &&
                ` · ${donorAcctIds.length} account${donorAcctIds.length > 1 ? 's' : ''}`}
            </div>
          </div>

          {type === 'pl' && plData.data && <PLReport data={plData.data.data} />}
          {type === 'balance-sheet' && bsData.data && <BalanceSheetReport data={bsData.data.data} onInvestigate={handleInvestigate} />}
          {type === 'ledger' && lgData.data && <LedgerReport data={lgData.data.data} />}
          {type === 'trial-balance' && tbData.data && <TrialBalanceReport data={tbData.data.data} onInvestigate={handleInvestigate} />}
          {type === 'donors-summary' && dsData.data && <DonorSummaryReport data={dsData.data.data} />}
          {type === 'donors-detail' && ddData.data && <DonorDetailReport data={ddData.data.data} />}
        </Card>
      )}

      {!isLoading && !hasReportData && enabled && (
        <Card><div style={{ padding: '2rem', color: '#9ca3af', textAlign: 'center' }}>
          No data found for the selected filters.
        </div></Card>
      )}

      <HardCloseWizard
        open={hardCloseOpen}
        onClose={() => setHardCloseOpen(false)}
        onSuccess={() => activeQuery?.refetch?.()}
      />
    </div>
  );
}
