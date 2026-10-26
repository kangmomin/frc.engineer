import { useState } from "react";

import { normalizeSenderUrl } from "../lib/senderApi";
import { Button, Hint, Modal, Notice, Panel, TextInput } from "../ui";

export function PairingGateModal({
  senderUrl,
  platformBaseUrl,
  onPaired,
}: {
  senderUrl: string;
  platformBaseUrl: string;
  onPaired: () => void;
}) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (submitting) return;
    const trimmed = code.trim();
    if (!trimmed) {
      setError("페어링 코드를 입력하세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${normalizeSenderUrl(senderUrl)}/api/upload/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = (await response.json().catch(() => null)) as { paired?: boolean; error?: string } | null;
      if (!response.ok || data?.paired !== true) {
        throw new Error(data?.error || "페어링 실패");
      }
      onPaired();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "페어링 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal zIndex={20000}>
      <Panel title="디바이스 페어링" detail="Driver Pack을 사용하려면 PitHub 계정과 기기 페어링이 필요합니다.">
        <ol style={{ paddingLeft: 18, fontSize: 12.5, lineHeight: 1.8, color: "var(--t2)" }}>
          <li>
            <a href={platformBaseUrl} target="_blank" rel="noopener noreferrer">
              {platformBaseUrl}
            </a>
            에 접속해 Steam으로 로그인하세요.
          </li>
          <li>왼쪽 메뉴 PROFILE → "디바이스 페어링" 카드에서 "페어링 코드 생성"을 클릭하세요.</li>
          <li>생성된 코드를 아래 입력란에 붙여넣고 "인증"을 누르세요. (코드는 10분간 유효하며 1회만 사용할 수 있습니다)</li>
        </ol>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <div style={{ display: "flex", gap: 8 }}>
          <TextInput
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void submit();
              }
            }}
            maxLength={64}
            placeholder="페어링 코드"
            aria-label="페어링 코드"
          />
          <Button variant="go" onClick={() => void submit()} disabled={submitting} busy={submitting}>
            {submitting ? "확인 중..." : "인증"}
          </Button>
        </div>
      </Panel>
    </Modal>
  );
}
