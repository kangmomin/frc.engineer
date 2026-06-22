package strategydata

// gameFormat2026은 F1 26(2026 Season Pack)의 packetFormat 값이다.
const gameFormat2026 = 2026

const (
	compoundC6 = "C6"
	compoundC5 = "C5"
)

// ApplyGameFormat은 게임 포맷에 맞게 보정된 트랙 가이드를 반환한다.
//
// F1 26(2026 Season Pack)은 Pirelli가 C6 컴파운드를 폐지(C1–C5만 사용)했지만,
// 전략 데이터셋은 F1 25 기준이라 일부 트랙(canada/azerbaijan/imola/monaco)이
// 여전히 C6를 참조한다. 게임에 존재하지 않는 컴파운드를 추천하지 않도록 C6→C5로
// 강등한다. store가 소유한 원본 트랙은 절대 변경하지 않는다 — 실제로 C6를 가진
// 트랙만 얕은 복사 후 Compounds 맵을 새로 만들고, 나머지는 원본을 그대로 반환한다.
func ApplyGameFormat(track *NormalizedTrackFile, gameFormat int) *NormalizedTrackFile {
	if track == nil || gameFormat != gameFormat2026 {
		return track
	}
	return downgradeC6ToC5(track)
}

func downgradeC6ToC5(track *NormalizedTrackFile) *NormalizedTrackFile {
	hasC6 := false
	for _, compound := range track.TyreStrategy.Compounds {
		if compound == compoundC6 {
			hasC6 = true
			break
		}
	}
	if !hasC6 {
		return track
	}

	// 얕은 복사 후 Compounds 맵만 재생성한다. wear_per_lap/tyre_life_50pct는 슬롯명
	// (soft/medium/hard) 키라 C6를 담지 않으므로 강등 대상이 아니다.
	adjusted := *track
	compounds := make(map[string]string, len(track.TyreStrategy.Compounds))
	for slot, compound := range track.TyreStrategy.Compounds {
		if compound == compoundC6 {
			compound = compoundC5
		}
		compounds[slot] = compound
	}
	adjusted.TyreStrategy.Compounds = compounds
	return &adjusted
}
