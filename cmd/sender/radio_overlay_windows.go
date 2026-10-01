//go:build windows

package main

import (
	"fmt"
	"log/slog"
	"math"
	"runtime"
	"sync/atomic"
	"syscall"
	"unsafe"

	"frc.engineer/internal/engineer"
)

const (
	dtWordBreak   = 0x10
	dtEndEllipsis = 0x8000
	radioBaseW    = 380
	radioBaseH    = 168
)

// radioSource is the part of the engineer the overlay reads.
type radioSource interface {
	Active() []engineer.Call
	Settings() engineer.Settings
}

// radioOverlay shows the latest engineer radio calls as text. Same window
// behaviour as the other overlays: drag to move, wheel to scale, Ctrl+wheel
// for opacity, right click to close.
type radioOverlay struct {
	src        radioSource
	hwnd       uintptr
	wndProcPtr uintptr
	scale      float64
	dpiScale   float64
	x          int
	y          int
	drag       bool
	lastPt     w32Point
	alpha      uint8
	saveState  func(overlayWindowState)
	running    atomic.Bool
}

func newRadioOverlay(src radioSource, saved overlayWindowState, saveState func(overlayWindowState)) *radioOverlay {
	ov := &radioOverlay{src: src, scale: saved.Scale, dpiScale: 1.0, x: saved.X, y: saved.Y, alpha: saved.Alpha, saveState: saveState}
	ov.wndProcPtr = syscall.NewCallback(ov.wndProc)
	return ov
}

func (o *radioOverlay) persistLayout() {
	if o.saveState != nil {
		o.saveState(overlayWindowState{X: o.x, Y: o.y, Alpha: o.alpha, Scale: o.scale})
	}
}

func (o *radioOverlay) px(v float64) int32 { return int32(math.Round(v * o.scale * o.dpiScale)) }
func (o *radioOverlay) winW() int {
	return int(math.Round(float64(radioBaseW) * o.scale * o.dpiScale))
}
func (o *radioOverlay) winH() int {
	return int(math.Round(float64(radioBaseH) * o.scale * o.dpiScale))
}

func (o *radioOverlay) IsRunning() bool { return o.running.Load() }

func (o *radioOverlay) Start() {
	if !o.running.Load() {
		go o.run()
	}
}

func (o *radioOverlay) Stop() {
	if o.running.Load() {
		uPostMessage.Call(o.hwnd, wmClose, 0, 0)
	}
}

func (o *radioOverlay) Toggle() bool {
	if o.running.Load() {
		o.Stop()
		return false
	}
	o.Start()
	return true
}

func (o *radioOverlay) run() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	o.running.Store(true)
	defer o.running.Store(false)
	defer func() {
		if r := recover(); r != nil {
			slog.Error("radio overlay panic", "error", r)
		}
	}()

	if ret, _, _ := setDpiAwareness.Call(2); ret != 0 {
		u32.NewProc("SetProcessDPIAware").Call()
	}
	hInst, _, _ := kGetModuleHandle.Call(0)
	if hInst == 0 {
		return
	}
	cls, _ := syscall.UTF16PtrFromString("FRCRadioOverlay")
	cursor, _, _ := uLoadCursor.Call(0, uintptr(32512))
	uUnregClass.Call(uintptr(unsafe.Pointer(cls)), hInst)
	wc := w32WndClassEx{
		Size: uint32(unsafe.Sizeof(w32WndClassEx{})), Style: csHRedraw | csVRedraw,
		WndProc: o.wndProcPtr, Instance: hInst, Cursor: cursor, ClassName: cls,
	}
	if atom, _, _ := uRegClassEx.Call(uintptr(unsafe.Pointer(&wc))); atom == 0 {
		return
	}
	hwnd, _, _ := uCreateWindowEx.Call(
		exTopmost|exToolWin|exLayered, uintptr(unsafe.Pointer(cls)), 0,
		wsPopup|wsVisible, uintptr(o.x), uintptr(o.y), 1, 1, 0, 0, hInst, 0,
	)
	runtime.KeepAlive(cls)
	if hwnd == 0 {
		return
	}
	o.hwnd = hwnd
	if dpi, _, _ := getDpiForWindow.Call(hwnd); dpi > 0 {
		o.dpiScale = float64(dpi) / 96.0
	}
	uSetWindowPos.Call(hwnd, 0, uintptr(o.x), uintptr(o.y), uintptr(o.winW()), uintptr(o.winH()), swpNoZOrd)
	uSetLayeredAttr.Call(hwnd, 0, uintptr(o.alpha), lwaAlpha)
	uSetTimer.Call(hwnd, 1, 250, 0)

	var msg w32Msg
	for {
		ret, _, _ := uGetMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if ret == 0 || int32(ret) == -1 {
			break
		}
		uTranslateMsg.Call(uintptr(unsafe.Pointer(&msg)))
		uDispatchMsg.Call(uintptr(unsafe.Pointer(&msg)))
	}
}

func (o *radioOverlay) wndProc(hwnd, msg, wp, lp uintptr) uintptr {
	switch msg {
	case wmPaint:
		o.paint(hwnd)
		return 0
	case wmTimer:
		uInvalidateRect.Call(hwnd, 0, 0)
		return 0
	case wmLBtnDown:
		o.drag = true
		uGetCursorPos.Call(uintptr(unsafe.Pointer(&o.lastPt)))
		uSetCapture.Call(hwnd)
		return 0
	case wmMMove:
		if o.drag {
			var pt w32Point
			uGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
			var rc w32Rect
			uGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&rc)))
			o.x = int(rc.Left + pt.X - o.lastPt.X)
			o.y = int(rc.Top + pt.Y - o.lastPt.Y)
			uSetWindowPos.Call(hwnd, 0, uintptr(o.x), uintptr(o.y), 0, 0, swpNoSize|swpNoZOrd)
			o.lastPt = pt
		}
		return 0
	case wmLBtnUp:
		o.drag = false
		uReleaseCapture.Call()
		o.persistLayout()
		return 0
	case wmMWheel:
		delta := int16(wp >> 16)
		if wp&0xFFFF&0x0008 != 0 {
			if delta > 0 && o.alpha < maxOverlayAlpha {
				o.alpha += 10
			} else if delta < 0 && o.alpha > minOverlayAlpha {
				o.alpha -= 10
			}
			uSetLayeredAttr.Call(o.hwnd, 0, uintptr(o.alpha), lwaAlpha)
		} else {
			if delta > 0 {
				o.scale = math.Min(o.scale+0.1, maxOverlayScale)
			} else {
				o.scale = math.Max(o.scale-0.1, minOverlayScale)
			}
			uSetWindowPos.Call(o.hwnd, 0, 0, 0, uintptr(o.winW()), uintptr(o.winH()), swpNoMove|swpNoZOrd)
		}
		o.persistLayout()
		return 0
	case wmRBtnUp, wmClose:
		o.persistLayout()
		uKillTimer.Call(hwnd, 1)
		uDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		uPostQuitMsg.Call(0)
		return 0
	}
	ret, _, _ := uDefWindowProc.Call(hwnd, msg, wp, lp)
	return ret
}

func radioPriorityColor(p engineer.Priority) uintptr {
	switch p {
	case engineer.PriorityUrgent:
		return rgb(255, 82, 92)
	case engineer.PriorityHigh:
		return rgb(255, 200, 0)
	case engineer.PriorityNormal:
		return rgb(0, 229, 255)
	default:
		return rgb(132, 147, 150)
	}
}

func (o *radioOverlay) paint(hwnd uintptr) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("radio paint panic", "error", r)
		}
	}()
	var ps w32PaintStruct
	hdc, _, _ := uBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	w, h := o.winW(), o.winH()
	mem, _, _ := gCreateDC.Call(hdc)
	bmp, _, _ := gCreateBmp.Call(hdc, uintptr(w), uintptr(h))
	oldBmp, _, _ := gSelectObj.Call(mem, bmp)

	bg, _, _ := gSolidBrush.Call(rgb(14, 14, 15))
	rc := w32Rect{0, 0, int32(w), int32(h)}
	gFillRect.Call(mem, uintptr(unsafe.Pointer(&rc)), bg)
	gDeleteObj.Call(bg)
	gSetBkMode.Call(mem, bkTransp)

	fTitle := o.mkFont(12, 700)
	fMain := o.mkFont(17, 600)
	fOld := o.mkFont(12, 500)
	defer gDeleteObj.Call(fTitle)
	defer gDeleteObj.Call(fMain)
	defer gDeleteObj.Call(fOld)

	pad := o.px(12)
	ww, hh := int32(w), int32(h)
	y := pad
	calls := o.src.Active()
	ko := o.src.Settings().Language != "en"

	gSelectObj.Call(mem, fTitle)
	gSetTextColor.Call(mem, rgb(0, 229, 255))
	title := "ENGINEER RADIO"
	if !o.src.Settings().Enabled {
		title += "  ·  OFF"
	}
	o.text(mem, title, pad, y, ww-pad, y+o.px(14), dtVCenter|dtSingle)
	y += o.px(20)

	if len(calls) == 0 {
		gSelectObj.Call(mem, fOld)
		gSetTextColor.Call(mem, rgb(90, 90, 90))
		idle := "Standing by"
		if ko {
			idle = "대기 중"
		}
		o.text(mem, idle, pad, y, ww-pad, y+o.px(18), dtVCenter|dtSingle)
	} else {
		// Newest call: large, wrapped over up to three lines.
		c := calls[0]
		bar, _, _ := gSolidBrush.Call(radioPriorityColor(c.Priority))
		barRc := w32Rect{pad, y + o.px(2), pad + o.px(4), y + o.px(66)}
		gFillRect.Call(mem, uintptr(unsafe.Pointer(&barRc)), bar)
		gDeleteObj.Call(bar)
		gSelectObj.Call(mem, fMain)
		gSetTextColor.Call(mem, rgb(229, 226, 227))
		o.text(mem, c.Text, pad+o.px(12), y, ww-pad, y+o.px(68), dtWordBreak)
		y += o.px(74)
		// Older calls: one dim line each.
		gSelectObj.Call(mem, fOld)
		for _, old := range calls[1:] {
			if y+o.px(16) > hh-pad/2 {
				break
			}
			gSetTextColor.Call(mem, rgb(110, 122, 124))
			o.text(mem, fmt.Sprintf("· %s", old.Text), pad+o.px(12), y, ww-pad, y+o.px(16), dtVCenter|dtSingle|dtEndEllipsis)
			y += o.px(18)
		}
	}

	gBitBlt.Call(hdc, 0, 0, uintptr(w), uintptr(h), mem, 0, 0, srcCopy)
	gSelectObj.Call(mem, oldBmp)
	gDeleteObj.Call(bmp)
	gDeleteDC.Call(mem)
	uEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
}

func (o *radioOverlay) text(mem uintptr, s string, l, t, r, b int32, flags uintptr) {
	txt := utf16Str(s)
	if len(txt) < 2 {
		return
	}
	rc := w32Rect{l, t, r, b}
	gDrawText.Call(mem, uintptr(unsafe.Pointer(&txt[0])), uintptr(len(txt)-1), uintptr(unsafe.Pointer(&rc)), flags)
}

// mkFont uses Malgun Gothic: Segoe UI has no Hangul glyphs.
func (o *radioOverlay) mkFont(logPx int, weight int) uintptr {
	h := -int(math.Round(float64(logPx) * o.scale * o.dpiScale))
	name := utf16Ptr("Malgun Gothic")
	font, _, _ := gCreateFont.Call(uintptr(h), 0, 0, 0, uintptr(weight), 0, 0, 0, 1, 0, 0, 6, 0,
		uintptr(unsafe.Pointer(name)))
	return font
}
