import { useState } from 'react';
import styles from './GuideView.module.css';

type GuideTab = 'cc' | 'strategy' | 'setup' | 'settings' | 'races';

export function GuideView() {
  const [activeTab, setActiveTab] = useState<GuideTab>('cc');

  return (
    <div className={styles.container}>
      <div className={styles.guide}>
        <div className={styles.guideIntro}>
          <span className={styles.guideTitle}>F1 Pitwall Engineer Guide</span>
          <span className={styles.guideDesc}>
            F1 25 실시간 텔레메트리 데이터를 분석하여 최적의 차량 셋업과 레이스 전략을 제안합니다.
            아래 탭을 선택하여 각 화면의 데이터 구성과 활용법을 확인하세요.
          </span>
        </div>

        <div className={styles.guideTabs}>
          <button className={`${styles.guideTab} ${activeTab === 'cc' ? styles.guideTabActive : ''}`} onClick={() => setActiveTab('cc')}>Command Center</button>
          <button className={`${styles.guideTab} ${activeTab === 'strategy' ? styles.guideTabActive : ''}`} onClick={() => setActiveTab('strategy')}>Strategy</button>
          <button className={`${styles.guideTab} ${activeTab === 'setup' ? styles.guideTabActive : ''}`} onClick={() => setActiveTab('setup')}>Setup Analysis</button>
          <button className={`${styles.guideTab} ${activeTab === 'settings' ? styles.guideTabActive : ''}`} onClick={() => setActiveTab('settings')}>Settings</button>
          <button className={`${styles.guideTab} ${activeTab === 'races' ? styles.guideTabActive : ''}`} onClick={() => setActiveTab('races')}>Races</button>
        </div>

        {/* ═══════════════ COMMAND CENTER ═══════════════ */}
        {activeTab === 'cc' && (
          <>
            <div className={styles.guideIntro} style={{ borderBottom: 'none', paddingBottom: 0 }}>
              <span className={styles.guideTitle} style={{ color: '#00ff00' }}>Command Center (커맨드 센터)</span>
              <span className={styles.guideDesc}>
                레이스의 모든 실시간 데이터를 한 화면에서 모니터링하는 메인 대시보드입니다.
                6개 섹션이 2행 3열 그리드로 배치되며, 4Hz(초당 4회)로 업데이트됩니다.
              </span>
            </div>

            {/* 1. Track Map */}
            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: '#00ff00' }} />
                <span className={styles.guideSectionTitle}>1. Track Map (트랙 맵)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                서킷 위에 모든 차량의 실시간 위치를 표시합니다. 60Hz 애니메이션으로 부드럽게 움직입니다.
              </span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Car Positions</span>
                <span className={styles.guideMetricDesc}>모든 차량의 실시간 위치. 플레이어 차량은 녹색 원으로 강조 표시</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Sector Colors</span>
                <span className={styles.guideMetricDesc}>마샬 플래그에 따라 섹터별 색상 변경 (녹색=정상, 노랑=주의, 빨강=위험)</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>DRS Zones</span>
                <span className={styles.guideMetricDesc}>DRS 활성화 구간이 녹색으로 하이라이트</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Turn Numbers</span>
                <span className={styles.guideMetricDesc}>곡률 분석을 통해 자동 감지된 코너 번호 표시</span>
              </div>
              <span className={styles.guideSubLabel}>하단 정보</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Track Temp</span>
                <span className={styles.guideMetricDesc}>노면 온도 (°C) — 타이어 그립과 마모에 직접 영향</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Air Temp</span>
                <span className={styles.guideMetricDesc}>대기 온도 (°C) — 엔진 냉각 및 공기 밀도에 영향</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Track Length</span>
                <span className={styles.guideMetricDesc}>서킷 전체 길이 (km)</span>
              </div>
              <div className={styles.guideTip}>
                <span className={styles.guideTipLabel}>활용 팁: </span>
                섹터 색상이 노란색으로 변하면 해당 구간에서 감속이 필요합니다. SC/VSC 판단의 선행 지표로 활용하세요.
                DRS 존과 앞차와의 갭을 함께 보면 추월 기회를 사전에 파악할 수 있습니다.
              </div>
            </div>

            {/* 2. Pace Analysis */}
            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: '#00ff00' }} />
                <span className={styles.guideSectionTitle}>2. Pace Analysis (페이스 분석)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                랩타임 히스토리, 날씨 예보, 레이스 컨트롤 메시지를 종합하여 페이스 트렌드를 분석합니다.
              </span>
              <span className={styles.guideSubLabel}>랩 히스토리 테이블</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Lap Time</span>
                <span className={styles.guideMetricDesc}>완료된 랩의 총 시간. 베스트 랩은 하이라이트 표시</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>S1 / S2 / S3</span>
                <span className={styles.guideMetricDesc}>각 섹터별 구간 시간. 어느 구간에서 시간을 잃는지 파악 가능</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Delta</span>
                <span className={styles.guideMetricDesc}>베스트 랩 대비 차이. 양수면 느린 랩, 음수면 갱신 가능성</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Avg Pace</span>
                <span className={styles.guideMetricDesc}>평균 랩타임. 전략 계산의 기준값</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Consistency (±σ)</span>
                <span className={styles.guideMetricDesc}>표준편차. 값이 작을수록 일정한 페이스 — 타이어 관리 지표</span>
              </div>
              <span className={styles.guideSubLabel}>날씨 예보</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Weather Timeline</span>
                <span className={styles.guideMetricDesc}>현재 + 향후 5개 구간의 날씨, 강수 확률(%), 트랙 온도 표시</span>
              </div>
              <span className={styles.guideSubLabel}>레이스 컨트롤 로그</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Notifications</span>
                <span className={styles.guideMetricDesc}>최근 5개의 레이스 컨트롤 메시지 (페널티, 경고, 정보) + 타임스탬프</span>
              </div>
              <div className={styles.guideTip}>
                <span className={styles.guideTipLabel}>활용 팁: </span>
                Consistency가 0.5초 이상이면 드라이빙이 불안정하거나 타이어 성능이 떨어지고 있는 신호입니다.
                날씨 예보에서 강수 확률이 40% 이상이면 인터미디엇 타이어 준비를 고려하세요.
              </div>
            </div>

            {/* 3. Tyre Engineering */}
            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: '#00ff00' }} />
                <span className={styles.guideSectionTitle}>3. Tyre Engineering (타이어 엔지니어링)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                타이어 상태와 차량 다이내믹스를 모니터링합니다. "Tyres"와 "Spin" 두 개의 서브 탭으로 구성됩니다.
              </span>
              <span className={styles.guideSubLabel}>Tyres 탭 — 재고 관리</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Compound Alloc.</span>
                <span className={styles.guideMetricDesc}>컴파운드별 (Soft/Medium/Hard/Inter/Wet) 사용/잔여 세트 수 + 게이지 바</span>
              </div>
              <span className={styles.guideSubLabel}>Tyres 탭 — 4휠 실시간 상태</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Wear %</span>
                <span className={styles.guideMetricDesc}>FL/FR/RL/RR 각 휠의 마모도. 녹색(&lt;20%), 노랑(20-50%), 빨강(&gt;50%)</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Surface Temp</span>
                <span className={styles.guideMetricDesc}>타이어 표면 온도 (°C) — 즉각적 그립 수준 지표</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Inner Temp</span>
                <span className={styles.guideMetricDesc}>타이어 내부 온도 (°C) — 장기적 타이어 수명 지표</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Brake Temp</span>
                <span className={styles.guideMetricDesc}>각 휠의 브레이크 온도 (°C)</span>
              </div>
              <span className={styles.guideSubLabel}>Tyres 탭 — 마모 예측</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Laps to go</span>
                <span className={styles.guideMetricDesc}>잔여 랩 수 입력 시 각 휠의 예상 마모도 계산 (절대값/상대값 모드 전환 가능)</span>
              </div>
              <span className={styles.guideSubLabel}>Spin 탭 — 다이내믹스</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Understeer %</span>
                <span className={styles.guideMetricDesc}>랩별 언더스티어 비율 (노란색 바). 코너 진입 시 프론트 그립 부족</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Oversteer %</span>
                <span className={styles.guideMetricDesc}>랩별 오버스티어 비율 (빨간색 바). 코너 탈출 시 리어 불안정</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Lockup / Spin</span>
                <span className={styles.guideMetricDesc}>랩별 브레이크 락업 및 스핀 발생 횟수</span>
              </div>
              <div className={styles.guideTip}>
                <span className={styles.guideTipLabel}>활용 팁: </span>
                마모 예측에서 잔여 랩 수를 입력하면 스틴트 종료 시점의 타이어 상태를 미리 볼 수 있어 피트 스톱 타이밍 결정에 유용합니다.
                Spin 탭의 언더/오버스티어 트렌드가 랩마다 증가하면 타이어 성능 저하 신호입니다.
              </div>
            </div>

            {/* 4. Leaderboard */}
            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: '#00ff00' }} />
                <span className={styles.guideSectionTitle}>4. Leaderboard (리더보드)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                전체 드라이버의 순위, 갭, 타이어, 페이스를 한눈에 보는 종합 순위표입니다.
                열(column) 토글 버튼으로 표시 항목을 선택할 수 있습니다.
              </span>
              <span className={styles.guideSubLabel}>기본 열</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>P (Position)</span>
                <span className={styles.guideMetricDesc}>현재 순위</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Driver</span>
                <span className={styles.guideMetricDesc}>드라이버 이름 + 팀 컬러 바. 플레이어 행은 강조 표시</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Gap</span>
                <span className={styles.guideMetricDesc}>리더 대비 시간 차이. 앞차와 1초 이내 시 DRS 배지 표시</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Tyre</span>
                <span className={styles.guideMetricDesc}>현재 컴파운드 + 사용 랩 수 아이콘</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>S1 / S2 / S3</span>
                <span className={styles.guideMetricDesc}>최근 랩의 각 섹터 시간</span>
              </div>
              <span className={styles.guideSubLabel}>토글 가능 열</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Stints</span>
                <span className={styles.guideMetricDesc}>컴파운드별 스틴트 히스토리 (색상 점으로 표시). 상대 전략 파악 핵심</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Last / Best</span>
                <span className={styles.guideMetricDesc}>최근 랩타임 / 베스트 랩타임</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Pen</span>
                <span className={styles.guideMetricDesc}>페널티(P) / 경고(W) 횟수. 호버 시 상세 내용 툴팁</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Pace Delta</span>
                <span className={styles.guideMetricDesc}>최근 N랩 평균 페이스 차이 (1~20랩 설정 가능, 기본 3랩)</span>
              </div>
              <span className={styles.guideSubLabel}>특수 인디케이터</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel} style={{ color: '#e10600' }}>! (Damage)</span>
                <span className={styles.guideMetricDesc}>빨간 배지 — 해당 차량에 손상 발생 (damage &gt; 0)</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel} style={{ color: '#ff9800' }}>W (Wing)</span>
                <span className={styles.guideMetricDesc}>주황 배지 — 윙 손상 심각 (&gt;75%). 해당 차량 페이스 저하 예상</span>
              </div>
              <div className={styles.guideTip}>
                <span className={styles.guideTipLabel}>활용 팁: </span>
                Stints 열을 켜면 경쟁자의 피트 전략을 추적할 수 있습니다.
                Pace Delta 윈도우를 5~10랩으로 설정하면 스틴트 후반부 타이어 열화를 감지할 수 있고,
                상대보다 더 짧은 간격의 Pace Delta를 활용하면 단기 페이스 변화를 빠르게 포착합니다.
              </div>
            </div>

            {/* 5. Battle Controls */}
            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: '#00ff00' }} />
                <span className={styles.guideSectionTitle}>5. Battle Controls (배틀 컨트롤)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                차량의 에너지/연료 상태와 전후방 경쟁자와의 배틀 상황을 실시간으로 표시합니다.
              </span>
              <span className={styles.guideSubLabel}>Car Controls HUD</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>ERS</span>
                <span className={styles.guideMetricDesc}>현재 배터리 모드 + 잔량 %. 녹색(&gt;60%), 노랑(30-60%), 빨강(&lt;30%)</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Fuel</span>
                <span className={styles.guideMetricDesc}>잔여 주행 가능 랩 수 + 탱크 내 연료(kg). 녹색(&gt;5L), 노랑(2-5L), 빨강(&lt;2L)</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Brake Bias</span>
                <span className={styles.guideMetricDesc}>현재 브레이크 바이어스 (%)</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Differential</span>
                <span className={styles.guideMetricDesc}>On-Throttle / Off-Throttle 디퍼렌셜 설정 (ON/OFF 상태 표시)</span>
              </div>
              <span className={styles.guideSubLabel}>Battle Cards</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Car Ahead</span>
                <span className={styles.guideMetricDesc}>앞차 드라이버명, 순위, 갭, 타이어 정보 + 트렌드 화살표 (▼접근 중 / ▲벌어짐)</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Car Behind</span>
                <span className={styles.guideMetricDesc}>뒷차 동일 정보 + 트렌드 화살표</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Est. Overtake Lap</span>
                <span className={styles.guideMetricDesc}>갭 변화율을 기반으로 추월/피추월이 예상되는 랩 번호</span>
              </div>
              <div className={styles.guideTip}>
                <span className={styles.guideTipLabel}>활용 팁: </span>
                ERS 잔량이 30% 미만일 때는 추월 시도를 자제하세요. 방어 시에는 직선 구간에서 ERS를 집중 사용합니다.
                연료가 빨간색이면 Lift &amp; Coast가 필요한 상태입니다.
                Est. Overtake Lap이 표시되면 공격/방어 준비 시점을 사전에 계획할 수 있습니다.
              </div>
            </div>

            {/* 6. Strategy Health */}
            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: '#00ff00' }} />
                <span className={styles.guideSectionTitle}>6. Strategy Health (차량 상태)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                차량 부품의 고장 여부와 손상도를 한눈에 파악합니다.
              </span>
              <span className={styles.guideSubLabel}>시스템 상태</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>DRS Status</span>
                <span className={styles.guideMetricDesc}>DRS 시스템 정상(OK) 또는 고장(FAULT). 고장 시 DRS 사용 불가</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>ERS Status</span>
                <span className={styles.guideMetricDesc}>ERS 시스템 정상(OK) 또는 고장(FAULT). 고장 시 에너지 회수 불가</span>
              </div>
              <span className={styles.guideSubLabel}>부품별 손상도 (0~100%)</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>FL / FR Wing</span>
                <span className={styles.guideMetricDesc}>프론트 좌/우 윙 손상. 다운포스와 코너 밸런스에 직접 영향</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Rear Wing</span>
                <span className={styles.guideMetricDesc}>리어 윙 손상. 고속 안정성과 DRS 효율에 영향</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Floor</span>
                <span className={styles.guideMetricDesc}>바닥 손상. 전체 다운포스의 핵심 — 바텀아웃 누적 결과</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Diffuser</span>
                <span className={styles.guideMetricDesc}>디퓨저 손상. 리어 다운포스와 공기 흐름에 영향</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Sidepod</span>
                <span className={styles.guideMetricDesc}>사이드팟 손상. 냉각 효율에 영향</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Engine</span>
                <span className={styles.guideMetricDesc}>엔진 손상. 최고 출력과 신뢰성에 영향</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Gearbox</span>
                <span className={styles.guideMetricDesc}>기어박스 손상. 변속 성능에 영향</span>
              </div>
              <div className={styles.guideTip}>
                <span className={styles.guideTipLabel}>활용 팁: </span>
                손상도 색상: 녹색(&lt;20%) 정상, 노랑(20-50%) 주의, 빨강(&gt;50%) 심각.
                Floor 손상이 20%를 넘으면 랩타임에 0.5초 이상 영향을 줄 수 있습니다.
                프론트 윙 좌우 손상이 다르면 코너 밸런스가 비대칭이 되어 핸들링에 큰 영향을 줍니다.
              </div>
            </div>
          </>
        )}

        {/* ═══════════════ STRATEGY ═══════════════ */}
        {activeTab === 'strategy' && (
          <>
            <div className={styles.guideIntro} style={{ borderBottom: 'none', paddingBottom: 0 }}>
              <span className={styles.guideTitle} style={{ color: 'var(--accent-red)' }}>전략 (Strategy) 탭 활용 가이드</span>
              <span className={styles.guideDesc}>
                레이스 중 드라이버에게 &quot;지금 푸시할지(Push), 타이어를 아낄지(Hold), 피트인할지(Box)&quot;에 대한
                명확한 지침을 제공하기 위한 엔지니어 전용 지휘소입니다.
              </span>
            </div>

            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: 'var(--accent-red)' }} />
                <span className={styles.guideSectionTitle}>1. Direct Combat Advisor (교전 어시스트)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                상대 차량과의 페이스 차이와 타이어 마모도를 분석하여 실시간 행동 지침을 내립니다.
              </span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel} style={{ color: '#00ff00' }}>PUSH NOW</span>
                <span className={styles.guideMetricDesc}>내 타이어가 더 신선하고 페이스가 0.4초 이상 빠를 때 추월 시도 지시</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel} style={{ color: '#ffcc00' }}>HOLD & MANAGE</span>
                <span className={styles.guideMetricDesc}>페이스가 비슷하거나 타이어 관리가 필요할 때 페이스 유지 및 타겟 랩 브리핑</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel} style={{ color: '#e10600' }}>DEFEND NOW</span>
                <span className={styles.guideMetricDesc}>뒷차의 추월 위협이 감지될 때 직선 구간 ERS 사용 및 방어 지시</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel} style={{ color: '#9c27b0' }}>LIFT & COAST</span>
                <span className={styles.guideMetricDesc}>타이어나 브레이크 온도가 임계치를 초과하여 쿨링이 시급할 때 연비 주행 지시</span>
              </div>
              <div className={styles.guideLegend}>
                <span className={styles.guideLegendTitle}>판단 기준</span>
                <div className={styles.guideLegendRow}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600, minWidth: 90 }}>Pace</span>
                  <span>최근 랩타임 비교 — 0.4초 이상 차이가 나면 PUSH/DEFEND 트리거</span>
                </div>
                <div className={styles.guideLegendRow}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600, minWidth: 90 }}>Tyre Age</span>
                  <span>타이어 나이 1랩당 약 0.08초 페널티로 환산하여 비교</span>
                </div>
                <div className={styles.guideLegendRow}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600, minWidth: 90 }}>Compound</span>
                  <span>S(0s) → M(+0.3s) → H(+0.6s) → I(+1.5s) → W(+3.0s) 페널티 적용</span>
                </div>
                <div className={styles.guideLegendRow}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600, minWidth: 90 }}>Temperature</span>
                  <span>타이어 표면 &gt;105°C 또는 브레이크 &gt;850°C 시 LIFT &amp; COAST 발동</span>
                </div>
              </div>
            </div>

            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: 'var(--accent-red)' }} />
                <span className={styles.guideSectionTitle}>2. Pace Delta Chart (페이스 트렌드)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                최근 10랩 동안 앞차와의 간격(Gap) 변화를 그래프로 표시합니다.
              </span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Green Line</span>
                <span className={styles.guideMetricDesc}>간격이 줄어들고 있음 (Catching). 현재 페이스가 우위임</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Red Line</span>
                <span className={styles.guideMetricDesc}>간격이 벌어지고 있음 (Falling Back). 페이스 회복 필요</span>
              </div>
              <div className={styles.guideTip}>
                <span className={styles.guideTipLabel}>활용 팁: </span>
                그래프 기울기가 급격히 변하는 시점은 보통 타이어 성능 절벽(cliff)이나 DRS 효과입니다.
                5랩 이상 지속적으로 Green이면 추월 기회가 임박했다는 의미입니다.
              </div>
            </div>

            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: 'var(--accent-red)' }} />
                <span className={styles.guideSectionTitle}>3. SC Window Alert (세이프티카 윈도우)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                세이프티카 투입 가능성이 높은 구간을 사전에 경고합니다.
              </span>
              <div className={styles.guideTip}>
                <span className={styles.guideTipLabel}>활용 팁: </span>
                SC 윈도우 알림이 뜨면 피트 스톱을 늦춰 무료 피트의 이점을 노릴 수 있습니다.
              </div>
            </div>

            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: 'var(--accent-red)' }} />
                <span className={styles.guideSectionTitle}>4. Master Strategy Board (스틴트 플래너)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                피트 스톱 타이밍과 레이스 전체 흐름을 관리합니다.
              </span>
              <span className={styles.guideSubLabel}>Pit Window Radar</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Rejoin Position</span>
                <span className={styles.guideMetricDesc}>지금 피트인 시 예상 복귀 순위</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Traffic Badge</span>
                <span className={styles.guideMetricDesc}>복귀 위치의 전후방 차량과의 갭이 1.5초 미만이면 "Traffic", 이상이면 "Clear Air"</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Stint Progress</span>
                <span className={styles.guideMetricDesc}>현재 랩 vs 피트 윈도우 이상 랩. 프로그레스 바로 피트 타이밍 시각화</span>
              </div>
              <span className={styles.guideSubLabel}>알림 시스템</span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Undercut Alert</span>
                <span className={styles.guideMetricDesc}>경쟁자가 피트인하면 &quot;BOX TO COVER&quot; 경고 점멸. 언더컷 방어 유도</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Overcut Alert</span>
                <span className={styles.guideMetricDesc}>경쟁자가 피트인하고 내가 아직 트랙에 있으면 오버컷 기회 알림</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Weather Alert</span>
                <span className={styles.guideMetricDesc}>15분 내 강수 확률 &gt;40% 시 피트 스톱을 늦추도록 알림 제공</span>
              </div>
              <div className={styles.guideTip}>
                <span className={styles.guideTipLabel}>활용 팁: </span>
                Traffic 배지가 표시되면 1~2랩 대기 후 Clean Air 상태에서 피트인하는 것이 유리합니다.
                Undercut Alert 발생 시 즉시 피트인하면 순위 손실을 최소화할 수 있습니다.
              </div>
            </div>
          </>
        )}

        {/* ═══════════════ SETUP ANALYSIS ═══════════════ */}
        {activeTab === 'setup' && (
          <>
            <div className={styles.guideIntro} style={{ borderBottom: 'none', paddingBottom: 0 }}>
              <span className={styles.guideTitle}>셋업 분석 (Setup Analysis) 가이드</span>
              <span className={styles.guideDesc}>
                차량의 기계적 성능을 평가합니다. 3개의 서브 탭(Diagnosis, Overview, Feedback)에서
                6가지 핵심 영역의 데이터를 랩별로 요약하고 셋업 조정 권고사항을 제공합니다.
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

            {/* Sub-tab descriptions */}
            <div className={styles.guideLegend}>
              <span className={styles.guideLegendTitle}>서브 탭 구성</span>
              <div className={styles.guideLegendRow}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, minWidth: 90 }}>Diagnosis</span>
                <span>증상 선택(언더스티어, 오버스티어 등) → 우선순위별 원인 분석 + 신뢰도 표시 (HIGH/MED/LOW)</span>
              </div>
              <div className={styles.guideLegendRow}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, minWidth: 90 }}>Overview</span>
                <span>6개 셋업 카드 그리드 — 아래 상세 설명 참조</span>
              </div>
              <div className={styles.guideLegendRow}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, minWidth: 90 }}>Feedback</span>
                <span>랩별 셋업 변경 이력 및 개선/악화 피드백 추적</span>
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
                <span className={styles.guideMetricLabel}>FL/FR/RL/RR Delta</span>
                <span className={styles.guideMetricDesc}>각 휠의 (Inner Temp - Surface Temp) 평균 차이 (°C)</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Camber / Toe</span>
                <span className={styles.guideMetricDesc}>현재 캠버 및 토 설정값 (도)</span>
              </div>
              <div className={styles.guideRec}>
                <span className={styles.guideRecLabel}>Recommendation: </span>
                Inner-Surface 차이 &gt; 8°C 시 해당 축 캠버 감소 권장. &gt; 12°C 시 즉시 조정
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
                <span className={styles.guideMetricDesc}>각 휠의 평균 내부 온도 (°C) — 그립 상태 지표</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Compound / Age</span>
                <span className={styles.guideMetricDesc}>현재 컴파운드 종류 및 랩 수</span>
              </div>
              <div className={styles.guideRec}>
                <span className={styles.guideRecLabel}>Recommendation: </span>
                Inner Temp &gt; 100°C 시 타이어 압력 감소 권장. &gt; 105°C 시 즉시 조정 필요. 압력이 높으면 온도가 상승하고 그립이 감소합니다
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
          </>
        )}

        {/* ═══════════════ SETTINGS ═══════════════ */}
        {activeTab === 'settings' && (
          <>
            <div className={styles.guideIntro} style={{ borderBottom: 'none', paddingBottom: 0 }}>
              <span className={styles.guideTitle}>설정 (Settings) 가이드</span>
              <span className={styles.guideDesc}>
                서버 포트, 데이터 저장 방식, UDP 포워딩, 트랙 레코딩 등 애플리케이션 환경을 설정합니다.
                로컬 모드에서만 사용 가능합니다.
              </span>
            </div>

            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: 'var(--text-secondary)' }} />
                <span className={styles.guideSectionTitle}>1. Port Settings (포트 설정)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                서버가 사용하는 네트워크 포트를 설정합니다. 변경 시 서버가 자동으로 핫 리로드됩니다.
              </span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Backend Port</span>
                <span className={styles.guideMetricDesc}>웹 대시보드 및 API 서버 포트 (기본: 8080). 브라우저 접속 주소에 사용</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>UDP Port</span>
                <span className={styles.guideMetricDesc}>F1 25 게임 텔레메트리 수신 포트 (기본: 20777). 게임 설정과 동일하게 맞출 것</span>
              </div>
              <div className={styles.guideTip}>
                <span className={styles.guideTipLabel}>활용 팁: </span>
                게임의 Settings &gt; Telemetry &gt; IP Address와 Port가 이 설정과 일치해야 데이터가 수신됩니다.
                같은 PC에서 실행 시 IP는 127.0.0.1, 다른 기기에서는 서버 PC의 로컬 IP를 입력하세요.
              </div>
            </div>

            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: 'var(--text-secondary)' }} />
                <span className={styles.guideSectionTitle}>2. Data Storage Mode (데이터 저장 방식)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                레이스 데이터의 저장 범위를 설정합니다. 모드에 따라 디스크 사용량이 달라집니다.
              </span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Advanced</span>
                <span className={styles.guideMetricDesc}>전체 UDP 패킷 로깅 + 리플레이 스냅샷 저장. 상세 분석 가능. 높은 디스크 사용</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Summary</span>
                <span className={styles.guideMetricDesc}>대시보드 스냅샷만 저장. 리플레이 재생 가능. 적당한 디스크 사용</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Result Only</span>
                <span className={styles.guideMetricDesc}>레이스 결과 요약만 저장. 리플레이 불가. 최소 디스크 사용</span>
              </div>
              <div className={styles.guideTip}>
                <span className={styles.guideTipLabel}>활용 팁: </span>
                셋업 분석과 레이스 리플레이를 활용하려면 Summary 이상을 권장합니다.
                Advanced는 디스크를 많이 사용하므로 특별한 분석 목적이 있을 때만 사용하세요.
              </div>
            </div>

            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: 'var(--text-secondary)' }} />
                <span className={styles.guideSectionTitle}>3. UDP Forwarding (UDP 포워딩)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                수신된 텔레메트리 데이터를 다른 기기나 앱으로 동시에 전달합니다. 최대 16개 타겟 설정 가능.
              </span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Host</span>
                <span className={styles.guideMetricDesc}>포워딩 대상 IP 주소 또는 호스트명</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Port</span>
                <span className={styles.guideMetricDesc}>포워딩 대상 포트 번호 (1~65535)</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Enable Toggle</span>
                <span className={styles.guideMetricDesc}>개별 타겟의 활성/비활성 전환</span>
              </div>
              <div className={styles.guideTip}>
                <span className={styles.guideTipLabel}>활용 팁: </span>
                SimHub, 모션 시뮬레이터 등 다른 텔레메트리 앱과 동시에 사용할 때 유용합니다.
                F1 25 게임은 하나의 UDP 대상만 지원하므로, 이 포워딩 기능으로 여러 앱에 데이터를 분배하세요.
              </div>
            </div>

            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: 'var(--text-secondary)' }} />
                <span className={styles.guideSectionTitle}>4. Track Recording (트랙 레코딩)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                주행 중 차량 위치 데이터를 기록하여 트랙 맵 SVG를 생성합니다.
              </span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Record Toggle</span>
                <span className={styles.guideMetricDesc}>활성화 후 1랩을 주행하면 해당 서킷의 트랙 데이터가 CSV로 저장됨</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Loaded Tracks</span>
                <span className={styles.guideMetricDesc}>현재 로드된 트랙 파일 목록. 기록된 트랙은 Track Map 섹션에서 자동 사용</span>
              </div>
              <div className={styles.guideTip}>
                <span className={styles.guideTipLabel}>활용 팁: </span>
                각 서킷마다 최초 1회만 기록하면 됩니다. 이미 기록된 트랙은 자동으로 로드됩니다.
              </div>
            </div>

            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: 'var(--text-secondary)' }} />
                <span className={styles.guideSectionTitle}>5. Display (표시 설정)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                대시보드의 데이터 표시 방식을 조정합니다.
              </span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Tyre Wear Mode</span>
                <span className={styles.guideMetricDesc}>
                  Absolute: N랩 후 총 마모도 표시 (예: 75%) / Relative: N랩 동안 추가 마모만 표시 (예: +15%)
                </span>
              </div>
              <div className={styles.guideTip}>
                <span className={styles.guideTipLabel}>활용 팁: </span>
                스틴트 잔여 구간의 타이어 상태를 보려면 Absolute, 현재 마모 속도를 파악하려면 Relative가 유용합니다.
              </div>
            </div>
          </>
        )}

        {/* ═══════════════ RACES ═══════════════ */}
        {activeTab === 'races' && (
          <>
            <div className={styles.guideIntro} style={{ borderBottom: 'none', paddingBottom: 0 }}>
              <span className={styles.guideTitle} style={{ color: '#9c27b0' }}>레이스 기록 (Races) 가이드</span>
              <span className={styles.guideDesc}>
                저장된 레이스 결과를 열람하고, 리플레이 기능으로 과거 레이스를 프레임 단위로 되돌려 볼 수 있습니다.
                로컬 모드에서만 사용 가능합니다.
              </span>
            </div>

            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: '#9c27b0' }} />
                <span className={styles.guideSectionTitle}>1. Race History (레이스 목록)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                저장된 모든 레이스의 요약 정보를 목록으로 표시합니다.
              </span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Date</span>
                <span className={styles.guideMetricDesc}>레이스 날짜 및 시간</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Track</span>
                <span className={styles.guideMetricDesc}>서킷 이름</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Session Type</span>
                <span className={styles.guideMetricDesc}>세션 유형 (Race, Qualifying, Practice 등)</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Driver / Position</span>
                <span className={styles.guideMetricDesc}>플레이어 이름 및 최종 순위</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Storage Mode</span>
                <span className={styles.guideMetricDesc}>해당 레이스의 데이터 저장 방식 (리플레이 가용 여부 판단)</span>
              </div>
            </div>

            <div className={styles.guideSection}>
              <div className={styles.guideSectionHeader}>
                <span className={styles.guideDot} style={{ background: '#9c27b0' }} />
                <span className={styles.guideSectionTitle}>2. Replay (리플레이)</span>
              </div>
              <span className={styles.guideSectionDesc}>
                Summary 또는 Advanced 모드로 저장된 레이스를 프레임 단위로 되돌려 봅니다.
              </span>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Timeline Scrubber</span>
                <span className={styles.guideMetricDesc}>타임라인을 드래그하여 원하는 시점으로 이동</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Playback Control</span>
                <span className={styles.guideMetricDesc}>재생/일시정지 및 속도 조절</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Leaderboard</span>
                <span className={styles.guideMetricDesc}>해당 시점의 전체 순위표 스냅샷</span>
              </div>
              <div className={styles.guideMetric}>
                <span className={styles.guideMetricLabel}>Track Map</span>
                <span className={styles.guideMetricDesc}>해당 시점의 차량 위치 표시</span>
              </div>
              <div className={styles.guideTip}>
                <span className={styles.guideTipLabel}>활용 팁: </span>
                피트 스톱 직전/직후의 순위 변동을 리플레이로 확인하면 전략 판단의 정확성을 리뷰할 수 있습니다.
                특정 배틀 구간을 프레임 단위로 분석하여 다음 레이스의 전술을 개선하세요.
              </div>
            </div>

            <div className={styles.guideLegend}>
              <span className={styles.guideLegendTitle}>Storage Mode별 리플레이 가용 범위</span>
              <div className={styles.guideLegendRow}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, minWidth: 90 }}>Advanced</span>
                <span>전체 리플레이 + 상세 셋업 분석 데이터 포함</span>
              </div>
              <div className={styles.guideLegendRow}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, minWidth: 90 }}>Summary</span>
                <span>대시보드 스냅샷 기반 리플레이 가능</span>
              </div>
              <div className={styles.guideLegendRow}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600, minWidth: 90 }}>Result Only</span>
                <span>결과 요약만 저장. 리플레이 불가</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
