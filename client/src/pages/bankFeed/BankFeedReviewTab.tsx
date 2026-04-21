import { useState } from 'react'

import { useBankTransactions, useReviewBankTransaction } from '../../api/useBankTransactions'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { useToast } from '../../components/ui/Toast'
import { getErrorMessage } from '../../utils/errors'
import { formatCurrency } from './bankFeedHelpers'

interface BankFeedReviewTabProps {
  isActive: boolean
  onReviewed: () => void
}

export default function BankFeedReviewTab({ isActive, onReviewed }: BankFeedReviewTabProps) {
  const { addToast } = useToast()
  const { data: reviewItems = [], isLoading: isLoadingReview } = useBankTransactions(
    { status: 'needs_review' },
    { enabled: isActive }
  )
  const reviewMutation = useReviewBankTransaction()
  const [reviewingId, setReviewingId] = useState<number | null>(null)

  async function handleReview(id: number, decision: 'confirmed_new' | 'mark_as_duplicate') {
    setReviewingId(id)
    try {
      await reviewMutation.mutateAsync({ id, decision })
      addToast('Review decision saved.', 'success')
      onReviewed()
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to save review decision.'), 'error')
    } finally {
      setReviewingId(null)
    }
  }

  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
        <div style={{ fontWeight: 600, color: '#0f172a' }}>
          Needs Review ({reviewItems.length})
        </div>
        {isLoadingReview && (
          <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Loading review queue...</div>
        )}
        {!isLoadingReview && reviewItems.length === 0 && (
          <div style={{ fontSize: '0.85rem', color: '#64748b' }}>No items need review.</div>
        )}
        {reviewItems.map((item) => (
          <div key={item.id} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '0.8rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
              <div style={{ background: '#f8fafc', borderRadius: '6px', padding: '0.65rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.4rem' }}>New row</div>
                <div style={{ fontSize: '0.85rem', color: '#0f172a' }}>{item.bank_posted_date}</div>
                <div style={{ fontSize: '0.85rem', color: '#334155' }}>{item.raw_description}</div>
                <div style={{ fontSize: '0.85rem', color: '#0f172a' }}>{formatCurrency(item.amount)}</div>
              </div>
              <div style={{ background: '#fff7ed', borderRadius: '6px', padding: '0.65rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#9a3412', marginBottom: '0.4rem' }}>Conflict row</div>
                {item.conflict ? (
                  <>
                    <div style={{ fontSize: '0.85rem', color: '#7c2d12' }}>{item.conflict.bank_posted_date}</div>
                    <div style={{ fontSize: '0.85rem', color: '#9a3412' }}>{item.conflict.raw_description}</div>
                    <div style={{ fontSize: '0.85rem', color: '#7c2d12' }}>{formatCurrency(item.conflict.amount)}</div>
                  </>
                ) : (
                  <div style={{ fontSize: '0.85rem', color: '#9a3412' }}>No conflict details available</div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.65rem' }}>
              <Button
                variant="secondary"
                onClick={() => handleReview(item.id, 'mark_as_duplicate')}
                isLoading={reviewMutation.isPending && reviewingId === item.id}
              >
                Mark Duplicate
              </Button>
              <Button
                onClick={() => handleReview(item.id, 'confirmed_new')}
                isLoading={reviewMutation.isPending && reviewingId === item.id}
              >
                Confirm New
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
