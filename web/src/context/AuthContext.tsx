import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import type { AuthUser } from '../types/telemetry';

interface AuthContextType {
    user: AuthUser | null;
    loading: boolean;
    error: string | null;
    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function checkMe(): Promise<{ user: AuthUser | null; loggedIn: boolean }> {
    return fetch('/api/auth/me')
        .then((r) => r.json())
        .catch(() => ({ user: null, loggedIn: false }));
}

export function AuthProvider({ children }: { children: ReactNode }) {
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
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => { });
        setUser(null);
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, error, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
