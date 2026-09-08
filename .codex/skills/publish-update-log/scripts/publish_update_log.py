#!/usr/bin/env python3
"""Publish an immutable frc.engineer update log without exposing its API key."""

import argparse
import base64
from datetime import datetime
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request


MAX_PAYLOAD_BYTES = 128 * 1024
# Unicode White_Space, matching Go strings.TrimSpace (str.strip also accepts
# U+001C..U+001F, which the server intentionally rejects as control characters).
GO_SPACE = "\t\n\v\f\r \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"


class PublishError(Exception):
    """A message safe to display without credentials or arbitrary server output."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise PublishError("JSON 필드가 중복되었습니다.")
        value[key] = item
    return value


def normalize_payload(payload):
    if not isinstance(payload, dict) or set(payload) != {"releaseKey", "title", "body"}:
        raise PublishError("JSON에는 releaseKey, title, body만 필요합니다.")
    if not all(isinstance(value, str) for value in payload.values()):
        raise PublishError("releaseKey, title, body는 문자열이어야 합니다.")
    key = payload["releaseKey"]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}", key):
        raise PublishError("releaseKey는 영문·숫자로 시작하는 1~128자의 영문·숫자·._:/- 값이어야 합니다.")
    result = {"releaseKey": key}
    for field, maximum, allowed in [("title", 120, "\t"), ("body", 10000, "\t\r\n")]:
        value = payload[field].strip(GO_SPACE)
        if not 1 <= len(value) <= maximum:
            raise PublishError(f"{field}은 공백을 제외하고 1~{maximum}자여야 합니다.")
        if any((ord(char) < 32 or 127 <= ord(char) <= 159) and char not in allowed for char in value):
            raise PublishError(f"{field}에 허용되지 않는 제어 문자가 있습니다.")
        if any(0xD800 <= ord(char) <= 0xDFFF for char in value):
            raise PublishError(f"{field}에 잘못된 Unicode 문자가 있습니다.")
        result[field] = value
    return result


def read_payload(filename):
    try:
        if filename == "-":
            raw = sys.stdin.buffer.read(MAX_PAYLOAD_BYTES + 1)
        else:
            with Path(filename).expanduser().open("rb") as stream:
                raw = stream.read(MAX_PAYLOAD_BYTES + 1)
        if len(raw) > MAX_PAYLOAD_BYTES:
            raise PublishError("요청 파일은 128 KiB 이내여야 합니다.")
        return normalize_payload(json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object))
    except (OSError, UnicodeError, ValueError):
        raise PublishError("UTF-8 JSON 요청 파일을 읽지 못했습니다.") from None


def generate_key(filename):
    key = secrets.token_urlsafe(32)
    path = Path(filename).expanduser()
    try:
        # O_EXCL rejects existing files and symlinks instead of overwriting keys.
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="ascii") as stream:
            stream.write(key + "\n")
    except OSError:
        raise PublishError("키 파일을 생성하지 못했습니다. 새 파일 경로와 디렉터리 권한을 확인하세요.") from None
    print("PLATFORM_UPDATE_LOG_API_KEY_SHA256=" + hashlib.sha256(key.encode("ascii")).hexdigest())
    print("원본 키는 지정한 파일에만 저장했습니다.", file=sys.stderr)


def read_key(filename=None):
    try:
        if filename:
            with Path(filename).expanduser().open("r", encoding="ascii") as stream:
                key = stream.read(128).rstrip("\r\n")
        else:
            key = os.environ.get("PLATFORM_UPDATE_LOG_API_KEY", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", key):
            raise PublishError("유효한 API 키 파일 또는 PLATFORM_UPDATE_LOG_API_KEY가 필요합니다.")
        decoded = base64.urlsafe_b64decode(key + "=")
        if len(decoded) != 32 or base64.urlsafe_b64encode(decoded).decode("ascii").rstrip("=") != key:
            raise PublishError("API 키는 32바이트 난수의 정규 base64url 형식이어야 합니다.")
        return key
    except (OSError, UnicodeError, ValueError):
        raise PublishError("API 키를 읽지 못했습니다.") from None


def endpoint(base_url, allow_local_http=False):
    try:
        if not base_url or any(char.isspace() for char in base_url):
            raise ValueError()
        parts = urllib.parse.urlsplit(base_url)
        if not parts.hostname or parts.username is not None or parts.password is not None or parts.query or parts.fragment:
            raise ValueError()
        if parts.port is not None and not 1 <= parts.port <= 65535:
            raise ValueError()
        local_http = parts.scheme == "http" and allow_local_http and ipaddress.ip_address(parts.hostname).is_loopback
        if parts.scheme != "https" and not local_http:
            raise ValueError()
        return base_url.rstrip("/") + "/automation/update-logs"
    except ValueError:
        raise PublishError("HTTPS 플랫폼 기본 URL이 필요합니다. 로컬 테스트만 --allow-local-http와 숫자 loopback 주소를 사용하세요.") from None


def publish(payload, url, key):
    request = urllib.request.Request(url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), headers={
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json; charset=utf-8",
        "Accept": "application/json",
    }, method="POST")
    # Do not forward this key through environment proxies or any redirect.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=15) as response:
            if response.status not in (200, 201):
                raise PublishError("예상하지 못한 응답입니다. 같은 요청 파일을 보존하세요.")
            raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise PublishError("응답 크기가 너무 큽니다. 같은 요청 파일을 보존하세요.")
            result = json.loads(raw)
            entry = result["entry"]
            if not isinstance(entry["id"], str) or not re.fullmatch(r"[1-9][0-9]{0,18}", entry["id"]):
                raise ValueError()
            if type(result["replayed"]) is not bool or not isinstance(entry["publishedAt"], str):
                raise ValueError()
            if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+Z?", entry["publishedAt"]) or len(entry["publishedAt"]) > 40:
                raise ValueError()
            if datetime.fromisoformat(entry["publishedAt"].replace("Z", "+00:00")).tzinfo is None:
                raise ValueError()
            # Return only the small expected receipt, never the raw response.
            return {"id": entry["id"], "publishedAt": entry["publishedAt"], "replayed": result["replayed"]}
    except urllib.error.HTTPError as error:
        if error.code == 401:
            message = "키 인증에 실패했습니다. 키 설정을 확인하고 반복 시도하지 마세요."
        elif error.code == 409:
            message = "같은 releaseKey가 다른 내용으로 등록되어 있습니다. 기존 게시물과 요청 파일을 확인하세요."
        elif error.code == 429:
            retry = error.headers.get("Retry-After", "")
            suffix = f" {retry}초 후 재시도할 수 있습니다." if re.fullmatch(r"[0-9]{1,6}", retry) else ""
            message = "요청 제한에 도달했습니다." + suffix
        elif 300 <= error.code < 400:
            message = "리다이렉트를 거부했습니다. 플랫폼의 최종 HTTPS 주소를 사용하세요."
        elif error.code == 404:
            message = "자동화 API가 비활성화되어 있거나 서버 주소·버전이 맞지 않습니다."
        elif error.code == 400:
            message = "서버가 요청을 거부했습니다. 요청 형식과 프록시 설정을 확인하세요."
        else:
            message = f"서버 요청이 실패했습니다 (HTTP {error.code}). 같은 요청 파일을 보존하세요."
        error.close()
        raise PublishError(message) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise PublishError("네트워크 요청에 실패했습니다. 게시 성공 여부가 불명확하므로 재시도할 때 동일한 요청 파일과 releaseKey를 사용하세요.") from None
    except (ValueError, KeyError, TypeError, UnicodeError):
        raise PublishError("서버 응답 형식이 잘못되었습니다. 게시 성공 여부가 불명확하므로 같은 요청 파일을 보존하세요.") from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    generate = commands.add_parser("generate-key", help="새 키 파일을 만들고 서버용 SHA-256만 출력")
    generate.add_argument("--out", required=True, help="기존에 존재하지 않는 키 파일 경로")
    send = commands.add_parser("publish", help="업데이트 로그 등록 (자동 재시도 없음)")
    send.add_argument("--payload", required=True, help="UTF-8 JSON 파일, 또는 표준 입력 '-' ")
    send.add_argument("--base-url", default=os.environ.get("PLATFORM_URL", ""))
    send.add_argument("--key-file", help="키 파일 경로. 생략하면 PLATFORM_UPDATE_LOG_API_KEY 사용")
    send.add_argument("--dry-run", action="store_true", help="키·네트워크 없이 입력 검증 및 정규화 결과 출력")
    send.add_argument("--allow-local-http", action="store_true", help="숫자 loopback 주소의 HTTP 로컬 테스트 허용")
    args = parser.parse_args(argv)
    try:
        if args.command == "generate-key":
            generate_key(args.out)
        else:
            payload = read_payload(args.payload)
            if args.dry_run:
                print(json.dumps(payload, ensure_ascii=False, indent=2))
            else:
                result = publish(payload, endpoint(args.base_url, args.allow_local_http), read_key(args.key_file))
                print(json.dumps(result, ensure_ascii=False))
        return 0
    except PublishError as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
