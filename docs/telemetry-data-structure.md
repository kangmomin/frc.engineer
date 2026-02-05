# F1 25 Telemetry Data Structure

F1 25 게임에서 UDP를 통해 수신되는 텔레메트리 패킷 구조를 정리한 문서입니다.

## 데이터 흐름

```
F1 25 게임 (UDP:20778) → Parser → Telemetry Processor → WebSocket → 프론트엔드
```

WebSocket 메시지 타입:
| 타입 | 주기 | 설명 |
|------|------|------|
| `telemetry` | 최대 60Hz | 실시간 차량 텔레메트리 |
| `pitwallState` | 4Hz | 종합 레이스 상태 |
| `raceControl` | 이벤트 발생 시 | 레이스 이벤트 알림 |
| `lapData` | 요청 시 | 랩 텔레메트리 차트 데이터 |

---

## 패킷 공통 헤더 (29 bytes)

모든 패킷에 공통으로 포함되는 헤더입니다.

| 필드 | 타입 | 설명 |
|------|------|------|
| PacketFormat | uint16 | 2025 |
| GameYear | uint8 | 25 |
| GameMajorVersion | uint8 | 게임 메이저 버전 |
| GameMinorVersion | uint8 | 게임 마이너 버전 |
| PacketVersion | uint8 | 패킷 버전 |
| PacketID | uint8 | 패킷 타입 (0-14) |
| SessionUID | uint64 | 세션 고유 ID |
| SessionTime | float32 | 세션 경과 시간 |
| FrameIdentifier | uint32 | 프레임 식별자 |
| OverallFrameIdentifier | uint32 | 전체 프레임 식별자 |
| PlayerCarIndex | uint8 | 플레이어 차량 인덱스 (0-21) |
| SecondaryPlayerCarIndex | uint8 | 두 번째 플레이어 (255=없음) |

---

## 패킷 타입 목록

| ID | 패킷 | 크기 | 구현 여부 |
|----|------|------|-----------|
| 0 | Motion | ~1,349B | ✅ |
| 1 | Session | ~680B | ✅ |
| 2 | LapData | ~1,285B | ✅ |
| 3 | Event | 가변 | ✅ |
| 4 | Participants | ~1,352B | ✅ |
| 5 | CarSetups | - | ❌ |
| 6 | CarTelemetry | ~1,352B | ✅ |
| 7 | CarStatus | ~1,239B | ✅ |
| 8 | FinalClassification | - | ❌ |
| 9 | LobbyInfo | - | ❌ |
| 10 | CarDamage | ~909B | ✅ |
| 11 | SessionHistory | - | ❌ |
| 12 | TyreSets | - | ❌ |
| 13 | MotionEx | - | ❌ |
| 14 | TimeTrial | - | ❌ |

최대 차량 수: **22대**

---

## Packet 0: Motion Data

차량별 60 bytes × 22대 = 1,320 bytes

| 필드 | 타입 | 단위 | 설명 |
|------|------|------|------|
| WorldPositionX | float32 | m | 월드 X 좌표 |
| WorldPositionY | float32 | m | 월드 Y 좌표 |
| WorldPositionZ | float32 | m | 월드 Z 좌표 |
| WorldVelocityX | float32 | m/s | X 속도 |
| WorldVelocityY | float32 | m/s | Y 속도 |
| WorldVelocityZ | float32 | m/s | Z 속도 |
| WorldForwardDirX/Y/Z | int16 | ×32767 | 전방 단위 벡터 |
| WorldRightDirX/Y/Z | int16 | ×32767 | 우측 단위 벡터 |
| GForceLateral | float32 | G | 횡방향 G-force |
| GForceLongitudinal | float32 | G | 종방향 G-force |
| GForceVertical | float32 | G | 수직 G-force |
| Yaw | float32 | rad | 요 각도 |
| Pitch | float32 | rad | 피치 각도 |
| Roll | float32 | rad | 롤 각도 |

---

## Packet 1: Session Data

| 필드 | 타입 | 설명 |
|------|------|------|
| Weather | uint8 | 0=맑음, 1=약한 구름, 2=흐림, 3=약한 비, 4=폭우, 5=폭풍 |
| TrackTemperature | int8 | 트랙 온도 (°C) |
| AirTemperature | int8 | 기온 (°C) |
| TotalLaps | uint8 | 전체 랩 수 |
| TrackLength | uint16 | 트랙 길이 (m) |
| SessionType | uint8 | 0=unknown, 1=P1, 2=P2, 3=P3, 4=Short P, 5=Q1, 6=Q2, 7=Q3, 8=Short Q, 9=OSQ, 10=R, 11=R2, 12=R3, 13=Time Trial |
| TrackID | int8 | -1=unknown, 0-29=트랙 ID |
| NumMarshalZones | uint8 | 마샬 존 수 |
| SafetyCarStatus | uint8 | 0=없음, 1=풀 SC, 2=VSC, 3=포메이션 랩 |

**MarshalZone** (5 bytes × 21):

| 필드 | 타입 | 설명 |
|------|------|------|
| ZoneStart | float32 | 랩 진행률 (0.0-1.0) |
| ZoneFlag | int8 | -1=invalid, 0=없음, 1=녹색, 2=청색, 3=황색, 4=적색 |

**WeatherForecastSample** (8 bytes × 최대 56개):

| 필드 | 타입 | 설명 |
|------|------|------|
| SessionType | uint8 | 세션 타입 |
| TimeOffset | uint8 | 현재로부터 몇 분 뒤 |
| Weather | uint8 | 날씨 (0=맑음~5=폭풍) |
| TrackTemperature | int8 | 트랙 온도 (°C) |
| TrackTemperatureChange | int8 | 트랙 온도 변화 (-1=하강, 0=유지, 1=상승) |
| AirTemperature | int8 | 기온 (°C) |
| AirTemperatureChange | int8 | 기온 변화 (-1=하강, 0=유지, 1=상승) |
| RainPercentage | uint8 | 비 올 확률 (0-100%) |

---

## Packet 2: Lap Data

차량별 57 bytes × 22대 = 1,254 bytes

| 필드 | 타입 | 단위 | 설명 |
|------|------|------|------|
| LastLapTimeInMS | uint32 | ms | 지난 랩 타임 |
| CurrentLapTimeInMS | uint32 | ms | 현재 랩 타임 |
| Sector1TimeInMS | uint16 | ms | 섹터1 시간 |
| Sector1TimeMinutes | uint8 | min | 섹터1 분 단위 |
| Sector2TimeInMS | uint16 | ms | 섹터2 시간 |
| Sector2TimeMinutes | uint8 | min | 섹터2 분 단위 |
| DeltaToCarInFrontMSPart | uint16 | ms | 전방 차량 델타 |
| DeltaToCarInFrontMinutesPart | uint8 | min | 전방 차량 델타 분 |
| DeltaToRaceLeaderMSPart | uint16 | ms | 리더 델타 |
| DeltaToRaceLeaderMinutesPart | uint8 | min | 리더 델타 분 |
| LapDistance | float32 | m | 현재 랩 주행 거리 |
| TotalDistance | float32 | m | 세션 총 주행 거리 |
| SafetyCarDelta | float32 | s | SC 델타 |
| CarPosition | uint8 | - | 현재 순위 (1-22) |
| CurrentLapNum | uint8 | - | 현재 랩 번호 |
| PitStatus | uint8 | - | 0=없음, 1=피팅 중, 2=피트 영역 |
| NumPitStops | uint8 | - | 피트 스톱 횟수 |
| Sector | uint8 | - | 0=S1, 1=S2, 2=S3 |
| CurrentLapInvalid | uint8 | - | 0=유효, 1=무효 |
| Penalties | uint8 | s | 누적 타임 페널티 |
| TotalWarnings | uint8 | - | 경고 수 |
| CornerCuttingWarnings | uint8 | - | 코너 커팅 경고 수 |
| NumUnservedDriveThroughs | uint8 | - | 미수행 DT 수 |
| NumUnservedStopGoPenalties | uint8 | - | 미수행 S/G 수 |
| GridPosition | uint8 | - | 그리드 위치 |
| DriverStatus | uint8 | - | 드라이버 상태 |
| ResultStatus | uint8 | - | 결과 상태 |
| PitLaneTimerActive | uint8 | - | 피트레인 타이머 활성 |
| PitLaneTimeInLaneInMS | uint16 | ms | 피트레인 체류 시간 |
| PitStopTimerInMS | uint16 | ms | 피트 스톱 시간 |
| PitStopShouldServePen | uint8 | - | 페널티 수행 여부 |

---

## Packet 3: Event Data

4글자 이벤트 코드와 타입별 상세 데이터로 구성됩니다.

| 코드 | 이벤트 | 상세 데이터 |
|------|--------|-------------|
| SSTA | 세션 시작 | 없음 |
| SEND | 세션 종료 | 없음 |
| FTLP | 최속 랩 | vehicleIdx(uint8), lapTime(float32) |
| RTMT | 리타이어 | vehicleIdx(uint8) |
| DRSE | DRS 활성화 | 없음 |
| DRSD | DRS 비활성화 | 없음 |
| TMPT | 팀메이트 피트인 | vehicleIdx(uint8) |
| CHQF | 체커기 | 없음 |
| RCWN | 레이스 우승 | vehicleIdx(uint8) |
| PENA | 페널티 | penaltyType, infringementType, vehicleIdx, otherVehicleIdx, time, lapNum, placesGained |
| SPTP | 스피드 트랩 | vehicleIdx, speed(float32), isOverallFastest, isDriverFastest, fastestVehicleIdx, fastestSpeed |
| STLG | 출발 신호등 | numLights(uint8) |
| LGOT | 신호등 소등 | 없음 |
| DTSV | DT 수행 | vehicleIdx(uint8) |
| SGSV | S/G 수행 | vehicleIdx(uint8) |
| FLBK | 플래시백 | 없음 |
| BUTN | 버튼 상태 | 없음 |
| OVTK | 추월 | overtakingVehicleIdx, beingOvertakenVehicleIdx |
| SCAR | SC 상태 | safetyCarType, eventType |
| COLL | 충돌 | vehicle1Idx, vehicle2Idx |

---

## Packet 4: Participants Data

차량별 60 bytes × 22대

| 필드 | 타입 | 설명 |
|------|------|------|
| AIControlled | uint8 | 0=인간, 1=AI |
| DriverID | uint8 | 드라이버 ID (255=플레이어) |
| NetworkID | uint8 | 네트워크 게임 고유 ID |
| TeamID | uint8 | 팀 ID (0=Mercedes, 1=Ferrari, 2=Red Bull 등) |
| MyTeam | uint8 | 마이팀 모드 여부 |
| RaceNumber | uint8 | 레이스 번호 |
| Nationality | uint8 | 국적 코드 |
| Name | [48]byte | UTF-8 이름 |
| YourTelemetry | uint8 | 0=제한, 1=공개 |
| ShowOnlineNames | uint8 | 온라인 이름 표시 |
| TechLevel | uint16 | F1 World 기술 레벨 |
| Platform | uint8 | 게임 플랫폼 |

---

## Packet 6: Car Telemetry Data

차량별 60 bytes × 22대 = 1,320 bytes

| 필드 | 타입 | 단위 | 설명 |
|------|------|------|------|
| Speed | uint16 | km/h | 속도 |
| Throttle | float32 | 0-1 | 스로틀 |
| Steer | float32 | -1~+1 | 스티어링 (좌/우) |
| Brake | float32 | 0-1 | 브레이크 |
| Clutch | uint8 | 0-100 | 클러치 |
| Gear | int8 | - | -1=R, 0=N, 1-8 |
| EngineRPM | uint16 | rpm | 엔진 회전수 |
| DRS | uint8 | - | 0=off, 1=on |
| RevLightsPercent | uint8 | % | 레브 라이트 |
| RevLightsBitValue | uint16 | bit | 레브 라이트 비트 |
| BrakesTemperature | [4]uint16 | °C | 브레이크 온도 [RL,RR,FL,FR] |
| TyresSurfaceTemperature | [4]uint8 | °C | 타이어 표면 온도 [RL,RR,FL,FR] |
| TyresInnerTemperature | [4]uint8 | °C | 타이어 내부 온도 [RL,RR,FL,FR] |
| EngineTemperature | uint16 | °C | 엔진 온도 |
| TyresPressure | [4]float32 | PSI | 타이어 공기압 [RL,RR,FL,FR] |
| SurfaceType | [4]uint8 | - | 노면 타입 [RL,RR,FL,FR] |

패킷 푸터 (3 bytes):

| 필드 | 타입 | 설명 |
|------|------|------|
| MFDPanelIndex | uint8 | 열린 MFD 패널 |
| MFDPanelIndexSecondaryPlayer | uint8 | 두 번째 플레이어 MFD |
| SuggestedGear | int8 | 추천 기어 (-1=없음) |

---

## Packet 7: Car Status Data

차량별 55 bytes × 22대 = 1,210 bytes

| 필드 | 타입 | 단위 | 설명 |
|------|------|------|------|
| TractionControl | uint8 | - | 0=off, 1=medium, 2=full |
| AntiLockBrakes | uint8 | - | 0=off, 1=on |
| FuelMix | uint8 | - | 0=lean, 1=standard, 2=rich, 3=max |
| FrontBrakeBias | uint8 | % | 전방 브레이크 바이어스 |
| PitLimiterStatus | uint8 | - | 0=off, 1=on |
| FuelInTank | float32 | kg | 현재 연료량 |
| FuelCapacity | float32 | kg | 연료 탱크 용량 |
| FuelRemainingLaps | float32 | laps | 남은 연료 랩 수 |
| MaxRPM | uint16 | rpm/10 | 최대 RPM (÷10) |
| IdleRPM | uint16 | rpm/10 | 아이들 RPM (÷10) |
| MaxGears | uint8 | - | 최대 기어 수 |
| DRSAllowed | uint8 | - | 0=불가, 1=허용 |
| DRSActivationDistance | uint16 | m | DRS 활성화 거리 |
| ActualTyreCompound | uint8 | - | 실제 컴파운드 (16=C5, 17=C4, 18=C3, 19=C2, 20=C1, 21=C0, 7=inter, 8=wet) |
| VisualTyreCompound | uint8 | - | 시각 컴파운드 (16=soft, 17=medium, 18=hard, 7=inter, 8=wet) |
| TyresAgeLaps | uint8 | laps | 타이어 사용 랩 수 |
| VehicleFIAFlags | int8 | - | -1=invalid, 0=없음, 1=녹색, 2=청색, 3=황색 |
| EnginePowerICE | float32 | W | ICE 출력 |
| EnginePowerMGUK | float32 | W | MGU-K 출력 |
| ERSStoreEnergy | float32 | J | ERS 저장 에너지 |
| ERSDeployMode | uint8 | - | 0=none, 1=medium, 2=hotlap, 3=overtake |
| ERSHarvestedThisLapMGUK | float32 | J | MGU-K 회수 에너지 |
| ERSHarvestedThisLapMGUH | float32 | J | MGU-H 회수 에너지 |
| ERSDeployedThisLap | float32 | J | 이번 랩 ERS 배출량 |
| NetworkPaused | uint8 | - | 네트워크 일시정지 |

---

## Packet 10: Car Damage Data

차량별 40 bytes × 22대 = 880 bytes

| 필드 | 타입 | 단위 | 설명 |
|------|------|------|------|
| TyresWear | [4]float32 | 0-1 | 타이어 마모 [RL,RR,FL,FR] |
| TyresDamage | [4]uint8 | % | 타이어 손상 |
| BrakesDamage | [4]uint8 | % | 브레이크 손상 |
| FrontLeftWingDamage | uint8 | % | 좌측 전방 윙 손상 |
| FrontRightWingDamage | uint8 | % | 우측 전방 윙 손상 |
| RearWingDamage | uint8 | % | 후방 윙 손상 |
| FloorDamage | uint8 | % | 플로어 손상 |
| DiffuserDamage | uint8 | % | 디퓨저 손상 |
| SidepodDamage | uint8 | % | 사이드포드 손상 |
| DRSFault | uint8 | - | 0=정상, 1=고장 |
| ERSFault | uint8 | - | 0=정상, 1=고장 |
| GearBoxDamage | uint8 | % | 기어박스 손상 |
| EngineDamage | uint8 | % | 엔진 손상 |
| EngineMGUHWear | uint8 | % | MGU-H 마모 |
| EngineESWear | uint8 | % | ES 마모 |
| EngineCEWear | uint8 | % | CE 마모 |
| EngineICEWear | uint8 | % | ICE 마모 |
| EngineMGUKWear | uint8 | % | MGU-K 마모 |
| EngineTCWear | uint8 | % | TC 마모 |

---

## 프론트엔드 WebSocket 데이터 구조

### TelemetryData (실시간 텔레메트리)

```typescript
interface TelemetryData {
    speed: number;              // km/h
    gear: number;               // -1=R, 0=N, 1-8
    rpm: number;
    throttle: number;           // 0.0-1.0
    brake: number;              // 0.0-1.0
    deltaPersonalBest: number;  // ms
    deltaCarInFront: number;    // ms
    deltaRaceLeader: number;    // ms
    currentLap: number;
    currentLapTime: number;     // ms
    lastLapTime: number;        // ms
    bestLapTime: number;        // ms
    position: number;
    drs: boolean;
    revLights: number;          // 0-100
    sector: number;             // 0-2
    lapInvalid: boolean;
    timestamp: number;          // Unix ms
}
```

### PitwallState (종합 레이스 상태)

```typescript
interface PitwallState {
    session: SessionInfo;
    drivers: DriverInfo[];
    positions: CarPosition[];
    playerIndex: number;
    trackMap?: TrackMapData;
}
```

### LapTelemetry (랩 차트 데이터)

```typescript
interface TelemetryPoint {
    lapDistance: number;    // m (X축)
    lapTime: number;       // ms
    speed: number;         // km/h
    throttle: number;      // 0.0-1.0
    brake: number;         // 0.0-1.0
    gear: number;          // -1~8
}

interface LapTelemetry {
    trackId: number;
    lapTimeMs: number;
    sector1Ms: number;
    sector2Ms: number;
    sector3Ms: number;
    dataPoints: TelemetryPoint[];
}
```

---

## 트랙 데이터 형식

`data/tracks/` 디렉토리에 CSV 형식으로 저장됩니다.

```
dist,pos_z,pos_x,pos_y,drs,sector
116.36,58.1072,670.8939,-17.6770,0,0
```

| 필드 | 설명 |
|------|------|
| dist | 트랙 거리 (m) |
| pos_z, pos_x, pos_y | 월드 좌표 |
| drs | DRS 존 여부 (0/1) |
| sector | 트랙 섹터 (0/1/2) |
