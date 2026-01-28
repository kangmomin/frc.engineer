import { useState, useEffect, useCallback } from 'react';
import type { AppConfig, TrackListItem } from '../types/telemetry';

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return `http://${window.location.hostname}:8080`;
  }
  return '';
}

export function useSettings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [tracks, setTracks] = useState<TrackListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const base = getApiBase();

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/config`);
      if (res.ok) {
        const data = await res.json();
        setConfig({ ...data, forwardTargets: data.forwardTargets ?? [] });
      }
    } catch (e) {
      console.error('Failed to fetch config:', e);
    }
  }, [base]);

  const fetchTracks = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/tracks`);
      if (res.ok) {
        const data = await res.json();
        setTracks(data ?? []);
      }
    } catch (e) {
      console.error('Failed to fetch tracks:', e);
    }
  }, [base]);

  useEffect(() => {
    Promise.all([fetchConfig(), fetchTracks()]).finally(() => setLoading(false));
  }, [fetchConfig, fetchTracks]);

  const updateConfig = useCallback(async (newConfig: AppConfig) => {
    setSaving(true);
    try {
      const res = await fetch(`${base}/api/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });
      if (res.ok) {
        const data = await res.json();
        setConfig({ ...data, forwardTargets: data.forwardTargets ?? [] });
      }
    } catch (e) {
      console.error('Failed to update config:', e);
    } finally {
      setSaving(false);
    }
  }, [base]);

  return { config, tracks, loading, saving, updateConfig, refreshTracks: fetchTracks };
}
