//go:build windows

package main

import (
	"fmt"
	"log/slog"
	"runtime"
	"sync/atomic"
	"syscall"
	"unsafe"

	"frc.engineer/internal/telemetry"
)

var (
	shcore              = syscall.NewLazyDLL("shcore.dll")
	setProcessDpiAware  = u32.NewProc("SetProcessDPIAware")
	setDpiAwareness     = shcore.NewProc("SetProcessDpiAwareness")
)

// weatherOverlay is a transparent, always-on-top, rectangular Win32 overlay
// that displays a compact weather forecast list for drivers.
type weatherOverlay struct {
	pm         *telemetry.PitwallManager
	hwnd       uintptr
	wndProcPtr uintptr
	width      int
	height     int
	drag       bool
	lastPt     w32Point
	alpha      uint8
	running    atomic.Bool
	classReg   atomic.Bool
}

func newWeatherOverlay(pm *telemetry.PitwallManager) *weatherOverlay {
	ov := &weatherOverlay{pm: pm, width: 340, height: 420, alpha: 230}
	ov.wndProcPtr = syscall.NewCallback(ov.wndProc)
	return ov
}

func (o *weatherOverlay) IsRunning() bool { return o.running.Load() }

func (o *weatherOverlay) Start() {
	if o.running.Load() {
		return
	}
	go o.run()
}

func (o *weatherOverlay) Stop() {
	if !o.running.Load() {
		return
	}
	uPostMessage.Call(o.hwnd, wmClose, 0, 0)
}

func (o *weatherOverlay) Toggle() bool {
	if o.running.Load() {
		o.Stop()
		return false
	}
	o.Start()
	return true
}

func (o *weatherOverlay) run() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	o.running.Store(true)
	defer o.running.Store(false)

	defer func() {
		if r := recover(); r != nil {
			slog.Error("weather overlay panic", "error", r)
		}
	}()

	// Enable per-monitor DPI awareness so Windows doesn't bitmap-scale the overlay.
	// Try shcore (Win8.1+) first, fall back to user32 (Vista+).
	if ret, _, _ := setDpiAwareness.Call(2); ret != 0 { // 2 = PROCESS_PER_MONITOR_DPI_AWARE
		setProcessDpiAware.Call()
	}

	hInst, _, _ := kGetModuleHandle.Call(0)
	if hInst == 0 {
		slog.Error("weather overlay: GetModuleHandle failed")
		return
	}

	cls, _ := syscall.UTF16PtrFromString("FRCWeatherOverlay")
	cursor, _, _ := uLoadCursor.Call(0, uintptr(32512))

	uUnregClass.Call(uintptr(unsafe.Pointer(cls)), hInst)

	wc := w32WndClassEx{
		Size:      uint32(unsafe.Sizeof(w32WndClassEx{})),
		Style:     csHRedraw | csVRedraw,
		WndProc:   o.wndProcPtr,
		Instance:  hInst,
		Cursor:    cursor,
		ClassName: cls,
	}
	atom, _, regErr := uRegClassEx.Call(uintptr(unsafe.Pointer(&wc)))
	if atom == 0 {
		errno, _, _ := kGetLastError.Call()
		slog.Error("weather overlay: RegisterClassExW failed",
			"err", regErr, "lastError", errno)
		return
	}
	o.classReg.Store(true)

	hwnd, _, createErr := uCreateWindowEx.Call(
		exTopmost|exToolWin|exLayered,
		uintptr(unsafe.Pointer(cls)), 0,
		wsPopup|wsVisible,
		100, 100, uintptr(o.width), uintptr(o.height),
		0, 0, hInst, 0,
	)
	runtime.KeepAlive(cls)
	if hwnd == 0 {
		errno, _, _ := kGetLastError.Call()
		slog.Error("weather overlay: CreateWindowExW failed",
			"err", createErr, "lastError", errno)
		return
	}
	o.hwnd = hwnd

	uSetLayeredAttr.Call(hwnd, 0, uintptr(o.alpha), lwaAlpha)

	// 2 fps timer — weather data doesn't need fast refresh
	uSetTimer.Call(hwnd, 1, 500, 0)

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

func (o *weatherOverlay) wndProc(hwnd, msg, wp, lp uintptr) uintptr {
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
				uintptr(rc.Left+pt.X-o.lastPt.X),
				uintptr(rc.Top+pt.Y-o.lastPt.Y),
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
		if keys&0x0008 != 0 { // Ctrl+Wheel → opacity
			if delta > 0 && o.alpha < 245 {
				o.alpha += 10
			} else if delta < 0 && o.alpha > 30 {
				o.alpha -= 10
			}
			uSetLayeredAttr.Call(o.hwnd, 0, uintptr(o.alpha), lwaAlpha)
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

func (o *weatherOverlay) paint(hwnd uintptr) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("weather paint panic", "error", r)
		}
	}()

	var ps w32PaintStruct
	hdc, _, _ := uBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))

	w, h := o.width, o.height

	// Double buffer
	mem, _, _ := gCreateDC.Call(hdc)
	bmp, _, _ := gCreateBmp.Call(hdc, uintptr(w), uintptr(h))
	oldBmp, _, _ := gSelectObj.Call(mem, bmp)

	// Background
	bg, _, _ := gSolidBrush.Call(rgb(14, 14, 15))
	rc := w32Rect{0, 0, int32(w), int32(h)}
	gFillRect.Call(mem, uintptr(unsafe.Pointer(&rc)), bg)
	gDeleteObj.Call(bg)

	// Border
	borderPen, _, _ := gCreatePen.Call(psSolid, 1, rgb(0, 60, 68))
	gSelectObj.Call(mem, borderPen)
	hollow, _, _ := gStockObj.Call(5)
	gSelectObj.Call(mem, hollow)
	gMoveToEx.Call(mem, 0, 0, 0)
	gLineTo.Call(mem, uintptr(w-1), 0)
	gLineTo.Call(mem, uintptr(w-1), uintptr(h-1))
	gLineTo.Call(mem, 0, uintptr(h-1))
	gLineTo.Call(mem, 0, 0)
	gDeleteObj.Call(borderPen)

	gSetBkMode.Call(mem, bkTransp)

	// Fonts — larger sizes for readability on high-DPI displays
	fontTitle := createWeatherFont(mem, 18, 700)
	fontBody := createWeatherFont(mem, 15, 600)
	fontSmall := createWeatherFont(mem, 13, 500)

	data := o.pm.BuildWeatherData()
	y := int32(12)

	// Header
	gSetTextColor.Call(mem, rgb(0, 229, 255))
	gSelectObj.Call(mem, fontTitle)
	title := utf16Str("WEATHER FORECAST")
	titleRc := w32Rect{14, y, int32(w) - 14, y + 22}
	gDrawText.Call(mem, uintptr(unsafe.Pointer(&title[0])), uintptr(len(title)-1),
		uintptr(unsafe.Pointer(&titleRc)), 0)
	y += 28

	if data == nil {
		gSetTextColor.Call(mem, rgb(80, 80, 80))
		gSelectObj.Call(mem, fontBody)
		waiting := utf16Str("Waiting for session...")
		wRc := w32Rect{14, y + 30, int32(w) - 14, y + 50}
		gDrawText.Call(mem, uintptr(unsafe.Pointer(&waiting[0])), uintptr(len(waiting)-1),
			uintptr(unsafe.Pointer(&wRc)), dtCenter)
	} else {
		// Current conditions bar
		accentBar, _, _ := gSolidBrush.Call(rgb(0, 229, 255))
		barRc := w32Rect{0, y, int32(w), y + 2}
		gFillRect.Call(mem, uintptr(unsafe.Pointer(&barRc)), accentBar)
		gDeleteObj.Call(accentBar)
		y += 8

		gSelectObj.Call(mem, fontBody)
		gSetTextColor.Call(mem, rgb(200, 200, 200))
		currentLine := utf16Str(fmt.Sprintf("NOW  %s  Track %.0f°C  Air %.0f°C",
			weatherLabel(data.CurrentWeather), data.TrackTemp, data.AirTemp))
		curRc := w32Rect{14, y, int32(w) - 14, y + 18}
		gDrawText.Call(mem, uintptr(unsafe.Pointer(&currentLine[0])), uintptr(len(currentLine)-1),
			uintptr(unsafe.Pointer(&curRc)), 0)
		y += 26

		// Separator
		sepPen, _, _ := gCreatePen.Call(psSolid, 1, rgb(30, 30, 30))
		gSelectObj.Call(mem, sepPen)
		gMoveToEx.Call(mem, 14, uintptr(y), 0)
		gLineTo.Call(mem, uintptr(w-14), uintptr(y))
		gDeleteObj.Call(sepPen)
		y += 8

		// Column headers
		gSelectObj.Call(mem, fontSmall)
		gSetTextColor.Call(mem, rgb(80, 93, 96))
		o.drawTextH(mem, "TIME", 14, y, 56, 16)
		o.drawTextH(mem, "COND", 74, y, 80, 16)
		o.drawTextH(mem, "TRACK", 160, y, 52, 16)
		o.drawTextH(mem, "AIR", 216, y, 46, 16)
		o.drawTextH(mem, "RAIN", int32(w)-62, y, 48, 16)
		y += 20

		// Forecast rows
		gSelectObj.Call(mem, fontBody)
		for _, f := range data.Forecasts {
			if y > int32(h)-20 {
				break
			}

			// Row background for high rain
			if f.RainPercentage >= 50 {
				rowBg, _, _ := gSolidBrush.Call(rgb(40, 15, 15))
				rowRc := w32Rect{1, y - 2, int32(w) - 1, y + 22}
				gFillRect.Call(mem, uintptr(unsafe.Pointer(&rowRc)), rowBg)
				gDeleteObj.Call(rowBg)
			}

			// Time offset
			gSetTextColor.Call(mem, rgb(229, 226, 227))
			timeStr := fmt.Sprintf("+%dM", f.TimeOffset)
			o.drawTextH(mem, timeStr, 14, y, 56, 18)

			// Weather condition
			condColor := weatherConditionColor(f.Weather)
			gSetTextColor.Call(mem, condColor)
			o.drawTextH(mem, weatherLabel(f.Weather), 74, y, 80, 18)

			// Track temp + trend
			gSetTextColor.Call(mem, rgb(229, 226, 227))
			trackStr := fmt.Sprintf("%.0f°", f.TrackTemp)
			o.drawTextH(mem, trackStr+tempTrend(f.TrackTempChange), 160, y, 52, 18)

			// Air temp + trend
			airStr := fmt.Sprintf("%.0f°", f.AirTemp)
			o.drawTextH(mem, airStr+tempTrend(f.AirTempChange), 216, y, 46, 18)

			// Rain percentage
			rainColor := rainPercentColor(f.RainPercentage)
			gSetTextColor.Call(mem, rainColor)
			rainStr := fmt.Sprintf("%d%%", f.RainPercentage)
			o.drawTextH(mem, rainStr, int32(w)-62, y, 48, 18)

			// Rain bar
			barX := int32(w) - 62
			barY := y + 19
			barW := int32(48)
			barBgBr, _, _ := gSolidBrush.Call(rgb(30, 30, 30))
			barBgRc := w32Rect{barX, barY, barX + barW, barY + 3}
			gFillRect.Call(mem, uintptr(unsafe.Pointer(&barBgRc)), barBgBr)
			gDeleteObj.Call(barBgBr)

			fillW := int32(float64(barW) * float64(f.RainPercentage) / 100.0)
			if fillW > 0 {
				barFillBr, _, _ := gSolidBrush.Call(rainColor)
				barFillRc := w32Rect{barX, barY, barX + fillW, barY + 3}
				gFillRect.Call(mem, uintptr(unsafe.Pointer(&barFillRc)), barFillBr)
				gDeleteObj.Call(barFillBr)
			}

			y += 28
		}

		if len(data.Forecasts) == 0 {
			gSetTextColor.Call(mem, rgb(80, 80, 80))
			gSelectObj.Call(mem, fontSmall)
			noData := utf16Str("No forecast data")
			ndRc := w32Rect{10, y + 10, int32(w) - 10, y + 24}
			gDrawText.Call(mem, uintptr(unsafe.Pointer(&noData[0])), uintptr(len(noData)-1),
				uintptr(unsafe.Pointer(&ndRc)), dtCenter)
		}
	}

	gDeleteObj.Call(fontTitle)
	gDeleteObj.Call(fontBody)
	gDeleteObj.Call(fontSmall)

	// Blit
	gBitBlt.Call(hdc, 0, 0, uintptr(w), uintptr(h), mem, 0, 0, srcCopy)
	gSelectObj.Call(mem, oldBmp)
	gDeleteObj.Call(bmp)
	gDeleteDC.Call(mem)

	uEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
}

func (o *weatherOverlay) drawTextH(mem uintptr, s string, x, y, w, h int32) {
	t := utf16Str(s)
	rc := w32Rect{x, y, x + w, y + h}
	gDrawText.Call(mem, uintptr(unsafe.Pointer(&t[0])), uintptr(len(t)-1),
		uintptr(unsafe.Pointer(&rc)), 0)
}

func createWeatherFont(_ uintptr, height int, weight int) uintptr {
	fontName := utf16Ptr("Segoe UI")
	// quality=6 → CLEARTYPE_QUALITY for sharp text on LCD panels
	font, _, _ := gCreateFont.Call(uintptr(height), 0, 0, 0, uintptr(weight), 0, 0, 0, 1, 0, 0, 6, 0,
		uintptr(unsafe.Pointer(fontName)))
	return font
}

func weatherLabel(w string) string {
	switch w {
	case "clear":
		return "CLEAR"
	case "light_cloud":
		return "CLOUD"
	case "overcast":
		return "OVCST"
	case "light_rain":
		return "L.RAIN"
	case "heavy_rain":
		return "H.RAIN"
	case "storm":
		return "STORM"
	default:
		return "---"
	}
}

func weatherConditionColor(w string) uintptr {
	switch w {
	case "clear":
		return rgb(205, 255, 19) // lime
	case "light_cloud", "overcast":
		return rgb(195, 245, 255) // light cyan
	case "light_rain":
		return rgb(0, 229, 255) // cyan
	case "heavy_rain":
		return rgb(255, 179, 178) // soft red
	case "storm":
		return rgb(255, 82, 92) // red
	default:
		return rgb(132, 147, 150)
	}
}

func tempTrend(change int) string {
	switch {
	case change > 0:
		return "^"
	case change < 0:
		return "v"
	default:
		return ""
	}
}

func rainPercentColor(pct int) uintptr {
	switch {
	case pct >= 60:
		return rgb(255, 82, 92) // red
	case pct >= 30:
		return rgb(255, 179, 178) // soft orange/red
	default:
		return rgb(0, 229, 255) // cyan
	}
}

