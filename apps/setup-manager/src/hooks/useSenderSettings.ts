import { useEffect, useState } from "react";

import { errorMessage, normalizeSenderUrl, writeStoredValue } from "../lib/senderApi";
import type {
  SenderConfigConflictResponse,
  SenderConfigDraft,
  SenderConfigResponse,
  SenderForwardTargetDraft,
  SenderForwardTargetResponse,
  SenderStorageInfo,
} from "../lib/senderTypes";

const SENDER_STORAGE_ROOT_KEY = "frc_sender_storage_root";

const EMPTY_SENDER_STORAGE_INFO: SenderStorageInfo = {
  selected: null,
  effective: "",
  usingCustom: false,
};

const DEFAULT_SENDER_CONFIG: SenderConfigDraft = {
  udpPort: "20777",
  saveFiles: true,
  dataStorageMode: "resultOnly",
  trackRecording: false,
  roomName: "Sender Room",
  roomPassword: "",
  forwardTargets: [],
};

function normalizeSenderForwardTargetsResponse(targets: SenderForwardTargetResponse[] | null | undefined): SenderForwardTargetDraft[] {
  if (!Array.isArray(targets)) {
    return [];
  }
  return targets.map((target) => ({
    host: typeof target.host === "string" ? target.host : "",
    port: typeof target.port === "number" && Number.isFinite(target.port) ? String(target.port) : "",
    enabled: target.enabled !== false,
  }));
}

function buildSenderConfigDraft(data: SenderConfigResponse | null | undefined): SenderConfigDraft {
  const dataStorageMode =
    data?.dataStorageMode === "advanced" || data?.dataStorageMode === "summary" || data?.dataStorageMode === "resultOnly"
      ? data.dataStorageMode
      : DEFAULT_SENDER_CONFIG.dataStorageMode;
  return {
    udpPort:
      typeof data?.udpPort === "number" && Number.isFinite(data.udpPort)
        ? String(data.udpPort)
        : DEFAULT_SENDER_CONFIG.udpPort,
    saveFiles: typeof data?.saveFiles === "boolean" ? data.saveFiles : DEFAULT_SENDER_CONFIG.saveFiles,
    dataStorageMode,
    trackRecording: typeof data?.trackRecording === "boolean" ? data.trackRecording : DEFAULT_SENDER_CONFIG.trackRecording,
    roomName: typeof data?.roomName === "string" ? data.roomName : DEFAULT_SENDER_CONFIG.roomName,
    roomPassword: typeof data?.roomPassword === "string" ? data.roomPassword : DEFAULT_SENDER_CONFIG.roomPassword,
    forwardTargets: normalizeSenderForwardTargetsResponse(data?.forwardTargets),
  };
}

function normalizeSenderStorageInfo(source?: Partial<SenderStorageInfo> | null): SenderStorageInfo {
  const selected = typeof source?.selected === "string" && source.selected.trim() ? source.selected.trim() : null;
  const effective = typeof source?.effective === "string" && source.effective.trim() ? source.effective.trim() : selected ?? "";
  return {
    selected,
    effective,
    usingCustom: Boolean(selected),
  };
}

/** Sender 설정(/api/config)과 데스크톱 전용 저장 위치·재시작 제어. */
export function useSenderSettings(senderUrl: string) {
  const [config, setConfig] = useState<SenderConfigDraft>(DEFAULT_SENDER_CONFIG);
  const [storageInfo, setStorageInfo] = useState<SenderStorageInfo>(EMPTY_SENDER_STORAGE_INFO);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changingStorage, setChangingStorage] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwriteFilename, setOverwriteFilename] = useState("");

  const refreshStorageInfo = async () => {
    if (!window.electronAPI?.getSenderStorageInfo) {
      return;
    }
    setStorageInfo(normalizeSenderStorageInfo(await window.electronAPI.getSenderStorageInfo()));
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!window.electronAPI?.getSenderStorageInfo) return;
        const next = normalizeSenderStorageInfo(await window.electronAPI.getSenderStorageInfo());
        if (active) setStorageInfo(next);
      } catch (loadError) {
        if (active) setError(errorMessage(loadError, "Failed to load storage location."));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      try {
        const response = await fetch(`${normalizeSenderUrl(senderUrl)}/api/config`);
        const data = (await response.json().catch(() => null)) as SenderConfigResponse | null;
        if (!response.ok || !data || !active) {
          return;
        }
        setConfig(buildSenderConfigDraft(data));
        setOverwriteFilename("");
        setError(null);
      } catch {
        // Sender가 아직 기동 전이면 기본값을 유지한다(상태 폴링이 Offline을 표시).
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [senderUrl]);

  const update = (patch: Partial<SenderConfigDraft>) => setConfig((current) => ({ ...current, ...patch }));

  const setTrackRecording = (checked: boolean) => {
    update({ trackRecording: checked });
    if (!checked) {
      setOverwriteFilename("");
    }
  };

  const updateForwardTarget = (index: number, patch: Partial<SenderForwardTargetDraft>) => {
    setConfig((current) => ({
      ...current,
      forwardTargets: current.forwardTargets.map((target, targetIndex) => (targetIndex === index ? { ...target, ...patch } : target)),
    }));
  };

  const addForwardTarget = () => {
    setConfig((current) => ({
      ...current,
      forwardTargets: [...current.forwardTargets, { host: "", port: "", enabled: true }],
    }));
  };

  const removeForwardTarget = (index: number) => {
    setConfig((current) => ({
      ...current,
      forwardTargets: current.forwardTargets.filter((_, targetIndex) => targetIndex !== index),
    }));
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const udpPort = Number.parseInt(config.udpPort.trim(), 10);
      if (!Number.isInteger(udpPort) || udpPort < 1 || udpPort > 65535) {
        throw new Error("UDP port must be between 1 and 65535.");
      }

      const nextForwardTargets = [];
      for (const target of config.forwardTargets) {
        const host = target.host.trim();
        const portText = target.port.trim();
        if (!host && !portText) {
          continue;
        }
        const port = Number.parseInt(portText, 10);
        if (!host) {
          throw new Error("Forward target host is required.");
        }
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error(`Forward target port for ${host} must be between 1 and 65535.`);
        }
        nextForwardTargets.push({ host, port, enabled: target.enabled });
      }

      // 오버레이 핫키는 Overlay 화면(/api/local-ops)이 관리한다 — 여기서는 보내지 않아 Sender가 기존 값을 유지한다.
      const response = await fetch(`${normalizeSenderUrl(senderUrl)}/api/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          udpPort,
          saveFiles: config.saveFiles,
          dataStorageMode: config.dataStorageMode,
          trackRecording: config.trackRecording,
          trackRecordingOverwriteApprovedFor: overwriteFilename,
          roomName: config.roomName,
          roomPassword: config.roomPassword,
          forwardTargets: nextForwardTargets,
        }),
      });
      const data = (await response.json().catch(() => null)) as SenderConfigResponse | SenderConfigConflictResponse | null;

      if (!response.ok) {
        const conflict = data as SenderConfigConflictResponse | null;
        if (response.status === 409 && conflict?.requiresOverwriteConfirm) {
          setOverwriteFilename(conflict.currentTrack?.filename?.trim() ?? "");
          throw new Error(
            conflict.error || `Track data already exists for ${conflict.currentTrack?.name || "the current track"}. Save again to confirm overwrite.`,
          );
        }
        throw new Error((data as SenderConfigConflictResponse | null)?.error || "Failed to save sender settings.");
      }

      setConfig(buildSenderConfigDraft(data as SenderConfigResponse | null));
      setOverwriteFilename("");
      setNotice("Sender settings saved.");
    } catch (saveError) {
      setError(errorMessage(saveError, "Failed to save sender settings."));
    } finally {
      setSaving(false);
    }
  };

  const applyStorageRoot = async (nextRoot: string | null) => {
    if (!window.electronAPI?.setSetting) {
      setError("Storage location control is only available in the desktop app.");
      return;
    }

    const normalized = nextRoot?.trim() || "";
    const currentSelected = storageInfo.selected ?? "";
    if (normalized === currentSelected) {
      setNotice(normalized ? "Storage location is already using the selected folder." : "Sender is already using the default app folder.");
      setError(null);
      return;
    }

    setChangingStorage(true);
    setNotice(null);
    setError(null);
    try {
      await writeStoredValue(SENDER_STORAGE_ROOT_KEY, normalized);
      await refreshStorageInfo();

      if (window.electronAPI?.restartSender) {
        await window.electronAPI.restartSender();
        setNotice(
          normalized
            ? "Storage location saved. Sender restarted and new logs/data will be written to the selected folder."
            : "Storage location reset. Sender restarted and will use the default app folder again.",
        );
      } else {
        setNotice(
          normalized
            ? "Storage location saved. Restart F1 Driver Pack to start writing new logs/data to the selected folder."
            : "Storage location reset. Restart F1 Driver Pack to apply the default app folder again.",
        );
      }
    } catch (storageError) {
      setError(errorMessage(storageError, "Failed to update sender storage location."));
    } finally {
      setChangingStorage(false);
    }
  };

  const chooseStorageRoot = async () => {
    if (!window.electronAPI?.selectDirectory) {
      setError("Folder selection is only available in the desktop app.");
      return;
    }

    try {
      const selectedPath = await window.electronAPI.selectDirectory((storageInfo.selected ?? storageInfo.effective) || undefined);
      if (!selectedPath) {
        return;
      }
      await applyStorageRoot(selectedPath);
    } catch (selectError) {
      setError(errorMessage(selectError, "Failed to select a storage folder."));
    }
  };

  const restartSender = async () => {
    if (!window.electronAPI?.restartSender) {
      setError("Sender restart control is only available in the desktop app.");
      return;
    }

    setChangingStorage(true);
    setNotice(null);
    setError(null);
    try {
      await window.electronAPI.restartSender();
      setNotice("Sender restarted.");
    } catch (restartError) {
      setError(errorMessage(restartError, "Failed to restart sender."));
    } finally {
      setChangingStorage(false);
    }
  };

  return {
    config,
    storageInfo,
    loading,
    saving,
    changingStorage,
    notice,
    error,
    overwriteFilename,
    canRestart: Boolean(window.electronAPI?.restartSender),
    update,
    setTrackRecording,
    updateForwardTarget,
    addForwardTarget,
    removeForwardTarget,
    save,
    chooseStorageRoot,
    resetStorageRoot: () => applyStorageRoot(null),
    restartSender,
  };
}

export type SenderSettings = ReturnType<typeof useSenderSettings>;
