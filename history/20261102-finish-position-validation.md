# 레이스 최종 순위 — SEND 스냅샷 유지, 도중 이탈 시 finishPosition 미전송, Final Classification 도입 보류

- **날짜**: 2026-11-02
- **이슈**: "경기 종료를 1등 도착 시점으로 잡아서 그 뒤에 들어온 차들의 순위가 1등 도착 시점 기준으로만 계산된다"는
  문제 제기. 순위는 게임 LapData `CarPosition`을 그대로 쓰고, sender는 SEND(세션 종료) 시점 스냅샷으로 확정한다
  (`internal/races/types.go` BuildSummary, `cmd/sender/uploader.go` summaryFinishPosition). Final Classification
  패킷(packetId 8)은 파싱하지 않는다. 확인할 것은 세 가지였다.
  (1) SEND 스냅샷이 공식 결과와 맞는가 (2) CHQF/RCWN이 언제 오는가 (3) Final Classification을 도입해야 하는가.
- **검증 데이터**: 로컬 풀 패킷 캡처 287개 디렉토리(131 GB). Race 분석 단위 27개(F1 25: 25, F1 26: 2),
  이 중 Final Classification(FC)을 받은 단위는 11개(전부 F1 25). 정답 기준은 FC `m_position`.
  보고서와 도구는 요청자 로컬 `build/_fc-analysis/analysis-out/REPORT.md`(gitignore 대상)에 있다.
  - SEND 직전 마지막 LapData의 순위 vs FC: 플레이어 **11/11 일치**, 전체 차량 불일치 **0/129**.
    게임은 SEND 직전 1초 안의 마지막 LapData 한 프레임에서 남은 차를 한꺼번에 확정한다(최대 14/20대 2→3).
    사후 시간 페널티도 그 프레임에 이미 반영돼 있었다(페널티 차량 36대 중 순위 차이 0).
  - **RCWN = 우승자 도착**(우승자 RS→3과 같은 sessionTime, 8/8). **CHQF = 플레이어 도착 3.465~5.374초 전**(9/9).
    우승자보다 최대 62초 늦게 오기도 한다. 기존 주석("CHQF/RCWN fire when the LEADER finishes")은 절반만 맞았다.
  - CHQF 직후 스냅샷은 플레이어 3/8, 차량 24/115가 틀렸다. RCWN 직후 스냅샷은 플레이어 3/7이 틀렸다.
    레거시(`cmd/server`, 처음 온 CHQF/RCWN/SEND로 확정) 재현 일치율은 8/11.
  - **플레이어가 도중에 나가도 게임은 SEND를 보낸다**: 12개 단위, 이때 플레이어 RS=2(active), FC는 0/12.
    sender는 이 중 5개 단위에서 이탈 순간의 실시간 순위를 `finishPosition`으로 올렸을 것이다(예: 2랩째 이탈인데 P8).
    웹에는 "종료 시 순위"로 표시된다.
  - FC: SEND 뒤 20.3~57.4초(벽시계)에 도착, 1~3회 재전송, 재전송본 페이로드 동일 9/9. 완주했는데 FC가 오지
    않은 경우 1/12. F1 25 FC 9/50은 헤더 UID=0이라 별도 디렉토리에 저장됐다.
- **결정**:
  1. **SEND 스냅샷 확정 방식 유지.** 완주 레이스에서 공식 결과와 11/11로 일치했다.
  2. **플레이어 결과가 확정되지 않은 SEND에는 `finishPosition`을 보내지 않는다.** 요약 `Player.ResultStatus`
     (LapData `m_resultStatus`)를 새로 저장하고, 3~7(finished/DNF/DSQ/NC/retired)일 때만 업로드한다.
     0(알 수 없음/필드 도입 전 요약), 1(inactive), 2(active = 도중 이탈)이면 뺀다.
  3. **CHQF/RCWN 주석을 실측에 맞게 정정한다.** 로직은 바꾸지 않는다(sender는 이미 둘 다 체크포인트로 처리).
  4. **Final Classification 파서 도입은 보류한다.**
- **결정자**: 사용자 (분석 결과 검토 후 1~4 일괄 진행 지시)
- **근거**:
  - 완주 정확도를 개선한다는 근거가 데이터에 없다(0/129). FC는 SEND보다 20~57초 늦게 오는데, 업로드 내용은
    seal 이후 바꿀 수 없다(`history/20260822-sender-capture-reliability-sealed-id.md`). 그래서 FC로 보정하려면
    업로드를 지연시키는 프로토콜 변경이 필요하고, 그 비용에 비해 얻는 것이 없다.
  - 도중 이탈의 실시간 순위는 결과가 아니다. 공식 결과(FC)도 존재하지 않는다. 그래서 값을 지우는 쪽이 정확하다.
    게이트는 sender에 둔다. 서버는 플레이어 RS를 받지 않기 때문이다.
  - 상태 게이트는 이미 확정된 리타이어·DNF 순위를 막지 않는다. 플레이어 RS 4/7 단위 3개는 FC와 일치했다.
- **기각된 대안**:
  - FC를 1차 정답으로 즉시 도입: 개선 근거 없음, F1 26 Race FC 표본 0, 업로드 지연·재설계 비용.
  - SEND + N초 대기 후 스냅샷: SEND 뒤에는 LapData가 거의 오지 않아 N=0~60초 모두 결과가 같다(11/11).
  - 서버 측 게이트: 서버는 플레이어 RS를 모른다. 필드를 업로드 계약에 추가하는 것은 이번 범위에 비해 과하다.
  - 구 요약(필드 없음, RS=0)은 기존 동작 유지: 구 요약에서는 도중 이탈과 완주를 구분할 수 없다. 이 함수의
    원칙("must not be inferred")에 따라 보수적으로 뺀다.
- **수용된 한계 / 후속 과제**:
  - 이미 seal됐지만 업로드가 확인되지 않은 구 요약을 재시도하면, 이전 시도와 달리 `finishPosition`이 빠진다.
    "동일 바이트 재전송" 불변식이 이 optional 필드에서만 깨진다. 서버는 insert-once라서, 이전 시도가 도달했으면
    Duplicate가 되고 도달하지 않았으면 순위 없는 행이 된다. 둘 다 잘못된 순위를 새로 만들지는 않는다.
  - **SEND 직전 LapData 1개만 잃어도** 플레이어 일치가 9/11, 차량 불일치가 13/129가 된다(모사). 실제 UDP 유실률은
    측정하지 않았다. 문제가 관측되면 FC를 검증·보정 수단으로 도입하는 방안을 별도로 설계한다.
  - **중간 디브리프**: sender는 CHQF/RCWN 체크포인트에서도 `BroadcastRaceResult`를 보낸다. 웹 디브리프는 SEND에서
    덮어쓰기 전까지 잠정 순위(플레이어 3/7~3/8 틀림)를 보여준다. 이번에는 수정하지 않았다.
  - 레거시 `cmd/server` 경로는 여전히 CHQF/RCWN으로 확정한다(8/11). 배포 산출물이 아니라서 유지한다.
  - **F1 26 Race FC 표본 0.** F1 26 완주 캡처가 생기면 1번 결정(SEND 스냅샷 정확도)을 다시 확인한다.
- **수정 내역** (브랜치 `claude/gracious-brahmagupta-jh1wvg`):
  - `internal/races/types.go`: `PlayerSummary.ResultStatus` 추가, BuildSummary가 LapData RS를 기록
  - `cmd/sender/uploader.go`: `summaryFinishPosition`에 `resultStatusSettled` 게이트 추가
  - `internal/telemetry/processor.go`: CHQF/RCWN 의미 주석 정정(로직 변경 없음)
  - `internal/platformsvc/ingest.go`: `FinishPosition` 필드 주석 갱신
  - `web/src/types/telemetry.ts`: `RacePlayerSummary.resultStatus?` 추가
  - 테스트: `cmd/sender/upload_state_test.go`(RS 0~8 게이트 표), `internal/races/types_test.go`(RS 전달)
- **재발 시 대응**: "1등 도착 시점 기준으로 순위가 굳는다", "SEND 스냅샷은 후행 차량을 반영 못 한다",
  "Final Classification을 써야 하지 않나", "CHQF는 리더 도착 아닌가" 류의 재론은 본 문서 인용으로 종결.
  단, F1 26 완주 데이터나 실제 마지막 프레임 유실 사례로 새 근거가 나오면 이 문서에 섹션을 추가해 재검토한다.
