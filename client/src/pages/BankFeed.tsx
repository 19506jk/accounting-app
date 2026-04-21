import { useMemo, useState } from 'react'

import { useAccounts } from '../api/useAccounts'
import { useFunds } from '../api/useFunds'
import Button from '../components/ui/Button'
import BankFeedImportTab from './bankFeed/BankFeedImportTab'
import BankFeedMatchTab from './bankFeed/BankFeedMatchTab'
import BankFeedReviewTab from './bankFeed/BankFeedReviewTab'
import type React from 'react'
import type { SelectOption } from '../components/ui/types'

type TabKey = 'import' | 'review' | 'match'

function PersistentTabPanel({
  isActive,
  children,
}: {
  isActive: boolean
  children: React.ReactNode
}) {
  return (
    <div aria-hidden={!isActive} style={{ display: isActive ? 'contents' : 'none' }}>
      {children}
    </div>
  )
}

export default function BankFeed() {
  const { data: accounts = [] } = useAccounts()
  const { data: funds = [] } = useFunds()
  const [activeTab, setActiveTab] = useState<TabKey>('import')
  const [postImportNeedsReview, setPostImportNeedsReview] = useState(0)

  const activeAccounts = useMemo(() => accounts.filter((account) => account.is_active), [accounts])

  const bankAccountOptions = useMemo<SelectOption[]>(
    () => activeAccounts
      .filter((account) => account.type === 'ASSET')
      .map((account) => ({ value: account.id, label: `${account.code} — ${account.name}` })),
    [activeAccounts]
  )

  const fundOptions = useMemo<SelectOption[]>(
    () => funds.filter((fund) => fund.is_active).map((fund) => ({ value: fund.id, label: fund.name })),
    [funds]
  )

  function handleReviewed() {
    setPostImportNeedsReview((prev) => (prev > 0 ? prev - 1 : 0))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
          Bank Feed Queue
        </h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button variant={activeTab === 'import' ? 'primary' : 'secondary'} onClick={() => setActiveTab('import')}>
            Import
          </Button>
          <Button variant={activeTab === 'review' ? 'primary' : 'secondary'} onClick={() => setActiveTab('review')}>
            Review Queue
          </Button>
          <Button variant={activeTab === 'match' ? 'primary' : 'secondary'} onClick={() => setActiveTab('match')}>
            Match
          </Button>
        </div>
      </div>

      <PersistentTabPanel isActive={activeTab === 'import'}>
        <BankFeedImportTab
          isActive={activeTab === 'import'}
          bankAccountOptions={bankAccountOptions}
          fundOptions={fundOptions}
          postImportNeedsReview={postImportNeedsReview}
          setPostImportNeedsReview={setPostImportNeedsReview}
        />
      </PersistentTabPanel>
      <PersistentTabPanel isActive={activeTab === 'review'}>
        <BankFeedReviewTab isActive={activeTab === 'review'} onReviewed={handleReviewed} />
      </PersistentTabPanel>
      <PersistentTabPanel isActive={activeTab === 'match'}>
        <BankFeedMatchTab isActive={activeTab === 'match'} />
      </PersistentTabPanel>
    </div>
  )
}
