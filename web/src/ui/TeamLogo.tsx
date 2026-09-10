import { getTeamColor, getTeamKey, type TeamKey } from '../constants/teamColors';
import { LOGO_OVERRIDES } from './TeamLogo.derive';
import styles from './TeamLogo.module.css';

/**
 * 팀 마크. 16px에서 읽히도록 굵은 실루엣 한 겹으로만 그린다.
 *
 * 디테일이 많은 로고(페라리 도약마, 레드불 황소, 애스턴 윙, 캐딜락 크레스트)는 손으로
 * 충실히 재현할 수 없어 인식 가능한 추상화에 그친다. 실물이 필요하면 위 드롭인 경로에
 * 로고 파일을 넣으면 된다.
 */
const MARKS: Record<TeamKey, React.ReactNode> = {
  // 원 안의 삼각별
  mercedes: (
    <>
      <circle className={styles.stroked} cx="12" cy="12" r="8.2" />
      <path className={styles.stroked} d="M12 12V3.8M12 12L4.9 16.1M12 12l7.1 4.1" />
    </>
  ),
  // 방패 (Cadillac의 사분 십자와 구분된다)
  ferrari: (
    <path className={styles.stroked} d="M12 3.6l6.6 2.5v5.6c0 4.4-2.8 7-6.6 8.4-3.8-1.4-6.6-4-6.6-8.4V6.1z" />
  ),
  // 마주보고 돌진하는 두 형상. 원(태양)+삼각 2개로 그렸을 때 16px에서 서로 떨어진
  // 점 무더기로 보여(실측 확인) 중앙에서 맞물린 단일 실루엣으로 합쳤다.
  redbull: <path d="M2 4.5L12 12 22 4.5v15L12 12 2 19.5z" />,
  // 스타일라이즈드 W
  williams: <path className={styles.stroked} d="M3 5.5l3.6 13L12 9l5.4 9.5L21 5.5" />,
  // 펼친 날개 (이중 셰브론)
  aston: (
    <>
      <path className={styles.stroked} d="M2.5 4.5L12 11.5l9.5-7" />
      <path className={styles.stroked} d="M4 13l8 5.5 8-5.5" />
    </>
  ),
  // 산형 A
  alpine: (
    <>
      <path className={styles.stroked} d="M4 18.5L12 5.5l8 13" />
      <path className={styles.stroked} d="M8.6 14h6.8" />
    </>
  ),
  // 굵은 대각 2줄. 16px에서 letterform 'RB'는 뭉개지고, 팀은 옆 약어 배지가 이미 알려준다.
  rb: <path className={styles.stroked} d="M5.5 19L13 5M11 19l7.5-14" />,
  // H + 사선 크로스바
  haas: <path className={styles.stroked} d="M6 5v14M18 5v14M6 13.2l12-2.4" />,
  // 스피드마크
  mclaren: <path d="M22 4c-8.4-.4-15.8 3.9-20.5 15.4 6.4-5.2 13.2-7.9 20-7.9z" />,
  // K 셰브론 (Kick Sauber)
  sauber: <path className={styles.stroked} d="M7 5v14M17.5 5L8.5 12l9 7" />,
  // 링 2개. 실물은 4링이지만 16px에서 링 하나가 4.5px밖에 안 돼 구멍이 메워지고
  // 붉은 알약 한 덩어리로 뭉갠다(실측 확인). 2링만 남겨야 '겹친 원'으로 읽힌다.
  // r은 5.9가 상한 — 링 2개가 가로로 놓여 viewBox 24를 먼저 채운다(세로가 아니라 가로가 제약).
  audi: (
    <>
      <circle className={styles.stroked} cx="7.4" cy="12" r="5.9" />
      <circle className={styles.stroked} cx="16.6" cy="12" r="5.9" />
    </>
  ),
  // 크레스트 (사분 방패)
  cadillac: (
    <>
      <path className={styles.stroked} d="M12 3.6l6.6 2.5v5.6c0 4.4-2.8 7-6.6 8.4-3.8-1.4-6.6-4-6.6-8.4V6.1z" />
      <path className={styles.stroked} d="M12 4.4v15M6.2 11.3h11.6" />
    </>
  ),
};

export interface TeamLogoProps {
  /** 게임이 보낸 원본 team ID. F1 25/26(0-11)과 2026 팩(476-486)을 모두 받는다. */
  teamId: number;
}

/**
 * 드라이버 이름 왼쪽에 붙는 팀 로고.
 *
 * 팀을 읽어주는 역할은 옆의 팀 약어 배지가 이미 하므로 스크린리더에는 노출하지 않는다.
 * 미매핑 ID·무팀(255)도 같은 16px를 차지해 이름의 좌측 정렬이 행마다 흔들리지 않는다.
 */
export function TeamLogo({ teamId }: TeamLogoProps) {
  const override = LOGO_OVERRIDES[String(teamId)];
  if (override !== undefined) {
    return <img className={`${styles.box} ${styles.image}`} src={override} alt="" aria-hidden="true" />;
  }

  const key = getTeamKey(teamId);
  return (
    <svg
      className={`${styles.box} ${styles.mark}`}
      viewBox="0 0 24 24"
      style={{ color: getTeamColor(teamId) }}
      aria-hidden="true"
    >
      {key ? MARKS[key] : <circle cx="12" cy="12" r="4.5" />}
    </svg>
  );
}
