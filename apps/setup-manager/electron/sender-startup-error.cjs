// Sender reports port bind failures as one stderr line:
//   FRC_SENDER_STARTUP_ERROR {"code":"udp_port_unavailable","port":20777,...}
// (cmd/sender/startup_error.go). Without this the user only sees "Sender Offline"
// (or no telemetry) with no hint about the port conflict.
const STARTUP_ERROR_PREFIX = 'FRC_SENDER_STARTUP_ERROR ';
const MAX_PENDING_CHARS = 64 * 1024;

function parseStartupErrorLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith(STARTUP_ERROR_PREFIX)) return null;
  try {
    const payload = JSON.parse(trimmed.slice(STARTUP_ERROR_PREFIX.length));
    if (!payload || typeof payload.code !== 'string' || !Number.isInteger(payload.port)) return null;
    return payload;
  } catch {
    return null;
  }
}

// stderr chunks may split a line; buffer until newline.
function createStartupErrorParser(onError) {
  let pending = '';
  return (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop();
    if (pending.length > MAX_PENDING_CHARS) pending = '';
    for (const line of lines) {
      const error = parseStartupErrorLine(line);
      if (error) onError(error);
    }
  };
}

function describeStartupError(error) {
  const isUDP = error.code === 'udp_port_unavailable';
  if (!isUDP && error.code !== 'settings_port_unavailable') return null;

  const label = isUDP ? `텔레메트리 UDP 포트 ${error.port}` : `Sender 로컬 통신 포트 ${error.port}`;
  let message;
  if (error.reason === 'in_use') {
    message = `${label}이(가) 이미 다른 프로그램에서 사용 중입니다.`;
  } else if (error.reason === 'access_denied') {
    message = `${label}에 접근할 수 없습니다.`;
  } else {
    message = `${label}을(를) 열 수 없습니다.`;
  }

  const lines = [];
  if (isUDP) {
    lines.push('F1 게임 텔레메트리를 받을 수 없습니다. Sender는 계속 실행되며 페어링·설정은 사용할 수 있습니다.');
    lines.push('SimHub, Crew Chief 등 텔레메트리를 받는 다른 프로그램이나 이미 실행 중인 다른 FRC Pitwall Sender(트레이 아이콘)를 종료하면 자동으로 다시 연결됩니다.');
    lines.push('계속 함께 써야 한다면 "UDP 포트 변경"에서 다른 포트로 바꾸고, 게임의 텔레메트리 UDP 포트도 같은 값으로 맞춰 주세요.');
  } else {
    lines.push('Driver Pack이 Sender와 통신하지 못해 설정·페어링을 사용할 수 없습니다.');
    lines.push('이 포트를 사용하는 프로그램이나 이미 실행 중인 다른 FRC Pitwall Sender(트레이 아이콘)를 종료한 뒤 "다시 시도"를 눌러 주세요.');
  }
  if (error.reason === 'access_denied') {
    lines.push('Windows 예약 포트 범위(Hyper-V/WSL/Docker)에 포함되었거나 다른 프로그램이 독점 사용 중일 수 있습니다.');
  }
  if (typeof error.detail === 'string' && error.detail) {
    lines.push(`상세: ${error.detail}`);
  }

  return {
    title: isUDP ? 'UDP 포트 사용 불가' : 'Sender 시작 실패',
    message,
    detail: lines.join('\n\n'),
    // UDP: Sender 가 살아 있으므로 포트 변경 화면으로 안내 / TCP: 재시작으로 재바인드
    primaryAction: isUDP ? { label: 'UDP 포트 변경', kind: 'open-udp-settings' } : { label: '다시 시도', kind: 'restart' },
  };
}

function describeSenderCrash({ code, signal, attempts, logPath }) {
  const exit = signal ? `신호 ${signal}` : `종료 코드 ${code}`;
  return {
    title: 'Sender 반복 종료',
    message: 'Sender가 반복해서 비정상 종료되었습니다.',
    detail: [
      `자동 재시작을 ${attempts}번 시도했지만 Sender가 계속 종료되어 텔레메트리를 사용할 수 없습니다. (${exit})`,
      `원인은 Sender 로그에서 확인할 수 있습니다: ${logPath}`,
      '백신 프로그램이 frc-pitwall-sender.exe를 차단하지 않았는지, 저장 위치 폴더에 쓰기 권한이 있는지 확인한 뒤 "다시 시도"를 눌러 주세요.',
    ].join('\n\n'),
    primaryAction: { label: '다시 시도', kind: 'restart' },
  };
}

module.exports = {
  STARTUP_ERROR_PREFIX,
  createStartupErrorParser,
  describeSenderCrash,
  describeStartupError,
  parseStartupErrorLine,
};
