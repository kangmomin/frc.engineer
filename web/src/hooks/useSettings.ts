import { useState, useEffect, useCallback, useRef } from 'react';
import type { AppConfig, TrackListItem } from '../types/telemetry';

function getApiBase(): string {
  return '';
}

export function useSettings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [tracks, setTracks] = useState<TrackListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const initialConfigRef = useRef<AppConfig | null>(null);

  const base = getApiBase();

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/config`);
      if (res.ok) {
        const data = await res.json();
        const cfg: AppConfig = { ...data, forwardTargets: data.forwardTargets ?? [] };
        setConfig(cfg);
        if (!initialConfigRef.current) {
          initialConfigRef.current = cfg;
        }
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
        const saved: AppConfig = { ...data, forwardTargets: data.forwardTargets ?? [] };

        const initial = initialConfigRef.current;
        if (initial) {
          const portsChanged =
            saved.udpPort !== initial.udpPort ||
            saved.backendPort !== initial.backendPort;
          setRestartRequired(portsChanged);
        }

        setConfig(saved);
      }
    } catch (e) {
      console.error('Failed to update config:', e);
    } finally {
      setSaving(false);
    }
  }, [base]);

  return { config, tracks, loading, saving, restartRequired, updateConfig, refreshTracks: fetchTracks };
}
