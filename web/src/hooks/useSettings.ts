import { useState, useEffect, useCallback } from 'react';
import { mockConfig, mockTracks } from '../mock/mockData';
import { isMockMode } from '../runtimeFlags';
import type { AppConfig, TrackListItem } from '../types/telemetry';
import { getApiBase, getApiUrl, setStoredApiBase } from '../utils/apiBase';

export function useSettings() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [tracks, setTracks] = useState<TrackListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const base = getApiBase();

  const fetchConfig = useCallback(async () => {
    if (isMockMode) {
      setConfig(mockConfig);
      return;
    }
    try {
      const res = await fetch(getApiUrl('/api/config'));
      if (res.ok) {
        const data = await res.json();
        const cfg: AppConfig = {
          ...data,
          forwardTargets: data.forwardTargets ?? [],
          packetLogging: data.packetLogging ?? false,
          raceSummaryRecording: data.raceSummaryRecording ?? true,
          dataStorageMode: data.dataStorageMode ?? 'resultOnly',
        };
        setConfig(cfg);
      }
    } catch (e) {
      console.error('Failed to fetch config:', e);
    }
  }, [base]);

  const fetchTracks = useCallback(async () => {
    if (isMockMode) {
      setTracks(mockTracks);
      return;
    }
    try {
      const res = await fetch(getApiUrl('/api/tracks'));
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
      if (isMockMode) {
        setConfig(newConfig);
        return;
      }

      const backendPortChanged = config && newConfig.backendPort !== config.backendPort;

      const res = await fetch(getApiUrl('/api/config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });
      if (res.ok) {
        const data = await res.json();
        const saved: AppConfig = {
          ...data,
          forwardTargets: data.forwardTargets ?? [],
          packetLogging: data.packetLogging ?? false,
          raceSummaryRecording: data.raceSummaryRecording ?? true,
          dataStorageMode: data.dataStorageMode ?? 'resultOnly',
        };
        setConfig(saved);

        if (backendPortChanged) {
          if (base) {
            setStoredApiBase(`http://localhost:${saved.backendPort}`);
          } else {
            setTimeout(() => {
              window.location.href = `${window.location.protocol}//${window.location.hostname}:${saved.backendPort}${window.location.pathname}`;
            }, 500);
          }
        }
      }
    } catch (e) {
      console.error('Failed to update config:', e);
    } finally {
      setSaving(false);
    }
  }, [base, config]);

  return { config, tracks, loading, saving, updateConfig, refreshTracks: fetchTracks };
}
