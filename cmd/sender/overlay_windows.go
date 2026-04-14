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

// Win32 constants
const (
	csHRedraw = 0x0002
	csVRedraw = 0x0001
	wsPopup   = 0x80000000
	wsVisible = 0x10000000
	exTopmost = 0x00000008
	exToolWin = 0x00000080
	exLayered = 0x00080000
	lwaAlpha  = 0x00000002
	swpNoSize = 0x0001
	swpNoZOrd = 0x0004
	srcCopy   = 0x00CC0020
	psSolid   = 0
	bkTransp  = 1
	dtCenter  = 0x01
	dtVCenter = 0x04
	dtSingle  = 0x20

	wmDestroy  = 0x0002
	wmPaint    = 0x000F
	wmClose    = 0x0010
	wmTimer    = 0x0113
	wmLBtnDown = 0x0201
	wmLBtnUp   = 0x0202
	wmRBtnUp   = 0x0205
	wmMMove    = 0x0200
	wmMWheel   = 0x020A
)

// Win32 DLL procs
var (
	k32 = syscall.NewLazyDLL("kernel32.dll")
	u32 = syscall.NewLazyDLL("user32.dll")
	g32 = syscall.NewLazyDLL("gdi32.dll")

	kGetModuleHandle = k32.NewProc("GetModuleHandleW")
	kGetLastError    = k32.NewProc("GetLastError")

	uRegClassEx     = u32.NewProc("RegisterClassExW")
	uUnregClass     = u32.NewProc("UnregisterClassW")
	uCreateWindowEx = u32.NewProc("CreateWindowExW")
	uDefWindowProc  = u32.NewProc("DefWindowProcW")
	uGetMessage     = u32.NewProc("GetMessageW")
	uTranslateMsg   = u32.NewProc("TranslateMessage")
	uDispatchMsg    = u32.NewProc("DispatchMessageW")
	uPostQuitMsg    = u32.NewProc("PostQuitMessage")
	uDestroyWindow  = u32.NewProc("DestroyWindow")
	uSetWindowPos   = u32.NewProc("SetWindowPos")
	uBeginPaint     = u32.NewProc("BeginPaint")
	uEndPaint       = u32.NewProc("EndPaint")
	uInvalidateRect = u32.NewProc("InvalidateRect")
	uSetTimer       = u32.NewProc("SetTimer")
	uKillTimer      = u32.NewProc("KillTimer")
	uGetCursorPos   = u32.NewProc("GetCursorPos")
	uSetCapture     = u32.NewProc("SetCapture")
	uReleaseCapture = u32.NewProc("ReleaseCapture")
	uPostMessage    = u32.NewProc("PostMessageW")
	uGetWindowRect  = u32.NewProc("GetWindowRect")
	uLoadCursor     = u32.NewProc("LoadCursorW")
	uSetWindowRgn   = u32.NewProc("SetWindowRgn")
	uSetLayeredAttr = u32.NewProc("SetLayeredWindowAttributes")

	gCreateDC     = g32.NewProc("CreateCompatibleDC")
	gCreateBmp    = g32.NewProc("CreateCompatibleBitmap")
	gDeleteDC     = g32.NewProc("DeleteDC")
	gDeleteObj    = g32.NewProc("DeleteObject")
	gSelectObj    = g32.NewProc("SelectObject")
	gBitBlt       = g32.NewProc("BitBlt")
	gSolidBrush   = g32.NewProc("CreateSolidBrush")
	gCreatePen    = g32.NewProc("CreatePen")
	gEllipse      = g32.NewProc("Ellipse")
	gMoveToEx     = g32.NewProc("MoveToEx")
	gLineTo       = g32.NewProc("LineTo")
	gPolygon      = g32.NewProc("Polygon")
	gSetBkMode    = g32.NewProc("SetBkMode")
	gSetTextColor = g32.NewProc("SetTextColor")
	gCreateFont   = g32.NewProc("CreateFontW")
	gDrawText     = u32.NewProc("DrawTextW")
	gFillRect     = u32.NewProc("FillRect")
	gStockObj     = g32.NewProc("GetStockObject")
	gEllipticRgn  = g32.NewProc("CreateEllipticRgn")
)

type w32Rect struct{ Left, Top, Right, Bottom int32 }
type w32Point struct{ X, Y int32 }
type w32Msg struct {
	Hwnd           uintptr
	Message        uint32
	WParam, LParam uintptr
	Time           uint32
	Pt             w32Point
}
type w32PaintStruct struct {
	HDC       uintptr
	FErase    int32
	RcPaint   w32Rect
	Restore   int32
	IncUpdate int32
	Rgb       [32]byte
}
type w32WndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	IconSm     uintptr
}

func rgb(r, g, b uint8) uintptr {
	return uintptr(uint32(r) | uint32(g)<<8 | uint32(b)<<16)
}

func utf16Ptr(s string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(s)
	return p
}

func utf16Str(s string) []uint16 {
	r, _ := syscall.UTF16FromString(s)
	return r
}

func ovTeamColor(id int) uintptr {
	switch id {
	case 0:
		return rgb(0, 210, 190)
	case 1:
		return rgb(220, 0, 0)
	case 2:
		return rgb(6, 0, 239)
	case 3:
		return rgb(255, 135, 0)
	case 4:
		return rgb(0, 90, 255)
	case 5:
		return rgb(0, 111, 98)
	case 6:
		return rgb(43, 69, 98)
	case 7:
		return rgb(182, 186, 189)
	case 8:
		return rgb(255, 135, 0)
	case 9:
		return rgb(82, 226, 82)
	default:
		return rgb(136, 136, 136)
	}
}

// radarOverlay is a transparent, always-on-top, circular Win32 overlay.
type radarOverlay struct {
	pm         *telemetry.PitwallManager
	hwnd       uintptr
	wndProcPtr uintptr // callback created once, reused across restarts
	size       int
	rangeM     float64
	x          int
	y          int
	drag       bool
	lastPt     w32Point
	alpha      uint8
	saveState  func(overlayWindowState)
	running    atomic.Bool
	classReg   atomic.Bool // true after the window class has been registered
}

func newRadarOverlay(pm *telemetry.PitwallManager, saved overlayWindowState, saveState func(overlayWindowState)) *radarOverlay {
	ov := &radarOverlay{
		pm:        pm,
		size:      250,
		rangeM:    saved.RangeM,
		x:         saved.X,
		y:         saved.Y,
		alpha:     saved.Alpha,
		saveState: saveState,
	}
	ov.wndProcPtr = syscall.NewCallback(ov.wndProc)
	return ov
}

func (o *radarOverlay) snapshotState() overlayWindowState {
	return overlayWindowState{
		X:      o.x,
		Y:      o.y,
		Alpha:  o.alpha,
		RangeM: o.rangeM,
	}
}

func (o *radarOverlay) persistLayout() {
	if o.saveState != nil {
		o.saveState(o.snapshotState())
	}
}

func (o *radarOverlay) IsRunning() bool { return o.running.Load() }

func (o *radarOverlay) Start() {
	if o.running.Load() {
		return
	}
	go o.run()
}

func (o *radarOverlay) Stop() {
	if !o.running.Load() {
		return
	}
	uPostMessage.Call(o.hwnd, wmClose, 0, 0)
}

func (o *radarOverlay) Toggle() bool {
	if o.running.Load() {
		o.Stop()
		return false
	}
	o.Start()
	return true
}

func (o *radarOverlay) run() {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	o.running.Store(true)
	defer o.running.Store(false)

	defer func() {
		if r := recover(); r != nil {
			slog.Error("radar overlay panic", "error", r)
		}
	}()

	hInst, _, _ := kGetModuleHandle.Call(0)
	if hInst == 0 {
		slog.Error("radar overlay: GetModuleHandle failed")
		return
	}

	cls, _ := syscall.UTF16PtrFromString("FRCRadarOverlay")
	cursor, _, _ := uLoadCursor.Call(0, uintptr(32512)) // IDC_ARROW

	// Always try to unregister first — handles both restart within same
	// process and stale class from a previous overlay run.
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
		slog.Error("radar overlay: RegisterClassExW failed",
			"err", regErr, "lastError", errno)
		return
	}
	o.classReg.Store(true)

	s := uintptr(o.size)
	hwnd, _, createErr := uCreateWindowEx.Call(
		exTopmost|exToolWin|exLayered,
		uintptr(unsafe.Pointer(cls)), 0,
		wsPopup|wsVisible,
		uintptr(o.x), uintptr(o.y), s, s,
		0, 0, hInst, 0,
	)
	runtime.KeepAlive(cls)
	if hwnd == 0 {
		errno, _, _ := kGetLastError.Call()
		slog.Error("radar overlay: CreateWindowExW failed",
			"err", createErr, "lastError", errno)
		return
	}
	o.hwnd = hwnd

	// Clip to circle
	rgn, _, _ := gEllipticRgn.Call(0, 0, s, s)
	uSetWindowRgn.Call(hwnd, rgn, 1)

	// Set initial window opacity
	uSetLayeredAttr.Call(hwnd, 0, uintptr(o.alpha), lwaAlpha)

	// 30 fps timer
	uSetTimer.Call(hwnd, 1, 33, 0)

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

func (o *radarOverlay) wndProc(hwnd, msg, wp, lp uintptr) uintptr {
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
			nextX := int(rc.Left + pt.X - o.lastPt.X)
			nextY := int(rc.Top + pt.Y - o.lastPt.Y)
			uSetWindowPos.Call(hwnd, 0,
				uintptr(nextX),
				uintptr(nextY),
				0, 0, swpNoSize|swpNoZOrd)
			o.x = nextX
			o.y = nextY
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
		keys := wp & 0xFFFF
		if keys&0x0008 != 0 { // Ctrl+Wheel → opacity
			if delta > 0 && o.alpha < 245 {
				o.alpha += 10
			} else if delta < 0 && o.alpha > 30 {
				o.alpha -= 10
			}
			uSetLayeredAttr.Call(o.hwnd, 0, uintptr(o.alpha), lwaAlpha)
		} else { // Wheel → zoom
			if delta > 0 && o.rangeM > 5 {
				o.rangeM -= 5
			} else if delta < 0 && o.rangeM < 200 {
				o.rangeM += 5
			}
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

func (o *radarOverlay) paint(hwnd uintptr) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("radar paint panic", "error", r)
		}
	}()

	var ps w32PaintStruct
	hdc, _, _ := uBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))

	sz := o.size
	cx, cy := sz/2, sz/2
	rad := cx - 4

	// Double buffer
	mem, _, _ := gCreateDC.Call(hdc)
	bmp, _, _ := gCreateBmp.Call(hdc, uintptr(sz), uintptr(sz))
	oldBmp, _, _ := gSelectObj.Call(mem, bmp)

	// Background
	bg, _, _ := gSolidBrush.Call(rgb(12, 12, 12))
	rc := w32Rect{0, 0, int32(sz), int32(sz)}
	gFillRect.Call(mem, uintptr(unsafe.Pointer(&rc)), bg)
	gDeleteObj.Call(bg)

	// Range rings + cross
	hollow, _, _ := gStockObj.Call(5) // HOLLOW_BRUSH
	ringPen, _, _ := gCreatePen.Call(psSolid, 1, rgb(30, 30, 30))
	gSelectObj.Call(mem, hollow)
	gSelectObj.Call(mem, ringPen)
	for i := 1; i <= 3; i++ {
		r := rad * i / 3
		gEllipse.Call(mem, uintptr(cx-r), uintptr(cy-r), uintptr(cx+r), uintptr(cy+r))
	}
	gDeleteObj.Call(ringPen)

	crossPen, _, _ := gCreatePen.Call(psSolid, 1, rgb(25, 25, 25))
	gSelectObj.Call(mem, crossPen)
	gMoveToEx.Call(mem, uintptr(cx), uintptr(cy-rad), 0)
	gLineTo.Call(mem, uintptr(cx), uintptr(cy+rad))
	gMoveToEx.Call(mem, uintptr(cx-rad), uintptr(cy), 0)
	gLineTo.Call(mem, uintptr(cx+rad), uintptr(cy))
	gDeleteObj.Call(crossPen)

	// Radar data
	data := o.pm.BuildRadarData()
	if data != nil && len(data.Cars) > data.PlayerIndex {
		p := data.Cars[data.PlayerIndex]
		scale := float64(rad) / o.rangeM

		// F1 car real dimensions: ~5.5m long x 2.0m wide
		carLen := math.Max(5.5*scale, 6)
		carWid := math.Max(2.0*scale, 2.2)

		for i, c := range data.Cars {
			if i == data.PlayerIndex {
				continue
			}
			dx := float64(c.X - p.X)
			dz := float64(c.Z - p.Z)
			sin, cos := math.Sincos(float64(p.Yaw))
			rx := dx*cos - dz*sin
			rz := dx*sin + dz*cos
			if rx*rx+rz*rz > o.rangeM*o.rangeM {
				continue
			}

			sx := float64(cx) - rx*scale
			sy := float64(cy) - rz*scale
			col := ovTeamColor(c.TeamID)

			// Rotated rectangle aligned with car heading (X negated for screen)
			relYaw := float64(c.Yaw - p.Yaw)
			sinY, cosY := math.Sincos(relYaw)
			fwdX, fwdY := -sinY, -cosY
			sideX, sideY := -cosY, sinY
			hl, hw := carLen/2, carWid/2

			pts := [4]w32Point{
				{int32(sx + fwdX*hl - sideX*hw), int32(sy + fwdY*hl - sideY*hw)},
				{int32(sx + fwdX*hl + sideX*hw), int32(sy + fwdY*hl + sideY*hw)},
				{int32(sx - fwdX*hl + sideX*hw), int32(sy - fwdY*hl + sideY*hw)},
				{int32(sx - fwdX*hl - sideX*hw), int32(sy - fwdY*hl - sideY*hw)},
			}

			br, _, _ := gSolidBrush.Call(col)
			pn, _, _ := gCreatePen.Call(psSolid, 1, col)
			gSelectObj.Call(mem, br)
			gSelectObj.Call(mem, pn)
			gPolygon.Call(mem, uintptr(unsafe.Pointer(&pts[0])), 4)

			// Front edge highlight
			frontPen, _, _ := gCreatePen.Call(psSolid, 1, rgb(200, 200, 200))
			gSelectObj.Call(mem, frontPen)
			gMoveToEx.Call(mem, uintptr(pts[0].X), uintptr(pts[0].Y), 0)
			gLineTo.Call(mem, uintptr(pts[1].X), uintptr(pts[1].Y))

			gDeleteObj.Call(br)
			gDeleteObj.Call(pn)
			gDeleteObj.Call(frontPen)
		}

		// Player car (center, facing up) — same F1 proportions
		pHL := int(carLen / 2)
		pHW := int(carWid / 2)
		playerPts := [4]w32Point{
			{int32(cx - pHW), int32(cy - pHL)},
			{int32(cx + pHW), int32(cy - pHL)},
			{int32(cx + pHW), int32(cy + pHL)},
			{int32(cx - pHW), int32(cy + pHL)},
		}
		pb, _, _ := gSolidBrush.Call(rgb(0, 210, 255))
		pp, _, _ := gCreatePen.Call(psSolid, 1, rgb(0, 210, 255))
		gSelectObj.Call(mem, pb)
		gSelectObj.Call(mem, pp)
		gPolygon.Call(mem, uintptr(unsafe.Pointer(&playerPts[0])), 4)
		pFrontPen, _, _ := gCreatePen.Call(psSolid, 1, rgb(200, 200, 200))
		gSelectObj.Call(mem, pFrontPen)
		gMoveToEx.Call(mem, uintptr(playerPts[0].X), uintptr(playerPts[0].Y), 0)
		gLineTo.Call(mem, uintptr(playerPts[1].X), uintptr(playerPts[1].Y))
		gDeleteObj.Call(pb)
		gDeleteObj.Call(pp)
		gDeleteObj.Call(pFrontPen)
	}

	// Labels
	gSetBkMode.Call(mem, bkTransp)
	gSetTextColor.Call(mem, rgb(60, 60, 60))
	fontName := utf16Ptr("Segoe UI")
	font, _, _ := gCreateFont.Call(11, 0, 0, 0, 600, 0, 0, 0, 1, 0, 0, 0, 0,
		uintptr(unsafe.Pointer(fontName)))
	oldFont, _, _ := gSelectObj.Call(mem, font)

	fwd := utf16Str("FWD")
	fwdRc := w32Rect{0, int32(cy-rad) + 3, int32(sz), int32(cy-rad) + 15}
	gDrawText.Call(mem, uintptr(unsafe.Pointer(&fwd[0])), uintptr(len(fwd)-1),
		uintptr(unsafe.Pointer(&fwdRc)), dtCenter|dtVCenter|dtSingle)

	rm := utf16Str(fmt.Sprintf("%dm", int(o.rangeM)))
	rmRc := w32Rect{0, int32(cy+rad) - 15, int32(sz), int32(cy+rad) - 2}
	gDrawText.Call(mem, uintptr(unsafe.Pointer(&rm[0])), uintptr(len(rm)-1),
		uintptr(unsafe.Pointer(&rmRc)), dtCenter|dtVCenter|dtSingle)

	gSelectObj.Call(mem, oldFont)
	gDeleteObj.Call(font)

	// Blit
	gBitBlt.Call(hdc, 0, 0, uintptr(sz), uintptr(sz), mem, 0, 0, srcCopy)
	gSelectObj.Call(mem, oldBmp)
	gDeleteObj.Call(bmp)
	gDeleteDC.Call(mem)

	uEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
}
