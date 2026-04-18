import axios from 'axios';
import { describe, expect, it } from 'vitest';

import { getErrorMessage } from './errors';

describe('getErrorMessage', () => {
  it('uses API error message when present', () => {
    const error = new axios.AxiosError(
      'Request failed',
      undefined,
      undefined,
      undefined,
      {
        data: { error: 'Vendor is required' },
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config: { headers: new axios.AxiosHeaders() },
      }
    );

    expect(getErrorMessage(error, 'Something went wrong')).toBe('Vendor is required');
  });

  it('joins validation errors from API response', () => {
    const error = new axios.AxiosError(
      'Request failed',
      undefined,
      undefined,
      undefined,
      {
        data: { errors: ['Date is required', 'Amount is required'] },
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config: { headers: new axios.AxiosHeaders() },
      }
    );

    expect(getErrorMessage(error, 'Something went wrong')).toBe('Date is required, Amount is required');
  });
});
