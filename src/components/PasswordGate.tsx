import { useState } from 'react';

const CORRECT_PASSWORD = (import.meta as unknown as { env: Record<string, string> }).env.VITE_APP_PASSWORD || 'futurist';
const SESSION_KEY = 'ff_auth';

export function isAuthenticated(): boolean {
  return sessionStorage.getItem(SESSION_KEY) === '1';
}

interface PasswordGateProps {
  children: React.ReactNode;
}

export function PasswordGate({ children }: PasswordGateProps) {
  const [authed, setAuthed] = useState(isAuthenticated);
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  if (authed) return <>{children}</>;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (value === CORRECT_PASSWORD) {
      sessionStorage.setItem(SESSION_KEY, '1');
      setAuthed(true);
    } else {
      setError(true);
      setShake(true);
      setValue('');
      setTimeout(() => setShake(false), 500);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--background)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <div style={{
        width: 360,
        padding: '40px 36px',
        borderRadius: 16,
        border: '1px solid var(--border)',
        background: 'var(--card)',
        boxShadow: '0 4px 32px rgba(0,0,0,0.08)',
      }}>
        <div style={{ marginBottom: 28, textAlign: 'center' }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: 'var(--foreground)' }}>
            Futurist Setup
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted-foreground)' }}>
            Enter your password to continue
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={value}
            onChange={e => { setValue(e.target.value); setError(false); }}
            placeholder="Password"
            autoFocus
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 14px',
              borderRadius: 8,
              border: `1.5px solid ${error ? '#ef4444' : 'var(--border)'}`,
              background: 'var(--input)',
              color: 'var(--foreground)',
              fontSize: 15,
              outline: 'none',
              marginBottom: 12,
              animation: shake ? 'shake 0.4s ease' : 'none',
            }}
          />
          {error && (
            <p style={{ margin: '0 0 10px', fontSize: 13, color: '#ef4444', textAlign: 'center' }}>
              Incorrect password
            </p>
          )}
          <button
            type="submit"
            style={{
              width: '100%',
              padding: '10px 0',
              borderRadius: 8,
              border: 'none',
              background: 'var(--primary)',
              color: 'var(--primary-foreground)',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Enter
          </button>
        </form>
      </div>
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-5px); }
          80% { transform: translateX(5px); }
        }
      `}</style>
    </div>
  );
}
