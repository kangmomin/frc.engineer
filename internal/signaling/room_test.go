package signaling

import (
	"io"
	"log/slog"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestRoomManagerListAndPasswordJoin(t *testing.T) {
	store, err := LoadPermissionCodeStore(filepath.Join(t.TempDir(), "permission-codes.json"), testLogger())
	if err != nil {
		t.Fatalf("LoadPermissionCodeStore failed: %v", err)
	}
	rm := NewRoomManager(testLogger(), store)
	defer rm.Stop()

	roomID, roomCode, err := rm.CreateRoom(nil, &sync.Mutex{}, "", "Alpha Room", "secret")
	if err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}
	if roomID == "" || roomCode == "" {
		t.Fatalf("expected room id/code, got %q %q", roomID, roomCode)
	}

	rooms := rm.ListRooms()
	if len(rooms) != 1 {
		t.Fatalf("expected 1 listed room, got %d", len(rooms))
	}
	if rooms[0].RoomID != roomID || rooms[0].RoomCode != roomCode || rooms[0].RoomName != "Alpha Room" {
		t.Fatalf("unexpected room summary: %#v", rooms[0])
	}
	if !rooms[0].RequiresPassword {
		t.Fatal("expected room to require password")
	}

	if _, _, _, err := rm.JoinRoom(roomID, "", "wrong", "", nil, &sync.Mutex{}); err == nil {
		t.Fatal("expected invalid password error")
	}

	peerID, joinedCode, permissions, err := rm.JoinRoom(roomID, "", "secret", "", nil, &sync.Mutex{})
	if err != nil {
		t.Fatalf("JoinRoom failed: %v", err)
	}
	if peerID == "" || joinedCode != roomCode {
		t.Fatalf("unexpected join result: peer=%q code=%q", peerID, joinedCode)
	}
	if permissions.ViewERSActual || permissions.ViewAdvancedStrategy || permissions.ViewPitStatus || permissions.ViewTopSpeed || permissions.ViewPlayerDelta || permissions.ViewCommentary || permissions.ViewQualifying {
		t.Fatalf("expected empty permissions, got %#v", permissions)
	}
}

func TestRoomManagerRejoinAndUpdateMetadata(t *testing.T) {
	store, err := LoadPermissionCodeStore(filepath.Join(t.TempDir(), "permission-codes.json"), testLogger())
	if err != nil {
		t.Fatalf("LoadPermissionCodeStore failed: %v", err)
	}
	rm := NewRoomManager(testLogger(), store)
	defer rm.Stop()

	roomID, roomCode, err := rm.CreateRoom(nil, &sync.Mutex{}, "", "First Room", "one")
	if err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}

	rejoinedCode, err := rm.RejoinRoom(roomID, nil, &sync.Mutex{}, "Renamed Room", "two")
	if err != nil {
		t.Fatalf("RejoinRoom failed: %v", err)
	}
	if rejoinedCode != roomCode {
		t.Fatalf("expected room code to remain %q, got %q", roomCode, rejoinedCode)
	}

	if _, err := rm.UpdateRoomMetadata(roomID, "Final Room", "three"); err != nil {
		t.Fatalf("UpdateRoomMetadata failed: %v", err)
	}

	rooms := rm.ListRooms()
	if len(rooms) != 1 || rooms[0].RoomName != "Final Room" {
		t.Fatalf("unexpected room list after metadata update: %#v", rooms)
	}

	if _, _, _, err := rm.JoinRoom(roomID, "", "two", "", nil, &sync.Mutex{}); err == nil {
		t.Fatal("expected stale password to fail")
	}
	if _, _, _, err := rm.JoinRoom("", roomCode, "three", "", nil, &sync.Mutex{}); err != nil {
		t.Fatalf("expected join by room code fallback to work: %v", err)
	}
}

func TestListRoomsHidesOfflineRooms(t *testing.T) {
	store, err := LoadPermissionCodeStore(filepath.Join(t.TempDir(), "permission-codes.json"), testLogger())
	if err != nil {
		t.Fatalf("LoadPermissionCodeStore failed: %v", err)
	}
	rm := NewRoomManager(testLogger(), store)
	defer rm.Stop()

	roomID, _, err := rm.CreateRoom(nil, &sync.Mutex{}, "", "Offline Room", "")
	if err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}

	rm.mu.RLock()
	room := rm.roomsByID[roomID]
	rm.mu.RUnlock()
	now := time.Now()
	room.mu.Lock()
	room.DriverLostAt = &now
	room.mu.Unlock()

	if rooms := rm.ListRooms(); len(rooms) != 0 {
		t.Fatalf("expected offline room to be hidden, got %#v", rooms)
	}
}

func TestRoomManagerJoinWithPermissionCode(t *testing.T) {
	store, err := LoadPermissionCodeStore(filepath.Join(t.TempDir(), "permission-codes.json"), testLogger())
	if err != nil {
		t.Fatalf("LoadPermissionCodeStore failed: %v", err)
	}
	if _, err := store.Upsert("TEAM42", "Full access", Permissions{
		ViewERSActual:        true,
		ViewAdvancedStrategy: true,
		ViewPitStatus:        true,
		ViewTopSpeed:         true,
		ViewPlayerDelta:      true,
		ViewCommentary:       true,
		ViewQualifying:       true,
	}); err != nil {
		t.Fatalf("Upsert failed: %v", err)
	}

	rm := NewRoomManager(testLogger(), store)
	defer rm.Stop()

	roomID, _, err := rm.CreateRoom(nil, &sync.Mutex{}, "", "Alpha Room", "")
	if err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}

	_, _, permissions, err := rm.JoinRoom(roomID, "", "", "team42", nil, &sync.Mutex{})
	if err != nil {
		t.Fatalf("JoinRoom failed: %v", err)
	}
	if !permissions.ViewERSActual || !permissions.ViewAdvancedStrategy || !permissions.ViewPitStatus || !permissions.ViewTopSpeed || !permissions.ViewPlayerDelta || !permissions.ViewCommentary || !permissions.ViewQualifying {
		t.Fatalf("expected full permissions, got %#v", permissions)
	}

	if _, _, _, err := rm.JoinRoom(roomID, "", "", "invalid", nil, &sync.Mutex{}); err == nil {
		t.Fatal("expected invalid permissions code to fail")
	}
}
