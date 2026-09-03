import type { CSSProperties, ReactNode } from 'react';
import type { HubTheme } from '../theme';
import styles from './Guide.module.css';

interface Props {
  t: HubTheme;
  onLaunchLive: () => void;
  onGoOverview: () => void;
}

interface Term {
  name: string;
  meaning: string;
  reading: string;
}

const RACE_TERMS: Term[] = [
  { name: 'Pos', meaning: '현재 트랙 순위', reading: 'P1이 선두입니다.' },
  { name: 'To You', meaning: '해당 차량과 내 차량의 시간차', reading: 'YOU는 내 차, 숫자는 초 단위 차이입니다.' },
  { name: 'Interval / Int', meaning: '바로 앞 차량까지의 시간차', reading: '리더 기준 누적 차이인 Gap/Leader와 구분합니다.' },
  { name: 'Last / Best', meaning: '직전 완주 랩 / 세션 개인 최고 랩', reading: '값이 작을수록 빠릅니다.' },
  { name: 'S1 · S2 · S3', meaning: '랩을 3개 구간으로 나눈 섹터 기록', reading: 'Race 표는 현재 완료 섹터를 우선하고 새 랩 S1 전에는 직전 랩을 유지합니다.' },
  { name: 'DRS / OVT', meaning: 'F1 25 DRS / F1 26 Overtake 가용·작동 상태', reading: '배지 도움말로 available과 active를 구분합니다.' },
  { name: 'ERS', meaning: '사용 가능한 에너지 비율', reading: '실측을 우선하며, 실측이 없으면 추정값을 표시할 수 있습니다.' },
  { name: 'Fuel', meaning: '완주에 필요한 연료 대비 랩 단위 여유', reading: '+는 여유, −는 부족입니다. Pitwall에서는 내 팀 차량만 공개됩니다.' },
  { name: 'Pen', meaning: '페널티·경고', reading: 'SG=Stop-Go, DT=Drive-Through, +N=시간 페널티이며 3W는 경고 3회라는 뜻입니다.' },
  { name: 'Tyre · Life · Age', meaning: '컴파운드 / 사용 가능 수명 / 현재 스틴트 랩 수', reading: 'S/M/H/I/W는 Soft/Medium/Hard/Intermediate/Wet입니다.' },
  { name: 'Wear FL/FR/RL/RR', meaning: '각 타이어 마모율', reading: 'Front/Rear와 Left/Right 조합이며 숫자가 높을수록 많이 닳았습니다.' },
  { name: 'Damage FL/FR/RW/OT', meaning: '앞 왼쪽·오른쪽 윙, 리어 윙, 기타 차체 손상', reading: 'OT는 floor·diffuser·sidepod 중 가장 큰 손상률입니다.' },
  { name: 'Pit / Vmax', meaning: '현재 피트 상태 / 최고 속도', reading: 'Vmax는 km/h입니다.' },
];

const QUALI_TERMS: Term[] = [
  { name: 'Quali Gap', meaning: '폴 포지션 최고 랩 대비 차이', reading: 'POLE이 기준이며 +값이 클수록 뒤처진 기록입니다.' },
  { name: 'Cutoff / Margin', meaning: '다음 세션 진출 마지막 순위 / 그 경계와의 기록 차이', reading: '붉은 구분선 아래는 현재 탈락권입니다.' },
  { name: 'Δ to Best (live)', meaning: '완료된 S1·S2의 개인 섹터 베스트 대비 델타 합', reading: '완성 랩 예측이 아닙니다. −는 개인 기준보다 빠른 흐름입니다.' },
  { name: 'My Lap S1/S2/S3', meaning: '현재 완료 섹터와 직전 완료 랩 섹터', reading: 'S1·S2는 현재 값 우선, 아직 없는 값과 S3는 직전 완료 랩을 사용합니다.' },
  { name: 'TRY / BUILD / COOL', meaning: '공격 랩 가능성을 보여주는 내부 휴리스틱', reading: '섹터·ERS·DRS/OVT·랩 상태를 조합한 안내이며 공식 게임 상태가 아닙니다.' },
  { name: 'Status', meaning: 'PIT·FLY·IN·OUT·GAR 상태', reading: 'Flying lap, In lap, Out lap, Garage를 뜻합니다.' },
  { name: 'Lap Phase / Push', meaning: '현재 랩 단계 / 연속 푸시 랩 수', reading: 'Run #은 현재 어택 시도 번호입니다.' },
];

const WORLD_TERMS: Term[] = [
  { name: 'Leader / Int', meaning: '리더까지의 누적 시간차 / 바로 앞차까지의 시간차', reading: '둘 다 초 단위이며 기준 차량이 다릅니다.' },
  { name: '+/−', meaning: '스타팅 그리드 대비 순위 변화', reading: '▲는 순위 상승, ▼는 하락입니다.' },
  { name: 'Live Battles', meaning: '가까운 두 차량의 추격 상황', reading: '공격 차량, 방어 차량, 현재 갭과 closing/opening 추세를 함께 봅니다.' },
  { name: 'Predict / Confidence', meaning: '갭 추세·현재 갭·DRS/OVT 신호를 조합한 내부 휴리스틱', reading: '확률 모델이나 경기 결과 보장이 아니며 막대는 신호 강도입니다.' },
  { name: 'Pitted / Damaged', meaning: '한 번 이상 피트한 차량 / 손상 임계치를 넘은 차량', reading: 'Pitted는 현재 피트 안에 있는 차량 수가 아닙니다.' },
  { name: 'Dry / Wet Crossover', meaning: '드라이·웨트 타이어 그룹의 현재 페이스 비교', reading: 'delta와 랩당 변화량을 함께 보며 데이터가 부족하면 표시하지 않습니다.' },
];

const SOURCE_TERMS: Term[] = [
  { name: 'live', meaning: '현재 세션에서 직접 들어온 값 또는 실측값', reading: '가장 최신인 대신 순간 변동이 있습니다.' },
  { name: 'game', meaning: '게임이 직접 제공한 projection', reading: '예: 피트 중 Rejoin 위치입니다.' },
  { name: 'est', meaning: '현재 필드와 pit-loss로 계산한 추정값', reading: '~ 표기와 함께 참고값으로 사용합니다.' },
  { name: 'projection', meaning: '게임 또는 제한된 입력으로 계산한 시나리오', reading: '확정 결과가 아닙니다.' },
  { name: 'set', meaning: 'Display Settings에서 사용자가 지정한 값', reading: '예: 사용자 pit-loss 폴백입니다.' },
  { name: '— / unavailable', meaning: '원본 데이터가 없거나 계산 근거가 부족함', reading: '0으로 간주하지 않습니다.' },
];

export function Guide({ t, onLaunchLive, onGoOverview }: Props) {
  const themeVars = {
    '--guide-panel': t.panel,
    '--guide-panel2': t.panel2,
    '--guide-inset': t.inset,
    '--guide-line': t.line,
    '--guide-line2': t.line2,
    '--guide-text': t.t1,
    '--guide-sub': t.t2,
    '--guide-muted': t.t3,
    '--guide-accent': t.acc,
    '--guide-accent-ink': t.accInk,
    '--guide-accent-soft': t.accSoft,
  } as CSSProperties;

  return (
    <section className={styles.root} style={themeVars} aria-labelledby="guide-title">
      <div className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>START HERE · FRC ENGINEER</div>
          <h1 id="guide-title">피트월 사용 가이드</h1>
          <p>연결부터 실시간 데이터 판독, 인터컴 운용까지 실제 화면에 표시되는 용어를 기준으로 정리했습니다.</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={onLaunchLive}>LIVE 피트월 시작</button>
          <button type="button" className={styles.secondary} onClick={onGoOverview}>Overview 보기</button>
        </div>
      </div>

      <nav className={styles.jumpNav} aria-label="가이드 목차">
        <a href="#guide-start">시작 순서</a>
        <a href="#guide-screens">화면 읽기</a>
        <a href="#guide-intercom">인터컴</a>
        <a href="#guide-data">데이터 사전</a>
        <a href="#guide-sources">출처 표기</a>
      </nav>

      <GuideSection id="guide-start" index="01" title="처음 연결하기">
        <div className={styles.stepGrid}>
          <Step n="1" title="Driver Pack 실행">드라이버 PC에서 Sender가 Online인지 확인하고 생성된 룸 코드와 비밀번호를 팀에 공유합니다.</Step>
          <Step n="2" title="LIVE · 피트월">Hub 왼쪽의 LIVE 버튼을 누르고 Signaling Server의 활성 룸을 선택해 P2P 텔레메트리에 입장합니다.</Step>
          <Step n="3" title="목적에 맞는 화면">레이스 엔지니어링은 RACE, 예선은 QUALI, 전체 경기 관찰은 WORLD FEED를 사용합니다.</Step>
          <Step n="4" title="인터컴 입장">Driver Pack에서 그룹을 만들고 Pitwall 엔지니어가 Group code와 비밀번호로 참가합니다.</Step>
        </div>
      </GuideSection>

      <GuideSection id="guide-screens" index="02" title="화면별로 무엇을 보는가">
        <div className={styles.cardGrid}>
          <InfoCard title="RACE · Pitwall">
            <li><b>Cockpit Leaderboard</b>: 순위, 내 차 기준 갭, 앞차 간격, 타이어·연료·손상을 한 표에서 비교합니다.</li>
            <li><b>OPEN</b>: 드라이버별 최근 랩과 섹터 그래프를 열고 SOLO·ME+RIVALS·PICK으로 비교합니다.</li>
            <li><b>My Car</b>: 내 순위, 앞뒤차 간격, 직전 랩 페이스, ERS와 피트 윈도우를 빠르게 봅니다.</li>
            <li><b>Pit Exit</b>: 지금 피트하면 예상되는 재합류 순위와 앞뒤 차량을 확인합니다.</li>
            <li><b>Tyre Predictor</b>: +Laps 또는 At Lap에 예상 마모도를 투영합니다. 확정 수명이 아닙니다.</li>
          </InfoCard>
          <InfoCard title="QUALI · Qualifying">
            <li><b>Classification</b>: 폴 대비 기록과 컷오프 아래 탈락권을 봅니다.</li>
            <li><b>My Lap</b>: 현재 랩 단계, 부분 섹터 델타, 트랙 진행률과 주변 차량을 확인합니다.</li>
            <li><b>Cutoff Watch</b>: 현재 진출 상태와 컷오프 마진, 다음 행동 안내를 봅니다.</li>
            <li>QUALI 탭은 실제 예선 세션에서만 활성화됩니다.</li>
          </InfoCard>
          <InfoCard title="WORLD FEED · 전체 경기">
            <li><b>Running Order</b>: 전 차량의 리더 갭, 앞차 간격, 순위 변화와 연료를 봅니다.</li>
            <li><b>Live Battles</b>: 접근 중인 차량 쌍과 갭 추세를 찾아냅니다.</li>
            <li><b>Field Status</b>: 한 번 이상 피트한 차량, 손상 차량, 컴파운드 분포를 요약합니다.</li>
            <li><b>Strategy / Issue Feed</b>: 피트 윈도우·날씨 크로스오버와 레이스 컨트롤 이벤트를 확인합니다.</li>
          </InfoCard>
          <InfoCard title="공통 기능">
            <li><b>Settings</b>: 리더보드 컬럼, 컬럼 폭, 패널, 날씨 간격과 pit-loss 폴백을 조정합니다.</li>
            <li><b>Archive</b>: 저장된 경기 결과와 리플레이를 엽니다.</li>
            <li><b>Setup</b>: 트랙·날씨·팀 조건에 맞는 셋업을 관리합니다.</li>
            <li><b>Weather</b>: TRK/AIR 온도와 선택 간격별 강수 예보를 읽습니다.</li>
          </InfoCard>
        </div>
      </GuideSection>

      <GuideSection id="guide-intercom" index="03" title="인터컴 사용법">
        <div className={styles.cardGrid}>
          <InfoCard title="Driver">
            <li>Driver Pack에서 팀을 만들고 <b>Group code</b>와 비밀번호를 공유합니다.</li>
            <li><b>MIC HANDS-FREE</b>는 담당 엔지니어와 수석에게 계속 송신합니다.</li>
            <li>그룹 생성자에게만 보이는 <b>Chief code</b>는 수석 엔지니어에게 별도로 전달합니다.</li>
          </InfoCard>
          <InfoCard title="Engineer">
            <li><b>Engineer Bus</b>는 엔지니어·수석 공용 송신 채널입니다. 드라이버는 듣지 않습니다.</li>
            <li><b>HOLD TO TALK / Space</b>를 누르는 동안 담당 드라이버에게 추가로 송신합니다.</li>
            <li>Bus 버튼은 내 송신을 제어합니다. 다른 엔지니어의 수신 음소거 버튼이 아닙니다.</li>
          </InfoCard>
          <InfoCard title="Chief engineer">
            <li>Bus를 통해 모든 엔지니어와 대화할 수 있습니다.</li>
            <li><b>START PRIVATE</b>로 선택한 드라이버와 1:1 통화를 시작합니다.</li>
            <li>1:1 통화 중 수석 Bus는 차단되고 해당 담당 엔지니어는 서버에서 잠시 강제 음소거됩니다.</li>
          </InfoCard>
          <InfoCard title="수신과 안전">
            <li><b>Volume</b>은 해당 참가자를 내가 듣는 음량만 바꿉니다.</li>
            <li>참가자 이름 아래 화살표는 현재 그 음성이 전달되는 상대를 보여줍니다.</li>
            <li><b>MIC MUTED</b>는 내 모든 송신만 막고 수신은 유지합니다.</li>
            <li><b>ENABLE AUDIO</b>는 브라우저 자동 재생을 허용하며 서버의 강제 음소거를 해제하지 않습니다.</li>
            <li>각 `?` 버튼에 포커스를 두거나 누르면 기능별 설명을 볼 수 있습니다.</li>
          </InfoCard>
        </div>
      </GuideSection>

      <GuideSection id="guide-data" index="04" title="화면별 데이터 사전">
        <TermTable caption="RACE / PITWALL" terms={RACE_TERMS} />
        <TermTable caption="QUALIFYING" terms={QUALI_TERMS} />
        <TermTable caption="WORLD FEED" terms={WORLD_TERMS} />
      </GuideSection>

      <GuideSection id="guide-sources" index="05" title="추정값과 결측값 읽기">
        <TermTable caption="DATA SOURCE LABELS" terms={SOURCE_TERMS} />
        <div className={styles.note}>
          F1 26의 Strategy Guide에는 F1 25 자료를 쓴다는 baseline 경고가 표시됩니다. 이 트랙 baseline은 Pit Exit의 pit-loss에도 사용될 수 있으므로, live 또는 set 출처가 아닌 값은 현재 게임의 확정 수치가 아닌 기준 추정치로 해석하세요.
        </div>
      </GuideSection>
    </section>
  );
}

function GuideSection({ id, index, title, children }: { id: string; index: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className={styles.section}>
      <div className={styles.sectionTitle}><span>{index}</span><h2>{title}</h2></div>
      {children}
    </section>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return <div className={styles.step}><span>{n}</span><div><h3>{title}</h3><p>{children}</p></div></div>;
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return <article className={styles.card}><h3>{title}</h3><ul>{children}</ul></article>;
}

function TermTable({ caption, terms }: { caption: string; terms: Term[] }) {
  return (
    <div className={styles.tableBlock}>
      <div className={styles.tableCaption}>{caption}</div>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={`${caption} 데이터 용어 표`}>
        <table>
          <thead><tr><th>표시 이름</th><th>뜻</th><th>읽는 방법</th></tr></thead>
          <tbody>{terms.map((term) => <tr key={term.name}><th scope="row">{term.name}</th><td>{term.meaning}</td><td>{term.reading}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
