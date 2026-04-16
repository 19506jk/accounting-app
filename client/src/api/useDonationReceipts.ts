import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import client from './client'

import type {
  DonationReceiptAccountsResponse,
  DonationReceiptGenerateInput,
  DonationReceiptGeneratePdfResponse,
  DonationReceiptPreviewInput,
  DonationReceiptPreviewResponse,
  DonationReceiptTemplateResponse,
  UpdateDonationReceiptTemplateInput,
} from '@shared/contracts'

export function useDonationReceiptAccounts(fiscalYear: number, enabled = true) {
  return useQuery<DonationReceiptAccountsResponse>({
    queryKey: ['donation-receipts', 'accounts', fiscalYear],
    queryFn: async () => {
      const { data } = await client.get<DonationReceiptAccountsResponse>('/donation-receipts/accounts', {
        params: { fiscal_year: fiscalYear },
      })
      return data
    },
    enabled,
  })
}

export function useDonationReceiptTemplate(enabled = true) {
  return useQuery<DonationReceiptTemplateResponse>({
    queryKey: ['donation-receipts', 'template'],
    queryFn: async () => {
      const { data } = await client.get<DonationReceiptTemplateResponse>('/donation-receipts/template')
      return data
    },
    enabled,
  })
}

export function useSaveDonationReceiptTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: UpdateDonationReceiptTemplateInput) => {
      const { data } = await client.put<DonationReceiptTemplateResponse>('/donation-receipts/template', payload)
      return data
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['donation-receipts', 'template'] }),
  })
}

export function usePreviewDonationReceipt() {
  return useMutation({
    mutationFn: async (payload: DonationReceiptPreviewInput) => {
      const { data } = await client.post<DonationReceiptPreviewResponse>('/donation-receipts/preview', payload)
      return data
    },
  })
}

export function useGenerateDonationReceiptPdf() {
  return useMutation({
    mutationFn: async (payload: DonationReceiptGenerateInput) => {
      const { data } = await client.post<DonationReceiptGeneratePdfResponse>('/donation-receipts/generate-pdf', payload)
      return data
    },
  })
}
