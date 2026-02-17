import { useState, useEffect, useCallback, useRef } from 'react';
import type { AuthUser } from '../types/telemetry';

function checkMe(): Promise<{ user: AuthUser | null; loggedIn: boolean }> {
  return fetch('/api/auth/me')
    .then((r) => r.json())
    .catch(() => ({ user: null, loggedIn: false }));
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    checkMe()
      .then((data) => { if (data.loggedIn && data.user) setUser(data.user); })
      .finally(() => setLoading(false));

    // Poll every 5 minutes — if backend logged us out, sync frontend
    const interval = setInterval(() => {
      if (!userRef.current) return;
      checkMe().then((data) => {
        if (!data.loggedIn) setUser(null);
      });
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          setError(data.error || 'Login failed');
        } catch {
          setError(text || `Login failed (${res.status})`);
        }
        return;
      }
      const data = await res.json();
      setUser(data);
    } catch {
      setError('Server unreachable');
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  return { user, loading, error, login, logout };
}
