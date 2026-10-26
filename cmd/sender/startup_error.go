package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"syscall"
)

// startupErrorPrefix marks the single stderr line Driver Pack parses
// (apps/setup-manager/electron/sender-startup-error.cjs) to show an alert.
const startupErrorPrefix = "FRC_SENDER_STARTUP_ERROR "

const (
	startupErrorUDPPort      = "udp_port_unavailable"
	startupErrorSettingsPort = "settings_port_unavailable"

	bindReasonInUse        = "in_use"
	bindReasonAccessDenied = "access_denied"
	bindReasonUnknown      = "unknown"
)

type startupError struct {
	Code     string `json:"code"`
	Protocol string `json:"protocol"`
	Port     int    `json:"port"`
	Reason   string `json:"reason"`
	Detail   string `json:"detail"`
	// Fatal: the sender exits right after reporting (Driver Pack must restart it).
	Fatal bool `json:"fatal"`
}

func newPortStartupError(code, protocol string, port int, err error, fatal bool) startupError {
	return startupError{
		Code:     code,
		Protocol: protocol,
		Port:     port,
		Reason:   classifyBindError(err),
		Detail:   err.Error(),
		Fatal:    fatal,
	}
}

// classifyBindError separates "another process holds the port" from
// "the OS refuses the port" (Windows excluded port ranges / exclusive binds).
// Windows reports WSA codes, which syscall.EADDRINUSE/EACCES do not match.
func classifyBindError(err error) string {
	const (
		wsaEACCES     syscall.Errno = 10013
		wsaEADDRINUSE syscall.Errno = 10048
	)
	var errno syscall.Errno
	if !errors.As(err, &errno) {
		return bindReasonUnknown
	}
	switch errno {
	case syscall.EADDRINUSE, wsaEADDRINUSE:
		return bindReasonInUse
	case syscall.EACCES, wsaEACCES:
		return bindReasonAccessDenied
	default:
		return bindReasonUnknown
	}
}

func writeStartupError(w io.Writer, e startupError) {
	payload, err := json.Marshal(e)
	if err != nil {
		return
	}
	fmt.Fprintf(w, "%s%s\n", startupErrorPrefix, payload)
}

// alertMessage is the standalone (no Driver Pack) alert body.
func (e startupError) alertMessage() string {
	var cause string
	switch e.Reason {
	case bindReasonInUse:
		cause = fmt.Sprintf("%s 포트 %d이(가) 이미 다른 프로그램에서 사용 중입니다.", e.portLabel(), e.Port)
	case bindReasonAccessDenied:
		cause = fmt.Sprintf("%s 포트 %d에 접근할 수 없습니다.\nWindows 예약 포트 범위(Hyper-V/WSL/Docker)이거나 다른 프로그램이 독점 사용 중일 수 있습니다.", e.portLabel(), e.Port)
	default:
		cause = fmt.Sprintf("%s 포트 %d을(를) 열 수 없습니다.", e.portLabel(), e.Port)
	}

	var advice string
	if e.Code == startupErrorUDPPort {
		advice = "SimHub, Crew Chief 등 F1 텔레메트리를 받는 다른 프로그램이나 이미 실행 중인 다른 Sender를 종료한 뒤 Sender를 다시 실행해 주세요."
	} else {
		advice = "이 포트를 사용하는 프로그램이나 이미 실행 중인 다른 Sender를 종료한 뒤 Sender를 다시 실행해 주세요."
	}
	if e.Fatal {
		advice = "Sender를 종료합니다.\n" + advice
	}
	return fmt.Sprintf("%s\n\n%s\n\n(%s)", cause, advice, e.Detail)
}

func (e startupError) portLabel() string {
	if e.Code == startupErrorUDPPort {
		return "텔레메트리 UDP"
	}
	return "설정 페이지 TCP"
}

// announceStartupError tells Driver Pack over stderr when embedded; otherwise it
// shows a native alert so a standalone sender does not vanish silently.
func announceStartupError(embedded bool, e startupError) {
	if embedded {
		writeStartupError(os.Stderr, e)
		return
	}
	showStartupAlert("FRC Pitwall Sender", e.alertMessage())
}
