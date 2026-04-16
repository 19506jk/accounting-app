import { useEffect, useState } from 'react';
import { useNavigate }         from 'react-router-dom';
import { GoogleLogin }         from '@react-oauth/google';
import axios                   from 'axios';
import { useAuth }             from '../context/AuthContext';
import client                  from '../api/client';
import type { CredentialResponse } from '@react-oauth/google';
import type { GoogleAuthResponse } from '@shared/contracts';

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const navigate                   = useNavigate();
  const [error, setError]          = useState('');
  const [loading, setLoading]      = useState(false);

  // If already authenticated, skip login page
  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  async function handleSuccess(credentialResponse: CredentialResponse) {
    setError('');
    setLoading(true);
    try {
      const { data } = await client.post<GoogleAuthResponse>('/auth/google', {
        credential: credentialResponse.credential,
      });
      login(data.token, data.user);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const msg = axios.isAxiosError<{ error?: string }>(err)
        ? err.response?.data?.error
        : undefined;
      if (axios.isAxiosError(err) && err.response?.status === 403) {
        setError(msg || 'Your account has not been added. Contact your administrator.');
      } else {
        setError(msg || 'Sign-in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  function handleError() {
    setError('Sign-in failed. If a popup was blocked, please enable popups for this site and try again.');
  }

  return (
    <div style={{
      minHeight:      '100vh',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      background:     'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)',
      fontFamily:     'system-ui, sans-serif',
    }}>
      <div style={{
        background:   'white',
        borderRadius: '12px',
        boxShadow:    '0 4px 24px rgba(0,0,0,0.08)',
        padding:      '3rem 2.5rem',
        width:        '100%',
        maxWidth:     '400px',
        textAlign:    'center',
      }}>
        {/* Logo / title */}
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⛪</div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: '0 0 0.5rem' }}>
          Church Accounting
        </h1>
        <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '2rem' }}>
          Sign in to manage your church finances
        </p>

        {/* Error message */}
        {error && (
          <div style={{
            background:   '#fef2f2',
            border:       '1px solid #fecaca',
            borderRadius: '8px',
            padding:      '0.75rem 1rem',
            color:        '#dc2626',
            fontSize:     '0.85rem',
            marginBottom: '1.25rem',
            textAlign:    'left',
          }}>
            {error}
          </div>
        )}

        {/* Google Sign-In button */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {loading ? (
            <div style={{ color: '#6b7280', fontSize: '0.9rem', padding: '0.75rem' }}>
              Signing in…
            </div>
          ) : (
            <GoogleLogin
              onSuccess={handleSuccess}
              onError={handleError}
              useOneTap={false}
              theme="outline"
              size="large"
              text="signin_with"
              shape="rectangular"
            />
          )}
        </div>

        <p style={{ marginTop: '2rem', color: '#9ca3af', fontSize: '0.78rem' }}>
          Access is restricted to authorised users only.
        </p>
      </div>
    </div>
  );
}
