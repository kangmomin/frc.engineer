package engineer

import (
	"fmt"
	"math"
	"strings"
)

// phrases builds spoken text in the configured language. Numbers are formatted
// for speech: no minus signs ("0.4 laps short") and one decimal for seconds.
type phrases struct{ ko bool }

func newPhrases(lang string) phrases { return phrases{ko: lang != "en"} }

func (p phrases) pick(ko, en string) string {
	if p.ko {
		return ko
	}
	return en
}

func sec(ms int) string { return fmt.Sprintf("%.1f", float64(ms)/1000) }

func laps(v float32) string { return fmt.Sprintf("%.1f", math.Abs(float64(v))) }

func (p phrases) compound(c string) string {
	ko := map[string]string{"soft": "소프트", "medium": "미디엄", "hard": "하드", "inter": "인터미디엇", "wet": "웻"}
	en := map[string]string{"soft": "softs", "medium": "mediums", "hard": "hards", "inter": "inters", "wet": "wets"}
	if p.ko {
		return ko[c]
	}
	return en[c]
}

func (p phrases) corner(i int) string {
	ko := []string{"앞 왼쪽", "앞 오른쪽", "뒤 왼쪽", "뒤 오른쪽"}
	en := []string{"front left", "front right", "rear left", "rear right"}
	if i < 0 || i > 3 {
		return ""
	}
	return p.pick(ko[i], en[i])
}

func (p phrases) weather(w string) string {
	ko := map[string]string{"clear": "맑음", "light_cloud": "약간 흐림", "overcast": "흐림", "light_rain": "약한 비", "heavy_rain": "강한 비", "storm": "폭우"}
	en := map[string]string{"clear": "clear", "light_cloud": "light cloud", "overcast": "overcast", "light_rain": "light rain", "heavy_rain": "heavy rain", "storm": "storm"}
	if p.ko {
		return ko[w]
	}
	return en[w]
}

func (p phrases) pitWindowSoon(ideal int) string {
	return p.pick(fmt.Sprintf("다음 랩부터 피트 윈도우. 게임 기준 이상 랩 %d.", ideal),
		fmt.Sprintf("Pit window opens next lap. Game ideal lap %d.", ideal))
}

func (p phrases) pitWindowOpen(ideal, latest, rejoin int) string {
	s := p.pick(fmt.Sprintf("피트 윈도우 열림, 랩 %d부터 %d까지.", ideal, latest),
		fmt.Sprintf("Pit window open, laps %d to %d.", ideal, latest))
	return s + p.rejoin(rejoin)
}

func (p phrases) pitWindowLast(rejoin int) string {
	return p.pick("피트 윈도우 마지막 랩입니다.", "Last lap of the pit window.") + p.rejoin(rejoin)
}

func (p phrases) rejoin(pos int) string {
	if pos <= 0 {
		return ""
	}
	return p.pick(fmt.Sprintf(" 지금 박스하면 P%d 복귀, 게임 예측.", pos),
		fmt.Sprintf(" Boxing now rejoins P%d, game projection.", pos))
}

func (p phrases) fuelShort(margin float32) string {
	return p.pick(fmt.Sprintf("연료 %s랩 부족. 리프트 앤 코스트 필요.", laps(margin)),
		fmt.Sprintf("Fuel %s laps short. Lift and coast.", laps(margin)))
}

func (p phrases) fuelCritical(margin float32) string {
	return p.pick(fmt.Sprintf("연료 %s랩 부족, 심각합니다. 연료 세이브 모드.", laps(margin)),
		fmt.Sprintf("Fuel %s laps short, critical. Save fuel now.", laps(margin)))
}

func (p phrases) fuelRecovered(margin float32) string {
	return p.pick(fmt.Sprintf("연료 다시 여유, 플러스 %s랩.", laps(margin)),
		fmt.Sprintf("Fuel back to plus %s laps.", laps(margin)))
}

func (p phrases) tyreWear(wear, corner int, critical bool) string {
	if critical {
		return p.pick(fmt.Sprintf("타이어 마모 %d퍼센트, %s. 그립 저하 주의.", wear, p.corner(corner)),
			fmt.Sprintf("Tyre wear %d percent, %s. Expect grip to drop.", wear, p.corner(corner)))
	}
	return p.pick(fmt.Sprintf("타이어 마모 %d퍼센트, %s 가장 큼.", wear, p.corner(corner)),
		fmt.Sprintf("Tyre wear %d percent, %s worst.", wear, p.corner(corner)))
}

func (p phrases) damagePart(part string) string {
	ko := map[string]string{"frontLeftWing": "앞날개 왼쪽", "frontRightWing": "앞날개 오른쪽", "rearWing": "뒷날개", "floor": "플로어", "diffuser": "디퓨저", "sidepod": "사이드포드", "engine": "엔진", "gearbox": "기어박스"}
	en := map[string]string{"frontLeftWing": "front left wing", "frontRightWing": "front right wing", "rearWing": "rear wing", "floor": "floor", "diffuser": "diffuser", "sidepod": "sidepod", "engine": "engine", "gearbox": "gearbox"}
	if p.ko {
		return ko[part]
	}
	return en[part]
}

func (p phrases) damage(part string, pct int) string {
	return p.pick(fmt.Sprintf("%s 손상 %d퍼센트.", p.damagePart(part), pct),
		fmt.Sprintf("%s damage %d percent.", capitalize(p.damagePart(part)), pct))
}

func (p phrases) fault(kind string) string {
	if kind == "drs" {
		return p.pick("DRS 고장.", "DRS fault.")
	}
	return p.pick("ERS 고장.", "ERS fault.")
}

func (p phrases) safetyCar(virtual, inWindow bool) string {
	s := p.pick("세이프티카 출동. 델타 지키세요.", "Safety car deployed. Keep the delta.")
	if virtual {
		s = p.pick("버추얼 세이프티카. 델타 지키세요.", "Virtual safety car. Keep the delta.")
	}
	if inWindow {
		s += p.pick(" 게임 기준 피트 윈도우 안입니다.", " You are inside the game's pit window.")
	}
	return s
}

func (p phrases) safetyCarIn() string {
	return p.pick("세이프티카 이번 랩 들어옵니다. 리스타트 준비.", "Safety car in this lap. Prepare for the restart.")
}

func (p phrases) green() string {
	return p.pick("그린 플래그, 레이스 재개.", "Green flag, racing resumes.")
}

func (p phrases) redFlag() string {
	return p.pick("레드 플래그. 세션 중단.", "Red flag. Session suspended.")
}

func (p phrases) drsEnabled() string {
	return p.pick("DRS 사용 가능.", "DRS enabled.")
}

func (p phrases) rivalPitted(ahead bool, name, compound string) string {
	var s string
	if ahead {
		s = p.pick(fmt.Sprintf("앞차 %s 피트인.", name), fmt.Sprintf("Car ahead, %s, has pitted.", name))
	} else {
		s = p.pick(fmt.Sprintf("뒤차 %s 피트인. 언더컷 주의.", name), fmt.Sprintf("Car behind, %s, has pitted. Watch the undercut.", name))
	}
	if c := p.compound(compound); c != "" {
		s += p.pick(fmt.Sprintf(" %s 장착.", c), fmt.Sprintf(" On %s.", c))
	}
	return s
}

func (p phrases) rivalRetired(ahead bool, name string) string {
	if ahead {
		return p.pick(fmt.Sprintf("앞차 %s 리타이어.", name), fmt.Sprintf("Car ahead, %s, has retired.", name))
	}
	return p.pick(fmt.Sprintf("뒤차 %s 리타이어.", name), fmt.Sprintf("Car behind, %s, has retired.", name))
}

func (p phrases) gapBehindClose(name string, ms int) string {
	return p.pick(fmt.Sprintf("뒤차 %s %s초 뒤. 방어하세요.", name, sec(ms)),
		fmt.Sprintf("%s is %s behind. Defend.", name, sec(ms)))
}

func (p phrases) gapAheadClose(name string, ms int) string {
	return p.pick(fmt.Sprintf("앞차 %s %s초 앞. 공격 거리.", name, sec(ms)),
		fmt.Sprintf("%s is %s ahead. Within attack range.", name, sec(ms)))
}

func (p phrases) penalty(added, total int) string {
	return p.pick(fmt.Sprintf("%d초 페널티. 누적 %d초.", added, total),
		fmt.Sprintf("%d second penalty. Total %d seconds.", added, total))
}

func (p phrases) warning(total int, cornerCut bool) string {
	if cornerCut {
		return p.pick(fmt.Sprintf("트랙 리밋 경고, 누적 경고 %d회.", total),
			fmt.Sprintf("Track limits warning, %d warnings total.", total))
	}
	return p.pick(fmt.Sprintf("경고 누적 %d회.", total), fmt.Sprintf("Warning, %d total.", total))
}

func (p phrases) unserved(stopGo bool) string {
	if stopGo {
		return p.pick("스톱 앤 고 페널티 이행 필요.", "Stop-go penalty to serve.")
	}
	return p.pick("드라이브스루 페널티 이행 필요.", "Drive-through penalty to serve.")
}

func (p phrases) rainSoon(minutes, pct int) string {
	return p.pick(fmt.Sprintf("게임 예보, %d분 뒤 강수 확률 %d퍼센트.", minutes, pct),
		fmt.Sprintf("Game forecast, %d percent rain in %d minutes.", pct, minutes))
}

func (p phrases) weatherNow(w string) string {
	return p.pick(fmt.Sprintf("날씨 변화, 현재 %s.", p.weather(w)), fmt.Sprintf("Weather change, now %s.", p.weather(w)))
}

func (p phrases) finalLap() string { return p.pick("파이널 랩.", "Final lap.") }

func (p phrases) undercut(viable bool) string {
	if viable {
		return p.pick("앞차 상대 언더컷 신호, 휴리스틱 기준.", "Undercut signal on the car ahead, heuristic.")
	}
	return p.pick("오버컷 신호, 휴리스틱 기준.", "Overcut signal, heuristic.")
}

func (p phrases) noData() string { return p.pick("아직 데이터가 없습니다.", "No data yet.") }

func (p phrases) stale() string {
	return p.pick("최근 텔레메트리가 없습니다.", "No recent telemetry.")
}

func (p phrases) dontKnow() string {
	return p.pick("질문을 이해하지 못했습니다. 갭, 연료, 타이어, 피트, 날씨, 손상, 페널티를 물어보세요.",
		"I did not catch that. Ask about gaps, fuel, tyres, pit, weather, damage or penalties.")
}

func (p phrases) testCall() string {
	return p.pick("라디오 체크. 엔지니어 연결됐습니다.", "Radio check. Engineer online.")
}

func (p phrases) join(parts []string) string {
	out := make([]string, 0, len(parts))
	for _, s := range parts {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return strings.Join(out, " ")
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
