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

	"frc.engineer/internal/dto"
	"frc.engineer/internal/telemetry"
)

type strategyOverlay struct {
	pm         *telemetry.PitwallManager
	getConfig  func(int8) trackStrategyConfig
	hwnd       uintptr
	wndProcPtr uintptr
	scale      float64
	dpiScale   float64
	drag       bool
	lastPt     w32Point
	alpha      uint8
	running    atomic.Bool
	classReg   atomic.Bool
}

func newStrategyOverlay(pm *telemetry.PitwallManager, getConfig func(int8) trackStrategyConfig) *strategyOverlay {
	ov := &strategyOverlay{pm: pm, getConfig: getConfig, scale: 1.0, dpiScale: 1.0, alpha: 230}
	ov.wndProcPtr = syscall.NewCallback(ov.wndProc)
	return ov
}

const (
	stratBaseW = 320
	stratBaseH = 270
)

func (o *strategyOverlay) px(v float64) int32 {
	return int32(math.Round(v * o.scale * o.dpiScale))
}
func (o *strategyOverlay) winW() int { return int(math.Round(float64(stratBaseW) * o.scale * o.dpiScale)) }
func (o *strategyOverlay) winH() int { return int(math.Round(float64(stratBaseH) * o.scale * o.dpiScale)) }

func (o *strategyOverlay) IsRunning() bool { return o.running.Load() }

func (o *strategyOverlay) Start() {
	if o.running.Load() {
		return
	}
	go o.run()
}

func (o *strategyOverlay) Stop() {
	if !o.running.Load() {
		return
	}
	uPostMessage.Call(o.hwnd, wmClose, 0, 0)
}

func (o *strategyOverlay) Toggle() bool {
	if o.running.Load() {
		o.Stop()
		return false
	}
	o.Start()
	return true
}

func (o *strategyOverlay) run() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	o.running.Store(true)
	defer o.running.Store(false)

	defer func() {
		if r := recover(); r != nil {
			slog.Error("strategy overlay panic", "error", r)
		}
	}()

	if ret, _, _ := setDpiAwareness.Call(2); ret != 0 {
		u32.NewProc("SetProcessDPIAware").Call()
	}

	hInst, _, _ := kGetModuleHandle.Call(0)
	if hInst == 0 {
		return
	}

	cls, _ := syscall.UTF16PtrFromString("FRCStrategyOverlay")
	cursor, _, _ := uLoadCursor.Call(0, uintptr(32512))
	uUnregClass.Call(uintptr(unsafe.Pointer(cls)), hInst)

	wc := w32WndClassEx{
		Size: uint32(unsafe.Sizeof(w32WndClassEx{})), Style: csHRedraw | csVRedraw,
		WndProc: o.wndProcPtr, Instance: hInst, Cursor: cursor, ClassName: cls,
	}
	if atom, _, _ := uRegClassEx.Call(uintptr(unsafe.Pointer(&wc))); atom == 0 {
		return
	}
	o.classReg.Store(true)

	hwnd, _, _ := uCreateWindowEx.Call(
		exTopmost|exToolWin|exLayered, uintptr(unsafe.Pointer(cls)), 0,
		wsPopup|wsVisible, 160, 160, 1, 1, 0, 0, hInst, 0,
	)
	runtime.KeepAlive(cls)
	if hwnd == 0 {
		return
	}
	o.hwnd = hwnd

	// Query DPI
	if dpi, _, _ := getDpiForWindow.Call(hwnd); dpi > 0 {
		o.dpiScale = float64(dpi) / 96.0
	}

	w, h := uintptr(o.winW()), uintptr(o.winH())
	uSetWindowPos.Call(hwnd, 0, 160, 160, w, h, swpNoZOrd)
	uSetLayeredAttr.Call(hwnd, 0, uintptr(o.alpha), lwaAlpha)
	uSetTimer.Call(hwnd, 1, 500, 0) // 2 fps

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

func (o *strategyOverlay) wndProc(hwnd, msg, wp, lp uintptr) uintptr {
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
			uSetWindowPos.Call(hwnd, 0,
				uintptr(rc.Left+pt.X-o.lastPt.X), uintptr(rc.Top+pt.Y-o.lastPt.Y),
				0, 0, swpNoSize|swpNoZOrd)
			o.lastPt = pt
		}
		return 0
	case wmLBtnUp:
		o.drag = false
		uReleaseCapture.Call()
		return 0
	case wmMWheel:
		delta := int16(wp >> 16)
		keys := wp & 0xFFFF
		if keys&0x0008 != 0 {
			if delta > 0 && o.alpha < 245 {
				o.alpha += 10
			} else if delta < 0 && o.alpha > 30 {
				o.alpha -= 10
			}
			uSetLayeredAttr.Call(o.hwnd, 0, uintptr(o.alpha), lwaAlpha)
		} else {
			step := 0.1
			if delta > 0 {
				o.scale = math.Min(o.scale+step, 2.5)
			} else {
				o.scale = math.Max(o.scale-step, 0.6)
			}
			uSetWindowPos.Call(o.hwnd, 0, 0, 0, uintptr(o.winW()), uintptr(o.winH()), swpNoMove|swpNoZOrd)
		}
		return 0
	case wmRBtnUp, wmClose:
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

func (o *strategyOverlay) paint(hwnd uintptr) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("strategy paint panic", "error", r)
		}
	}()

	var ps w32PaintStruct
	hdc, _, _ := uBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
	w, h := o.winW(), o.winH()

	mem, _, _ := gCreateDC.Call(hdc)
	bmp, _, _ := gCreateBmp.Call(hdc, uintptr(w), uintptr(h))
	oldBmp, _, _ := gSelectObj.Call(mem, bmp)

	// Background
	bg, _, _ := gSolidBrush.Call(rgb(14, 14, 15))
	rc := w32Rect{0, 0, int32(w), int32(h)}
	gFillRect.Call(mem, uintptr(unsafe.Pointer(&rc)), bg)
	gDeleteObj.Call(bg)

	// Border
	pen, _, _ := gCreatePen.Call(psSolid, 1, rgb(0, 60, 68))
	gSelectObj.Call(mem, pen)
	hollow, _, _ := gStockObj.Call(5)
	gSelectObj.Call(mem, hollow)
	gMoveToEx.Call(mem, 0, 0, 0)
	gLineTo.Call(mem, uintptr(w-1), 0)
	gLineTo.Call(mem, uintptr(w-1), uintptr(h-1))
	gLineTo.Call(mem, 0, uintptr(h-1))
	gLineTo.Call(mem, 0, 0)
	gDeleteObj.Call(pen)

	gSetBkMode.Call(mem, bkTransp)

	fTitle := o.mkFont(16, 700)
	fBody := o.mkFont(14, 600)
	fSmall := o.mkFont(11, 600)

	trackID := o.pm.CurrentTrackID()
	cfg := o.getConfig(trackID)
	data := o.pm.BuildStrategyOverlayData(cfg.PitTimeLossMs, cfg.UndercutDifficulty)

	pad := o.px(12)
	ww := int32(w)
	y := pad

	// Header
	gSetTextColor.Call(mem, rgb(0, 229, 255))
	gSelectObj.Call(mem, fTitle)

	if data == nil {
		o.drawStr(mem, "STRATEGY", pad, y, ww-pad, y+o.px(18))
		y += o.px(26)
		gSetTextColor.Call(mem, rgb(80, 80, 80))
		gSelectObj.Call(mem, fBody)
		o.drawStr(mem, "Waiting for race...", pad, y+o.px(20), ww-pad, y+o.px(38))
		goto cleanup
	}

	{
		hdr := fmt.Sprintf("STRATEGY   P%d   %d/%dL", data.PlayerPosition, data.PlayerLap, data.TotalLaps)
		o.drawStr(mem, hdr, pad, y, ww-pad, y+o.px(18))
		y += o.px(24)

		// Separator
		o.drawSep(mem, pad, ww-pad, y)
		y += o.px(6)

		// Pit rejoin
		gSelectObj.Call(mem, fBody)
		pitCol := rgb(255, 179, 178)
		if data.PitRejoinPosition <= data.PlayerPosition {
			pitCol = rgb(205, 255, 19) // lime — would gain position
		}
		gSetTextColor.Call(mem, pitCol)
		pitStr := fmt.Sprintf("PIT \u2192 P%d", data.PitRejoinPosition)
		o.drawStr(mem, pitStr, pad, y, ww/2, y+o.px(16))

		gSetTextColor.Call(mem, rgb(132, 147, 150))
		gSelectObj.Call(mem, fSmall)
		lossStr := fmt.Sprintf("(%0.1fs loss)", float64(cfg.PitTimeLossMs)/1000.0)
		o.drawStr(mem, lossStr, ww/2, y, ww-pad, y+o.px(16))
		y += o.px(22)

		// Car ahead
		o.drawSep(mem, pad, ww-pad, y)
		y += o.px(6)
		y = o.paintCar(mem, data.CarAhead, "\u25B2 AHEAD", y, ww, pad, data)

		// Car behind
		o.drawSep(mem, pad, ww-pad, y)
		y += o.px(6)
		y = o.paintCar(mem, data.CarBehind, "\u25BC BEHIND", y, ww, pad, data)

		// Undercut / Overcut
		o.drawSep(mem, pad, ww-pad, y)
		y += o.px(6)
		gSelectObj.Call(mem, fBody)
		gSetTextColor.Call(mem, rgb(132, 147, 150))
		o.drawStr(mem, "UNDERCUT", pad, y, pad+o.px(80), y+o.px(16))
		gSetTextColor.Call(mem, stratVerdictColor(data.UndercutVerdict))
		o.drawStr(mem, data.UndercutVerdict, pad+o.px(82), y, ww/2, y+o.px(16))

		gSetTextColor.Call(mem, rgb(132, 147, 150))
		o.drawStr(mem, "OVERCUT", ww/2, y, ww/2+o.px(72), y+o.px(16))
		gSetTextColor.Call(mem, stratVerdictColor(data.OvercutVerdict))
		o.drawStr(mem, data.OvercutVerdict, ww/2+o.px(74), y, ww-pad, y+o.px(16))
		y += o.px(22)

		// Train
		if data.TrainSize >= 2 {
			o.drawSep(mem, pad, ww-pad, y)
			y += o.px(6)
			gSelectObj.Call(mem, fBody)
			trainCol := rgb(132, 147, 150)
			if data.InTrain {
				trainCol = rgb(255, 82, 92) // red
			}
			gSetTextColor.Call(mem, trainCol)
			trainLabel := fmt.Sprintf("TRAIN  %d cars", data.TrainSize)
			if data.InTrain {
				trainLabel += "  \u26A0 STUCK"
			}
			o.drawStr(mem, trainLabel, pad, y, ww-pad, y+o.px(16))
		}
	}

cleanup:
	gDeleteObj.Call(fTitle)
	gDeleteObj.Call(fBody)
	gDeleteObj.Call(fSmall)

	gBitBlt.Call(hdc, 0, 0, uintptr(w), uintptr(h), mem, 0, 0, srcCopy)
	gSelectObj.Call(mem, oldBmp)
	gDeleteObj.Call(bmp)
	gDeleteDC.Call(mem)
	uEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
}

func (o *strategyOverlay) paintCar(mem uintptr, car *dto.StrategyCar, label string, y, ww, pad int32, data *dto.StrategyOverlayData) int32 {
	fBody := o.mkFont(14, 600)
	fSmall := o.mkFont(11, 600)
	defer gDeleteObj.Call(fBody)
	defer gDeleteObj.Call(fSmall)

	gSelectObj.Call(mem, fBody)

	if car == nil {
		gSetTextColor.Call(mem, rgb(60, 60, 60))
		o.drawStr(mem, label+"  ---", pad, y, ww-pad, y+o.px(16))
		return y + o.px(22)
	}

	// Line 1: label + name + gap
	gSetTextColor.Call(mem, rgb(229, 226, 227))
	gapSec := float64(car.GapMs) / 1000.0
	gapSign := "+"
	if label[0] == 0xe2 || label[0] == '\xe2' { // check for triangle down (BEHIND)
		// For "behind", gap is how far they are behind us
	}
	line1 := fmt.Sprintf("%s  %s  %s%.1fs", label, abbreviateDriverOverlay(car.Name), gapSign, gapSec)
	o.drawStr(mem, line1, pad, y, ww-pad, y+o.px(16))
	y += o.px(18)

	// Line 2: tire info + pits + pace
	gSelectObj.Call(mem, fSmall)
	gSetTextColor.Call(mem, stratTireColor(car.TireCompound))
	tireStr := fmt.Sprintf("%s %dL", stratTireLabel(car.TireCompound), car.TireAge)
	o.drawStr(mem, tireStr, pad+o.px(8), y, pad+o.px(90), y+o.px(14))

	pitLabel := "0 stops"
	if car.PitStops > 0 {
		pitLabel = fmt.Sprintf("%d stop", car.PitStops)
		if car.PitStops > 1 {
			pitLabel += "s"
		}
	}
	gSetTextColor.Call(mem, rgb(132, 147, 150))
	o.drawStr(mem, pitLabel, pad+o.px(92), y, pad+o.px(160), y+o.px(14))

	if car.PaceDeltaMs != 0 {
		paceCol := rgb(205, 255, 19) // faster
		paceSign := ""
		paceVal := car.PaceDeltaMs / 1000.0
		if paceVal > 0 {
			paceCol = rgb(255, 82, 92) // slower
			paceSign = "+"
		}
		gSetTextColor.Call(mem, paceCol)
		paceStr := fmt.Sprintf("%s%.1fs", paceSign, paceVal)
		o.drawStr(mem, paceStr, ww-pad-o.px(60), y, ww-pad, y+o.px(14))
	}
	y += o.px(18)
	return y
}

func (o *strategyOverlay) drawStr(mem uintptr, s string, l, t, r, b int32) {
	txt := utf16Str(s)
	rc := w32Rect{l, t, r, b}
	gDrawText.Call(mem, uintptr(unsafe.Pointer(&txt[0])), uintptr(len(txt)-1),
		uintptr(unsafe.Pointer(&rc)), dtVCenter|dtSingle)
}

func (o *strategyOverlay) drawSep(mem uintptr, left, right, y int32) {
	p, _, _ := gCreatePen.Call(psSolid, 1, rgb(30, 30, 30))
	gSelectObj.Call(mem, p)
	gMoveToEx.Call(mem, uintptr(left), uintptr(y), 0)
	gLineTo.Call(mem, uintptr(right), uintptr(y))
	gDeleteObj.Call(p)
}

func (o *strategyOverlay) mkFont(logPx int, weight int) uintptr {
	h := -int(math.Round(float64(logPx) * o.scale * o.dpiScale))
	name := utf16Ptr("Segoe UI")
	font, _, _ := gCreateFont.Call(uintptr(h), 0, 0, 0, uintptr(weight), 0, 0, 0, 1, 0, 0, 6, 0,
		uintptr(unsafe.Pointer(name)))
	return font
}

func stratVerdictColor(v string) uintptr {
	switch v {
	case "VIABLE":
		return rgb(205, 255, 19)
	case "RISKY":
		return rgb(255, 179, 178)
	default:
		return rgb(80, 80, 80)
	}
}

func stratTireColor(compound string) uintptr {
	switch compound {
	case "soft":
		return rgb(255, 82, 92)
	case "medium":
		return rgb(255, 200, 0)
	case "hard":
		return rgb(229, 226, 227)
	case "inter":
		return rgb(0, 200, 80)
	case "wet":
		return rgb(0, 140, 255)
	default:
		return rgb(132, 147, 150)
	}
}

func stratTireLabel(compound string) string {
	switch compound {
	case "soft":
		return "SOFT"
	case "medium":
		return "MED"
	case "hard":
		return "HARD"
	case "inter":
		return "INTER"
	case "wet":
		return "WET"
	default:
		return "---"
	}
}

func abbreviateDriverOverlay(name string) string {
	if len(name) <= 3 {
		return name
	}
	// Return last 3 characters uppercase (F1 convention)
	runes := []rune(name)
	if len(runes) > 3 {
		return string(runes[len(runes)-3:])
	}
	return name
}
