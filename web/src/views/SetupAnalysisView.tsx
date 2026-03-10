import { useState } from 'react';
import { AerodynamicsCard } from '../components/setup-analysis/cards/AerodynamicsCard';
import { TransmissionCard } from '../components/setup-analysis/cards/TransmissionCard';
import { SuspensionGeometryCard } from '../components/setup-analysis/cards/SuspensionGeometryCard';
import { SuspensionCard } from '../components/setup-analysis/cards/SuspensionCard';
import { BrakesCard } from '../components/setup-analysis/cards/BrakesCard';
import { TyresCard } from '../components/setup-analysis/cards/TyresCard';
import { DiagnosisPanel } from '../components/setup-analysis/diagnosis/DiagnosisPanel';
import { SetupFeedbackPanel } from '../components/setup-analysis/feedback/SetupFeedbackPanel';
import type { SymptomId } from '../components/setup-analysis/diagnosis/scoring';
import { useTelemetryStore } from '../store/telemetryStore';
import styles from './SetupAnalysisView.module.css';

function GuideModal({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>Setup Analysis Guide</span>
          <button className={styles.modalClose} onClick={onClose}>X</button>
        </div>
        <div className={styles.modalBody}>
          <SetupGuideContent />
        </div>
      </div>
    </div>
  );
}

function SetupGuideContent() {
  return (
    <div className={styles.guide}>
      <div className={styles.guideIntro}>
        <span className={styles.guideTitle}>Setup Analysis Guide</span>
        <span className={styles.guideDesc}>
          F1 25 차량 셋업을 실시간 텔레메트리 기반으로 분석합니다.
          6가지 핵심 영역의 데이터를 프레임 단위(60Hz)로 수집하고, 랩별로 요약하여
          셋업 조정 권고사항을 제공합니다.
        </span>
      </div>

      <div className={styles.guideSteps}>
        <span className={styles.guideLegendTitle}>How to Use</span>
        <div className={styles.guideStep}><span className={styles.guideStepNum}>1</span><span className={styles.guideStepText}>F1 25 게임에서 UDP Telemetry On 설정</span></div>
        <div className={styles.guideStep}><span className={styles.guideStepNum}>2</span><span className={styles.guideStepText}>세션 진입 시 실시간 데이터 자동 표시</span></div>
        <div className={styles.guideStep}><span className={styles.guideStepNum}>3</span><span className={styles.guideStepText}>1랩 완료 시 랩별 분석 테이블 생성</span></div>
        <div className={styles.guideStep}><span className={styles.guideStepNum}>4</span><span className={styles.guideStepText}>Severity Dot과 권고사항 참고하여 셋업 조정</span></div>
      </div>

      <div className={styles.guideLegend}>
        <span className={styles.guideLegendTitle}>Severity Indicator</span>
        <div className={styles.guideLegendRow}><span className={styles.guideDot} style={{ background: '#00ff00' }} /><span>Green — 정상</span></div>
        <div className={styles.guideLegendRow}><span className={styles.guideDot} style={{ background: '#ffcc00' }} /><span>Yellow — 주의</span></div>
        <div className={styles.guideLegendRow}><span className={styles.guideDot} style={{ background: '#e10600' }} /><span>Red — 위험</span></div>
      </div>
    </div>
  );
}

type SetupTab = 'diagnosis' | 'overview' | 'feedback';

const TABS: { id: SetupTab; label: string }[] = [
  { id: 'diagnosis', label: 'Diagnosis' },
  { id: 'overview', label: 'Overview' },
  { id: 'feedback', label: 'Feedback' },
];

export function SetupAnalysisView() {
  const [showGuide, setShowGuide] = useState(false);
  const [activeTab, setActiveTab] = useState<SetupTab>('diagnosis');
  const [selectedSymptoms, setSelectedSymptoms] = useState<Set<SymptomId>>(new Set());
  
  const hasPlayer = useTelemetryStore(s => (s.pitwallState?.drivers.length ?? 0) > 0);
  const player = useTelemetryStore(s => s.pitwallState?.drivers.find(d => d.index === s.pitwallState?.playerIndex) ?? null);

  if (!hasPlayer) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerLeft}><span className={styles.title}>Setup Analysis</span></div>
          <button className={styles.helpBtn} onClick={() => setShowGuide(true)}>Guide</button>
        </div>
        <div className={styles.noData}><span className={styles.noDataText}>Waiting for telemetry data...</span></div>
        {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>Setup Analysis</span>
          <span className={styles.subtitle}>{player?.name} — Lap {player?.currentLapNum}</span>
        </div>
        <button className={styles.helpBtn} onClick={() => setShowGuide(true)}>Guide</button>
      </div>
      <div className={styles.tabBar}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >{tab.label}</button>
        ))}
      </div>
      <div className={styles.content}>
        {activeTab === 'diagnosis' && (
          <DiagnosisPanel
            selectedSymptoms={selectedSymptoms}
            onToggleSymptom={(id) =>
              setSelectedSymptoms((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
        )}
        {activeTab === 'overview' && player && (
          <div className={styles.grid}>
            <AerodynamicsCard driver={player} />
            <SuspensionGeometryCard driver={player} />
            <BrakesCard driver={player} />
            <TransmissionCard driver={player} />
            <SuspensionCard driver={player} />
            <TyresCard driver={player} />
          </div>
        )}
        {activeTab === 'feedback' && (
          <SetupFeedbackPanel selectedSymptoms={selectedSymptoms} />
        )}
      </div>
      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
    </div>
  );
}
