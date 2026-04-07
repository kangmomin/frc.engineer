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

	"frc.engineer/internal/telemetry"
)

var (
	shcore          = syscall.NewLazyDLL("shcore.dll")
	setDpiAwareness = shcore.NewProc("SetProcessDpiAwareness")
	getDpiForWindow = u32.NewProc("GetDpiForWindow")
	gGetDeviceCaps  = g32.NewProc("GetDeviceCaps")
)

const (
	swpNoMove    = 0x0002
	logPixelsX   = 88 // GetDeviceCaps index for horizontal DPI
	minScale     = 0.6
	maxScale     = 2.5
	baseWidth    = 340
	baseHeight   = 420
	defaultScale = 1.0
)

// weatherOverlay is a transparent, always-on-top, borderless Win32 overlay
// that displays a compact weather forecast list for drivers.
// - Scroll wheel: resize window
// - Ctrl+Scroll: adjust opacity
// - Left-drag: move window
// - Right-click: close
type weatherOverlay struct {
	pm         *telemetry.PitwallManager
	hwnd       uintptr
	wndProcPtr uintptr
	scale      float64 // user zoom factor (0.6 .. 2.5)
	dpiScale   float64 // system DPI / 96
	drag       bool
	lastPt     w32Point
	alpha      uint8
	running    atomic.Bool
	classReg   atomic.Bool
}

func newWeatherOverlay(pm *telemetry.PitwallManager) *weatherOverlay {
	ov := &weatherOverlay{pm: pm, scale: defaultScale, dpiScale: 1.0, alpha: 230}
	ov.wndProcPtr = syscall.NewCallback(ov.wndProc)
	return ov
}

// px converts a logical dimension to physical pixels.
func (o *weatherOverlay) px(v float64) int32 {
	return int32(math.Round(v * o.scale * o.dpiScale))
}

func (o *weatherOverlay) winWidth() int  { return int(math.Round(float64(baseWidth) * o.scale * o.dpiScale)) }
func (o *weatherOverlay) winHeight() int { return int(math.Round(float64(baseHeight) * o.scale * o.dpiScale)) }

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

	// Per-monitor DPI awareness (Win8.1+), fallback to Vista+.
	if ret, _, _ := setDpiAwareness.Call(2); ret != 0 {
		u32.NewProc("SetProcessDPIAware").Call()
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
		slog.Error("weather overlay: RegisterClassExW failed", "err", regErr, "lastError", errno)
		return
	}
	o.classReg.Store(true)

	// Create at temporary 1x1 to get DPI, then resize.
	hwnd, _, createErr := uCreateWindowEx.Call(
		exTopmost|exToolWin|exLayered,
		uintptr(unsafe.Pointer(cls)), 0,
		wsPopup|wsVisible,
		200, 200, 1, 1,
		0, 0, hInst, 0,
	)
	runtime.KeepAlive(cls)
	if hwnd == 0 {
		errno, _, _ := kGetLastError.Call()
		slog.Error("weather overlay: CreateWindowExW failed", "err", createErr, "lastError", errno)
		return
	}
	o.hwnd = hwnd

	// Query actual DPI for this window's monitor.
	o.dpiScale = o.queryDPI(hwnd)

	// Resize to real dimensions now that we know DPI.
	w, h := uintptr(o.winWidth()), uintptr(o.winHeight())
	uSetWindowPos.Call(hwnd, 0, 200, 200, w, h, swpNoZOrd)

	uSetLayeredAttr.Call(hwnd, 0, uintptr(o.alpha), lwaAlpha)

	// 2 fps refresh — weather data is slow-changing.
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

func (o *weatherOverlay) queryDPI(hwnd uintptr) float64 {
	// Try GetDpiForWindow (Win10 1607+).
	if dpi, _, _ := getDpiForWindow.Call(hwnd); dpi > 0 {
		return float64(dpi) / 96.0
	}
	// Fallback: GetDeviceCaps.
	hdc, _, _ := u32.NewProc("GetDC").Call(0)
	if hdc != 0 {
		dpi, _, _ := gGetDeviceCaps.Call(hdc, logPixelsX)
		u32.NewProc("ReleaseDC").Call(0, hdc)
		if dpi > 0 {
			return float64(dpi) / 96.0
		}
	}
	return 1.0
}

func (o *weatherOverlay) resize() {
	w, h := uintptr(o.winWidth()), uintptr(o.winHeight())
	uSetWindowPos.Call(o.hwnd, 0, 0, 0, w, h, swpNoMove|swpNoZOrd)
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
		if keys&0x0008 != 0 {
			// Ctrl+Wheel → opacity
			if delta > 0 && o.alpha < 245 {
				o.alpha += 10
			} else if delta < 0 && o.alpha > 30 {
				o.alpha -= 10
			}
			uSetLayeredAttr.Call(o.hwnd, 0, uintptr(o.alpha), lwaAlpha)
		} else {
			// Wheel → resize window
			step := 0.1
			if delta > 0 && o.scale < maxScale {
				o.scale = math.Min(o.scale+step, maxScale)
			} else if delta < 0 && o.scale > minScale {
				o.scale = math.Max(o.scale-step, minScale)
			}
			o.resize()
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

// ── Paint ──────────────────────────────────────────────────────────

func (o *weatherOverlay) paint(hwnd uintptr) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("weather paint panic", "error", r)
		}
	}()

	var ps w32PaintStruct
	hdc, _, _ := uBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))

	w, h := o.winWidth(), o.winHeight()

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

	// Fonts — scaled to DPI and user zoom
	fontTitle := o.makeFont(18, 700)
	fontBody := o.makeFont(15, 600)
	fontSmall := o.makeFont(12, 600)

	data := o.pm.BuildWeatherData()

	// Layout constants: proportional column positions (fraction of width)
	pad := o.px(14)
	ww := int32(w)
	col1 := pad                        // TIME start
	col2 := int32(float64(ww) * 0.18)  // COND start
	col3 := int32(float64(ww) * 0.47)  // TRACK start
	col4 := int32(float64(ww) * 0.63)  // AIR start
	col5 := int32(float64(ww) * 0.78)  // RAIN start
	col5End := ww - pad

	rowH := o.px(24) // row height
	fontH := o.px(16)
	y := pad

	// ── Header ──
	gSetTextColor.Call(mem, rgb(0, 229, 255))
	gSelectObj.Call(mem, fontTitle)
	o.text(mem, "WEATHER FORECAST", pad, y, ww-pad, y+o.px(20))
	y += o.px(26)

	if data == nil {
		gSetTextColor.Call(mem, rgb(80, 80, 80))
		gSelectObj.Call(mem, fontBody)
		o.text(mem, "Waiting for session...", pad, y+o.px(30), ww-pad, y+o.px(48))
		goto cleanup
	}

	{
		// ── Accent bar ──
		accentBr, _, _ := gSolidBrush.Call(rgb(0, 229, 255))
		barRc := w32Rect{0, y, ww, y + 2}
		gFillRect.Call(mem, uintptr(unsafe.Pointer(&barRc)), accentBr)
		gDeleteObj.Call(accentBr)
		y += o.px(6)

		// ── Current conditions ──
		gSelectObj.Call(mem, fontBody)
		gSetTextColor.Call(mem, rgb(200, 200, 200))
		cur := fmt.Sprintf("NOW   %s   Track %.0f\u00B0C   Air %.0f\u00B0C",
			weatherLabel(data.CurrentWeather), data.TrackTemp, data.AirTemp)
		o.text(mem, cur, pad, y, ww-pad, y+fontH)
		y += o.px(24)

		// ── Separator ──
		sepPen, _, _ := gCreatePen.Call(psSolid, 1, rgb(30, 30, 30))
		gSelectObj.Call(mem, sepPen)
		gMoveToEx.Call(mem, uintptr(pad), uintptr(y), 0)
		gLineTo.Call(mem, uintptr(ww-pad), uintptr(y))
		gDeleteObj.Call(sepPen)
		y += o.px(6)

		// ── Column headers ──
		gSelectObj.Call(mem, fontSmall)
		gSetTextColor.Call(mem, rgb(80, 93, 96))
		hdrH := o.px(14)
		o.text(mem, "TIME", col1, y, col2, y+hdrH)
		o.text(mem, "CONDITION", col2, y, col3, y+hdrH)
		o.text(mem, "TRACK", col3, y, col4, y+hdrH)
		o.text(mem, "AIR", col4, y, col5, y+hdrH)
		o.text(mem, "RAIN", col5, y, col5End, y+hdrH)
		y += o.px(18)

		// ── Forecast rows ──
		gSelectObj.Call(mem, fontBody)
		for _, f := range data.Forecasts {
			if y+rowH > int32(h)-pad {
				break
			}

			// Row highlight for high rain
			if f.RainPercentage >= 50 {
				rowBg, _, _ := gSolidBrush.Call(rgb(40, 15, 15))
				rowRc := w32Rect{1, y - 1, ww - 1, y + rowH}
				gFillRect.Call(mem, uintptr(unsafe.Pointer(&rowRc)), rowBg)
				gDeleteObj.Call(rowBg)
			}

			// Time
			gSetTextColor.Call(mem, rgb(229, 226, 227))
			o.text(mem, fmt.Sprintf("+%dM", f.TimeOffset), col1, y, col2, y+fontH)

			// Condition
			gSetTextColor.Call(mem, weatherConditionColor(f.Weather))
			o.text(mem, weatherLabel(f.Weather), col2, y, col3, y+fontH)

			// Track temp + trend
			gSetTextColor.Call(mem, rgb(229, 226, 227))
			o.text(mem, fmt.Sprintf("%.0f\u00B0%s", f.TrackTemp, tempTrend(f.TrackTempChange)), col3, y, col4, y+fontH)

			// Air temp + trend
			o.text(mem, fmt.Sprintf("%.0f\u00B0%s", f.AirTemp, tempTrend(f.AirTempChange)), col4, y, col5, y+fontH)

			// Rain %
			rainCol := rainPercentColor(f.RainPercentage)
			gSetTextColor.Call(mem, rainCol)
			o.text(mem, fmt.Sprintf("%d%%", f.RainPercentage), col5, y, col5End, y+fontH)

			// Rain bar
			barTop := y + fontH + 1
			barH := int32(math.Max(float64(o.px(3)), 2))
			barW := col5End - col5
			barBgBr, _, _ := gSolidBrush.Call(rgb(30, 30, 30))
			barBgRc := w32Rect{col5, barTop, col5 + barW, barTop + barH}
			gFillRect.Call(mem, uintptr(unsafe.Pointer(&barBgRc)), barBgBr)
			gDeleteObj.Call(barBgBr)

			fillW := int32(float64(barW) * float64(f.RainPercentage) / 100.0)
			if fillW > 0 {
				barFillBr, _, _ := gSolidBrush.Call(rainCol)
				barFillRc := w32Rect{col5, barTop, col5 + fillW, barTop + barH}
				gFillRect.Call(mem, uintptr(unsafe.Pointer(&barFillRc)), barFillBr)
				gDeleteObj.Call(barFillBr)
			}

			y += rowH
		}

		if len(data.Forecasts) == 0 {
			gSetTextColor.Call(mem, rgb(80, 80, 80))
			gSelectObj.Call(mem, fontSmall)
			o.text(mem, "No forecast data", pad, y+o.px(10), ww-pad, y+o.px(26))
		}
	}

cleanup:
	gDeleteObj.Call(fontTitle)
	gDeleteObj.Call(fontBody)
	gDeleteObj.Call(fontSmall)

	gBitBlt.Call(hdc, 0, 0, uintptr(w), uintptr(h), mem, 0, 0, srcCopy)
	gSelectObj.Call(mem, oldBmp)
	gDeleteObj.Call(bmp)
	gDeleteDC.Call(mem)
	uEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
}

// ── Helpers ────────────────────────────────────────────────────────

func (o *weatherOverlay) text(mem uintptr, s string, left, top, right, bottom int32) {
	t := utf16Str(s)
	rc := w32Rect{left, top, right, bottom}
	gDrawText.Call(mem, uintptr(unsafe.Pointer(&t[0])), uintptr(len(t)-1),
		uintptr(unsafe.Pointer(&rc)), dtVCenter|dtSingle)
}

func (o *weatherOverlay) makeFont(logicalPx int, weight int) uintptr {
	// Negative height = character height (not cell height) → sharper glyph sizing.
	h := -int(math.Round(float64(logicalPx) * o.scale * o.dpiScale))
	fontName := utf16Ptr("Segoe UI")
	font, _, _ := gCreateFont.Call(
		uintptr(h), 0, 0, 0, uintptr(weight),
		0, 0, 0, 1,  // italic=0, underline=0, strikeout=0, charset=DEFAULT
		0, 0,         // outPrecision, clipPrecision
		6,            // quality = CLEARTYPE_QUALITY
		0,            // pitchAndFamily
		uintptr(unsafe.Pointer(fontName)),
	)
	return font
}

func weatherLabel(w string) string {
	switch w {
	case "clear":
		return "CLEAR"
	case "light_cloud":
		return "CLOUD"
	case "overcast":
		return "OVERCAST"
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
		return rgb(205, 255, 19)
	case "light_cloud", "overcast":
		return rgb(195, 245, 255)
	case "light_rain":
		return rgb(0, 229, 255)
	case "heavy_rain":
		return rgb(255, 179, 178)
	case "storm":
		return rgb(255, 82, 92)
	default:
		return rgb(132, 147, 150)
	}
}

func tempTrend(change int) string {
	switch {
	case change > 0:
		return "\u2191" // ↑
	case change < 0:
		return "\u2193" // ↓
	default:
		return ""
	}
}

func rainPercentColor(pct int) uintptr {
	switch {
	case pct >= 60:
		return rgb(255, 82, 92)
	case pct >= 30:
		return rgb(255, 179, 178)
	default:
		return rgb(0, 229, 255)
	}
}
