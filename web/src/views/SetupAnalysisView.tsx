import { useState } from 'react';
import { useTelemetryStore } from '../store/telemetryStore';
import { AerodynamicsCard } from '../components/setup-analysis/cards/AerodynamicsCard';
import { TransmissionCard } from '../components/setup-analysis/cards/TransmissionCard';
import { SuspensionGeometryCard } from '../components/setup-analysis/cards/SuspensionGeometryCard';
import { SuspensionCard } from '../components/setup-analysis/cards/SuspensionCard';
import { BrakesCard } from '../components/setup-analysis/cards/BrakesCard';
import { TyresCard } from '../components/setup-analysis/cards/TyresCard';
import { DiagnosisPanel } from '../components/setup-analysis/diagnosis/DiagnosisPanel';
import type { SymptomId } from '../components/setup-analysis/diagnosis/scoring';
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

      {/* How to use */}
      <div className={styles.guideSteps}>
        <span className={styles.guideLegendTitle}>How to Use</span>
        <div className={styles.guideStep}>
          <span className={styles.guideStepNum}>1</span>
          <span className={styles.guideStepText}>
            F1 25 게임에서 <span className={styles.guideStepTextBold}>Settings &gt; Telemetry &gt; UDP Telemetry = On</span> 설정
          </span>
        </div>
        <div className={styles.guideStep}>
          <span className={styles.guideStepNum}>2</span>
          <span className={styles.guideStepText}>
            게임 세션(프리 프랙티스, 퀄리파잉, 레이스 등)에 진입하면 <span className={styles.guideStepTextBold}>실시간 데이터가 자동으로 표시</span>됩니다
          </span>
        </div>
        <div className={styles.guideStep}>
          <span className={styles.guideStepNum}>3</span>
          <span className={styles.guideStepText}>
            <span className={styles.guideStepTextBold}>1랩을 완료</span>하면 랩별 분석 테이블이 생성됩니다. 랩이 누적될수록 트렌드를 파악할 수 있습니다
          </span>
        </div>
        <div className={styles.guideStep}>
          <span className={styles.guideStepNum}>4</span>
          <span className={styles.guideStepText}>
            각 카드의 <span className={styles.guideStepTextBold}>Severity Dot</span>(색상 점)과 하단 <span className={styles.guideStepTextBold}>권고사항</span>을 참고하여 셋업을 조정하세요
          </span>
        </div>
      </div>

      {/* Severity legend */}
      <div className={styles.guideLegend}>
        <span className={styles.guideLegendTitle}>Severity Indicator</span>
        <div className={styles.guideLegendRow}>
          <span className={styles.guideDot} style={{ background: '#00ff00' }} />
          <span><strong style={{ color: '#00ff00' }}>Green</strong> — 정상 범위. 셋업 조정 불필요</span>
        </div>
        <div className={styles.guideLegendRow}>
          <span className={styles.guideDot} style={{ background: '#ffcc00' }} />
          <span><strong style={{ color: '#ffcc00' }}>Yellow</strong> — 주의 필요. 임계값 근처이며 권고사항 확인 권장</span>
        </div>
        <div className={styles.guideLegendRow}>
          <span className={styles.guideDot} style={{ background: '#e10600' }} />
          <span><strong style={{ color: '#e10600' }}>Red</strong> — 즉시 조정 필요. 성능에 심각한 영향</span>
        </div>
      </div>

      {/* Card descriptions */}
      <div className={styles.guideSection}>
        <div className={styles.guideSectionHeader}>
          <span className={styles.guideDot} style={{ background: 'var(--accent-blue)' }} />
          <span className={styles.guideSectionTitle}>1. Aerodynamics</span>
        </div>
        <span className={styles.guideSectionDesc}>
          직선 구간(200km/h 이상, 스티어링 입력 미미) 속도와 코너링 G를 분석합니다.
        </span>
        <div className={styles.guideMetric}>
          <span className={styles.guideMetricLabel}>Max Speed</span>
          <span className={styles.guideMetricDesc}>랩 내 최고 직선 속도 (km/h)</span>
        </div>
        <div className={styles.guideMetric}>
          <span className={styles.guideMetricLabel}>Avg Corner G</span>
          <span className={styles.guideMetricDesc}>코너링 중 평균 횡 G-force</span>
        </div>
        <div className={styles.guideMetric}>
          <span className={styles.guideMetricLabel}>Wing Dmg</span>
          <span className={styles.guideMetricDesc}>프론트/리어 윙 손상도 (%)</span>
        </div>
        <div className={styles.guideRec}>
          <span className={styles.guideRecLabel}>Recommendation: </span>
          윙 손상 &gt; 20% 시 최고 속도 감소 경고. 프론트 윙을 낮추면 직선 속도 향상, 높이면 코너 그립 향상
        </div>
      </div>

      <div className={styles.guideSection}>
        <div className={styles.guideSectionHeader}>
          <span className={styles.guideDot} style={{ background: 'var(--accent-blue)' }} />
          <span className={styles.guideSectionTitle}>2. Transmission</span>
        </div>
        <span className={styles.guideSectionDesc}>
          코너 탈출 시(스로틀 &gt; 50%, 스티어링 입력 중) 후륜 휠스핀을 감지합니다.
        </span>
        <div className={styles.guideMetric}>
          <span className={styles.guideMetricLabel}>Wheelspin %</span>
          <span className={styles.guideMetricDesc}>코너 탈출 프레임 중 후륜 슬립이 감지된 비율</span>
        </div>
        <div className={styles.guideMetric}>
          <span className={styles.guideMetricLabel}>Diff On / Off</span>
          <span className={styles.guideMetricDesc}>현재 On-Throttle / Off-Throttle 디퍼렌셜 설정값</span>
        </div>
        <div className={styles.guideRec}>
          <span className={styles.guideRecLabel}>Recommendation: </span>
          Wheelspin &gt; 15% 시 On-Throttle 디퍼렌셜 감소 권장. &gt; 25% 시 즉시 조정 필요
        </div>
      </div>

      <div className={styles.guideSection}>
        <div className={styles.guideSectionHeader}>
          <span className={styles.guideDot} style={{ background: 'var(--accent-blue)' }} />
          <span className={styles.guideSectionTitle}>3. Suspension Geometry</span>
        </div>
        <span className={styles.guideSectionDesc}>
          4휠의 타이어 내부 온도와 표면 온도 차이를 추적하여 캠버/토 설정을 평가합니다.
        </span>
        <div className={styles.guideMetric}>
          <span className={styles.guideMetricLabel}>FL/FR/RL/RR Delta C</span>
          <span className={styles.guideMetricDesc}>각 휠의 (Inner Temp - Surface Temp) 평균 차이</span>
        </div>
        <div className={styles.guideMetric}>
          <span className={styles.guideMetricLabel}>Camber / Toe</span>
          <span className={styles.guideMetricDesc}>현재 캠버 및 토 설정값 (도)</span>
        </div>
        <div className={styles.guideRec}>
          <span className={styles.guideRecLabel}>Recommendation: </span>
          Inner-Surface 차이 &gt; 8 C 시 해당 축 캠버 감소 권장. &gt; 12 C 시 즉시 조정
        </div>
      </div>

      <div className={styles.guideSection}>
        <div className={styles.guideSectionHeader}>
          <span className={styles.guideDot} style={{ background: 'var(--accent-blue)' }} />
          <span className={styles.guideSectionTitle}>4. Suspension</span>
        </div>
        <span className={styles.guideSectionDesc}>
          프론트/리어 에어로 하이트로 바텀아웃(차체 바닥 접촉)을 감지하고 수직 G 스파이크를 카운트합니다.
        </span>
        <div className={styles.guideMetric}>
          <span className={styles.guideMetricLabel}>Bottoming %</span>
          <span className={styles.guideMetricDesc}>에어로 하이트가 임계값 이하인 프레임 비율</span>
        </div>
        <div className={styles.guideMetric}>
          <span className={styles.guideMetricLabel}>G Spikes</span>
          <span className={styles.guideMetricDesc}>수직 G-force가 3G를 초과한 횟수 (연석, 범프)</span>
        </div>
        <div className={styles.guideMetric}>
          <span className={styles.guideMetricLabel}>Floor Dmg</span>
          <span className={styles.guideMetricDesc}>바닥 손상도 (%) — 바텀아웃 누적 결과</span>
        </div>
        <div className={styles.guideRec}>
          <span className={styles.guideRecLabel}>Recommendation: </span>
          Bottoming &gt; 10% 시 라이드 하이트 증가 권장. 플로어 손상 &gt; 20% 시 즉시 라이드 하이트 조정
        </div>
      </div>

      <div className={styles.guideSection}>
        <div className={styles.guideSectionHeader}>
          <span className={styles.guideDot} style={{ background: 'var(--accent-blue)' }} />
          <span className={styles.guideSectionTitle}>5. Brakes</span>
        </div>
        <span className={styles.guideSectionDesc}>
          강한 제동(Brake &gt; 80%) 시 전/후륜 개별 휠 슬립을 분석하여 락업을 감지합니다.
        </span>
        <div className={styles.guideMetric}>
          <span className={styles.guideMetricLabel}>F Lockup %</span>
          <span className={styles.guideMetricDesc}>강한 제동 프레임 중 프론트 휠 락업 비율</span>
        </div>
        <div className={styles.guideMetric}>
          <span className={styles.guideMetricLabel}>R Lockup %</span>
          <span className={styles.guideMetricDesc}>강한 제동 프레임 중 리어 휠 락업 비율</span>
        </div>
        <div className={styles.guideMetric}>
          <span className={styles.guideMetricLabel}>Bias / Pressure</span>
          <span className={styles.guideMetricDesc}>현재 브레이크 바이어스 (%) 및 압력 설정</span>
        </div>
        <div className={styles.guideRec}>
          <span className={styles.guideRecLabel}>Recommendation: </span>
          Front Lockup &gt; Rear 시 바이어스를 뒤로, Rear &gt; Front 시 바이어스를 앞으로 이동.
          전체 락업 &gt; 20% 시 브레이크 압력 감소 고려
        </div>
      </div>

      <div className={styles.guideSection}>
        <div className={styles.guideSectionHeader}>
          <span className={styles.guideDot} style={{ background: 'var(--accent-blue)' }} />
          <span className={styles.guideSectionTitle}>6. Tyres</span>
        </div>
        <span className={styles.guideSectionDesc}>
          4휠의 타이어 압력과 내부 온도를 랩별로 추적합니다. 타이어 관리 및 셋업 최적화의 핵심 지표입니다.
        </span>
        <div className={styles.guideMetric}>
          <span className={styles.guideMetricLabel}>PSI (FL/FR/RL/RR)</span>
          <span className={styles.guideMetricDesc}>각 휠의 평균 타이어 압력 (PSI)</span>
        </div>
        <div className={styles.guideMetric}>
          <span className={styles.guideMetricLabel}>Inner Temp</span>
          <span className={styles.guideMetricDesc}>각 휠의 평균 내부 온도 ( C) — 그립 상태 지표</span>
        </div>
        <div className={styles.guideMetric}>
          <span className={styles.guideMetricLabel}>Compound / Age</span>
          <span className={styles.guideMetricDesc}>현재 컴파운드 종류 및 랩 수</span>
        </div>
        <div className={styles.guideRec}>
          <span className={styles.guideRecLabel}>Recommendation: </span>
          Inner Temp &gt; 100 C 시 타이어 압력 감소 권장. &gt; 105 C 시 즉시 조정 필요. 압력이 높으면 온도가 상승하고 그립이 감소합니다
        </div>
      </div>

      {/* Card structure explanation */}
      <div className={styles.guideLegend}>
        <span className={styles.guideLegendTitle}>Card Structure</span>
        <div className={styles.guideLegendRow}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600, minWidth: 90 }}>Header</span>
          <span>제목 + Severity Dot (색상 점) + 접기/펼치기 토글</span>
        </div>
        <div className={styles.guideLegendRow}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600, minWidth: 90 }}>Live Strip</span>
          <span>현재 실시간 값 표시 (4Hz 업데이트). 게임 진행 중 항상 표시</span>
        </div>
        <div className={styles.guideLegendRow}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600, minWidth: 90 }}>Lap Table</span>
          <span>완료된 랩별 분석 요약. 1랩 완료 후부터 표시</span>
        </div>
        <div className={styles.guideLegendRow}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600, minWidth: 90 }}>Recommend</span>
          <span>임계값 초과 시 셋업 조정 제안. 색상 보더로 심각도 표시</span>
        </div>
      </div>
    </div>
  );
}

type SetupTab = 'diagnosis' | 'speed' | 'chassis' | 'contact';

const TABS: { id: SetupTab; label: string }[] = [
  { id: 'diagnosis', label: 'Diagnosis' },
  { id: 'speed', label: 'Aero / Trans' },
  { id: 'chassis', label: 'Suspension' },
  { id: 'contact', label: 'Brakes / Tyres' },
];

export function SetupAnalysisView() {
  const [showGuide, setShowGuide] = useState(false);
  const [activeTab, setActiveTab] = useState<SetupTab>('diagnosis');
  const [selectedSymptoms, setSelectedSymptoms] = useState<Set<SymptomId>>(new Set());
  const pitwallState = useTelemetryStore((state) => state.pitwallState);
  const drivers = pitwallState?.drivers ?? [];
  const playerIndex = pitwallState?.playerIndex ?? 0;
  const player = drivers[playerIndex];

  if (!player) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.title}>Setup Analysis</span>
          </div>
          <button className={styles.helpBtn} onClick={() => setShowGuide(true)}>Guide</button>
        </div>
        <div className={styles.noData}>
          <span className={styles.noDataText}>Waiting for telemetry data...</span>
        </div>
        {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>Setup Analysis</span>
          <span className={styles.subtitle}>{player.name} — Lap {player.currentLapNum}</span>
        </div>
        <button className={styles.helpBtn} onClick={() => setShowGuide(true)}>Guide</button>
      </div>
      <div className={styles.tabBar}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className={styles.content}>
        {activeTab === 'diagnosis' && (
          <DiagnosisPanel
            driver={player}
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
        {activeTab === 'speed' && (
          <>
            <AerodynamicsCard driver={player} />
            <TransmissionCard driver={player} />
          </>
        )}
        {activeTab === 'chassis' && (
          <>
            <SuspensionGeometryCard driver={player} />
            <SuspensionCard driver={player} />
          </>
        )}
        {activeTab === 'contact' && (
          <>
            <BrakesCard driver={player} />
            <TyresCard driver={player} />
          </>
        )}
      </div>
      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
    </div>
  );
}
