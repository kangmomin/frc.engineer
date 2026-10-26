const test = require('node:test');
const assert = require('node:assert/strict');
const { createStartupErrorParser, describeStartupError, parseStartupErrorLine } = require('./sender-startup-error.cjs');

const line = (payload) => `FRC_SENDER_STARTUP_ERROR ${JSON.stringify(payload)}`;

test('parser reassembles a marker split across chunks and ignores other output', () => {
  const errors = [];
  const feed = createStartupErrorParser((error) => errors.push(error));
  const marker = line({ code: 'udp_port_unavailable', port: 20777, reason: 'in_use', fatal: true });
  feed(Buffer.from('normal log line\r\n' + marker.slice(0, 20)));
  assert.equal(errors.length, 0);
  feed(Buffer.from(marker.slice(20) + '\r\n'));
  assert.deepEqual(errors, [{ code: 'udp_port_unavailable', port: 20777, reason: 'in_use', fatal: true }]);
});

test('malformed markers are ignored', () => {
  assert.equal(parseStartupErrorLine('FRC_SENDER_STARTUP_ERROR {not json'), null);
  assert.equal(parseStartupErrorLine(line({ code: 'udp_port_unavailable' })), null);
  assert.equal(parseStartupErrorLine('plain stderr'), null);
});

test('describes UDP and settings port failures', () => {
  const udp = describeStartupError({ code: 'udp_port_unavailable', port: 20777, reason: 'in_use', detail: 'bind failed' });
  assert.match(udp.message, /UDP 포트 20777이\(가\) 이미 다른 프로그램에서 사용 중/);
  assert.match(udp.detail, /Sender가 종료되었습니다/);
  assert.match(udp.detail, /상세: bind failed/);

  const settings = describeStartupError({ code: 'settings_port_unavailable', port: 8099, reason: 'access_denied' });
  assert.match(settings.message, /포트 8099에 접근할 수 없습니다/);
  assert.match(settings.detail, /Windows 예약 포트 범위/);

  assert.equal(describeStartupError({ code: 'something_else', port: 1 }), null);
});
