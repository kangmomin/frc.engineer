package strategydata

// gameFormat2026은 F1 26(2026 Season Pack)의 packetFormat 값이다.
const gameFormat2026 = 2026

const (
	compoundC6 = "C6"
	compoundC5 = "C5"
)

// strategyNotes2026은 F1 26 세션에 노출하는 규정 기반 정성 안내다.
// 검증(confirmed)된 사실만 담는다. 정량 마모율/타이어 수명/pit window는 게임
// 실측치가 없어(unverifiable) 임의 보정 없이 F1 25 baseline 그대로 두고,
// 프론트가 '25 estimate' 배지로 구분하도록 한다.
var strategyNotes2026 = []string{
	"2026 규정: DRS 폐지 → Active Aero + Overtake(Manual Override).",
	"타이어 컴파운드 C1–C5 (C6 폐지). F1 25 대비 마모가 빠르고 웜업이 어렵다.",
	"레이스 연료 상한 70kg (2026 규정; F1 25는 110kg).",
}

// ApplyGameFormat은 게임 포맷에 맞게 보정된 트랙 가이드를 반환한다.
//
// F1 25 세션(gameFormat != 2026)은 원본 포인터를 그대로 반환한다 — StrategyMeta는
// nil로 남아 직렬화에서 생략되므로 25 페이로드/표시는 완전히 불변이다.
//
// F1 26(2026 Season Pack) 세션은 store 원본을 절대 건드리지 않고 얕은 복사본에
// 애노테이션 메타를 채운다. C6를 참조하는 트랙(canada/azerbaijan/imola/monaco)은
// 게임에 없는 컴파운드를 추천하지 않도록 C6→C5로 강등하고 그 사실을 adjustments에
// 기록한다. C6가 없는 트랙도 26이면 source_game/규정 안내를 항상 붙여, 프론트가
// F1 25 스크랩 수치를 26 최적값으로 오인하지 않게 한다.
func ApplyGameFormat(track *NormalizedTrackFile, gameFormat int) *NormalizedTrackFile {
	if track == nil || gameFormat != gameFormat2026 {
		return track
	}

	adjusted := *track // 얕은 복사 — 원본 store는 불변으로 유지된다.
	adjustments := []string{"drs_abolished"}

	if compounds, downgraded := downgradeC6ToC5(track.TyreStrategy.Compounds); downgraded {
		adjusted.TyreStrategy.Compounds = compounds
		adjustments = append(adjustments, "c6_downgraded_to_c5")
	}

	adjusted.StrategyMeta = &NormalizedStrategyMeta{
		SourceGame:  "f1_25_scrape",
		GameFormat:  gameFormat2026,
		Adjustments: adjustments,
		Notes:       strategyNotes2026,
	}
	return &adjusted
}

// downgradeC6ToC5는 C6 슬롯을 C5로 바꾼 새 맵과 강등 발생 여부를 반환한다.
// C6가 없으면 원본 맵과 false를 반환해 불필요한 할당을 피한다. wear_per_lap/
// tyre_life_50pct는 슬롯명(soft/medium/hard) 키라 C6를 담지 않으므로 강등 대상이
// 아니다.
func downgradeC6ToC5(src map[string]string) (map[string]string, bool) {
	hasC6 := false
	for _, compound := range src {
		if compound == compoundC6 {
			hasC6 = true
			break
		}
	}
	if !hasC6 {
		return src, false
	}
	compounds := make(map[string]string, len(src))
	for slot, compound := range src {
		if compound == compoundC6 {
			compound = compoundC5
		}
		compounds[slot] = compound
	}
	return compounds, true
}
