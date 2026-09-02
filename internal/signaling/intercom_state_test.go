package signaling

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestIntercomSignalingAdvertisesFeatureAndPreservesCommandOrder(t *testing.T) {
	rm := newIntercomTestRoomManager(t)
	rm.SetRealtimeSFUProvider(&fakeRealtimeSFU{})
	serverConn, clientConn := openSignalingPair(t)
	defer serverConn.Close()
	defer clientConn.Close()
	writeMu := &sync.Mutex{}

	createRoom, _ := json.Marshal(Message{Type: TypeRoomCreate, RoomName: "Driver"})
	p := rm.HandleMessage(serverConn, createRoom, nil, writeMu, "127.0.0.1")
	if p == nil {
		t.Fatal("room peer was not established")
	}
	clientConn.SetReadDeadline(time.Now().Add(time.Second))
	var roomCreated Message
	if err := clientConn.ReadJSON(&roomCreated); err != nil {
		t.Fatal(err)
	}
	if roomCreated.Features == nil || roomCreated.Features.IntercomVersion != IntercomProtocolVersion {
		t.Fatalf("room features = %+v", roomCreated.Features)
	}

	groupPayload, _ := json.Marshal(IntercomGroupCreatePayload{DisplayName: "Driver", Password: "pw"})
	sessionPayload, _ := json.Marshal(IntercomSFUSessionNewPayload{})
	groupMessage, _ := json.Marshal(Message{Type: TypeIntercomGroupCreate, RequestID: "create-group", Payload: groupPayload})
	sessionMessage, _ := json.Marshal(Message{Type: TypeIntercomSFUSessionNew, RequestID: "create-session", Payload: sessionPayload})
	rm.HandleMessage(serverConn, groupMessage, p, writeMu, "127.0.0.1")
	rm.HandleMessage(serverConn, sessionMessage, p, writeMu, "127.0.0.1")
	for _, wantType := range []string{TypeIntercomJoined, TypeIntercomSFUSession} {
		var response Message
		if err := clientConn.ReadJSON(&response); err != nil {
			t.Fatal(err)
		}
		if response.Type != wantType {
			t.Fatalf("response type = %q, want %q", response.Type, wantType)
		}
	}
	rm.RemovePeer(p)
}

func TestIntercomUnjoinedProviderRPCGetsBoundNotJoined(t *testing.T) {
	rm := newIntercomTestRoomManager(t)
	serverConn, clientConn := openSignalingPair(t)
	defer serverConn.Close()
	defer clientConn.Close()
	writeMu := &sync.Mutex{}

	createRoom, _ := json.Marshal(Message{Type: TypeRoomCreate, RoomName: "Driver"})
	p := rm.HandleMessage(serverConn, createRoom, nil, writeMu, "127.0.0.1")
	if p == nil {
		t.Fatal("room peer was not established")
	}
	clientConn.SetReadDeadline(time.Now().Add(time.Second))
	var roomCreated Message
	if err := clientConn.ReadJSON(&roomCreated); err != nil {
		t.Fatal(err)
	}

	payload, _ := json.Marshal(IntercomSFUSessionNewPayload{})
	request, _ := json.Marshal(Message{Type: TypeIntercomSFUSessionNew, RequestID: "unjoined-session", Payload: payload})
	rm.HandleMessage(serverConn, request, p, writeMu, "127.0.0.1")
	var response Message
	if err := clientConn.ReadJSON(&response); err != nil {
		t.Fatal(err)
	}
	if response.Type != TypeIntercomError || response.RequestID != "unjoined-session" {
		t.Fatalf("response = %+v", response)
	}
	var rpcError IntercomErrorPayload
	if !decodeIntercomPayload(response.Payload, &rpcError) || rpcError.Code != "not_joined" {
		t.Fatalf("error payload = %+v", rpcError)
	}
	rm.RemovePeer(p)
}

func TestIntercomInitialAuthorityPrecedesConcurrentState(t *testing.T) {
	t.Run("create", func(t *testing.T) {
		rm := newIntercomTestRoomManager(t)
		serverConn, clientConn := openSignalingPair(t)
		defer serverConn.Close()
		defer clientConn.Close()
		p := addIntercomTestRoom(rm, "room-a", "epoch-a", roleDriver)
		p.conn = serverConn
		assertInitialJoinedBeforeConcurrentState(t, rm.intercom, p, clientConn,
			func() {
				rm.intercom.createGroup(rm, p, "create-order", "127.0.0.1", IntercomGroupCreatePayload{DisplayName: "Driver", Password: "pw"})
			},
			func() { rm.intercom.activity(p, IntercomActivityPayload{Speaking: true}) },
		)
	})

	t.Run("join", func(t *testing.T) {
		rm := newIntercomTestRoomManager(t)
		driver, code := createIntercomOrderingGroup(t, rm)
		serverConn, clientConn := openSignalingPair(t)
		defer serverConn.Close()
		defer clientConn.Close()
		p := addIntercomTestRoom(rm, "room-a", "epoch-a", roleEngineer)
		p.conn = serverConn
		payload := IntercomJoinPayload{GroupCode: code, Password: "pw", Role: IntercomRoleEngineer, DisplayName: "Engineer"}
		assertInitialJoinedBeforeConcurrentState(t, rm.intercom, p, clientConn,
			func() { rm.intercom.joinGroup(rm, p, "join-order", "127.0.0.2", payload) },
			func() { rm.intercom.activity(driver, IntercomActivityPayload{Speaking: true}) },
		)
	})

	t.Run("resume", func(t *testing.T) {
		rm := newIntercomTestRoomManager(t)
		driver, code := createIntercomOrderingGroup(t, rm)
		oldPeer := addIntercomTestRoom(rm, "room-a", "epoch-a", roleEngineer)
		payload := IntercomJoinPayload{GroupCode: code, Password: "pw", Role: IntercomRoleEngineer, DisplayName: "Engineer"}
		rm.intercom.joinGroup(rm, oldPeer, "initial-join", "127.0.0.2", payload)
		rm.intercom.mu.Lock()
		resumeToken := rm.intercom.byPeer[oldPeer].resumeToken
		rm.intercom.mu.Unlock()
		rm.intercom.detachPeer(oldPeer)

		serverConn, clientConn := openSignalingPair(t)
		defer serverConn.Close()
		defer clientConn.Close()
		p := addIntercomTestRoom(rm, "room-a", "epoch-a", roleEngineer)
		p.conn = serverConn
		payload.ResumeToken = resumeToken
		assertInitialJoinedBeforeConcurrentState(t, rm.intercom, p, clientConn,
			func() { rm.intercom.joinGroup(rm, p, "resume-order", "127.0.0.2", payload) },
			func() { rm.intercom.activity(driver, IntercomActivityPayload{Speaking: true}) },
		)
	})
}

func createIntercomOrderingGroup(t *testing.T, rm *RoomManager) (*peer, string) {
	t.Helper()
	driver := addIntercomTestRoom(rm, "room-a", "epoch-a", roleDriver)
	rm.intercom.createGroup(rm, driver, "setup-group", "127.0.0.1", IntercomGroupCreatePayload{DisplayName: "Driver", Password: "pw"})
	rm.intercom.mu.Lock()
	defer rm.intercom.mu.Unlock()
	for code := range rm.intercom.groups {
		return driver, code
	}
	t.Fatal("intercom group was not created")
	return nil, ""
}

func assertInitialJoinedBeforeConcurrentState(t *testing.T, manager *intercomManager, p *peer, clientConn *websocket.Conn, start, mutate func()) {
	t.Helper()
	p.writeMu.Lock()
	locked := true
	defer func() {
		if locked {
			p.writeMu.Unlock()
		}
	}()
	done := make(chan struct{})
	go func() {
		start()
		close(done)
	}()
	waitUntil(t, time.Second, func() bool {
		manager.mu.Lock()
		defer manager.mu.Unlock()
		return manager.byPeer[p] != nil
	})
	mutate()
	p.writeMu.Unlock()
	locked = false

	clientConn.SetReadDeadline(time.Now().Add(time.Second))
	var joined, state Message
	if err := clientConn.ReadJSON(&joined); err != nil || joined.Type != TypeIntercomJoined {
		t.Fatalf("first message = %+v, %v", joined, err)
	}
	if err := clientConn.ReadJSON(&state); err != nil || state.Type != TypeIntercomState {
		t.Fatalf("second message = %+v, %v", state, err)
	}
	var joinedPayload IntercomJoinedPayload
	var statePayload IntercomSnapshot
	if !decodeIntercomPayload(joined.Payload, &joinedPayload) || !decodeIntercomPayload(state.Payload, &statePayload) || statePayload.Revision <= joinedPayload.Snapshot.Revision {
		t.Fatalf("joined revision=%d state revision=%d", joinedPayload.Snapshot.Revision, statePayload.Revision)
	}
	<-done
}

func TestIntercomRebindTransfersBeforeStaleDetachAndReplaysAfterRoomFeature(t *testing.T) {
	rm := newIntercomTestRoomManager(t)
	oldServer, oldClient := openSignalingPair(t)
	defer oldServer.Close()
	defer oldClient.Close()
	oldWriteMu := &sync.Mutex{}
	createRoom, _ := json.Marshal(Message{Type: TypeRoomCreate, RoomName: "Driver"})
	oldPeer := rm.HandleMessage(oldServer, createRoom, nil, oldWriteMu, "127.0.0.1")
	var created Message
	if err := oldClient.ReadJSON(&created); err != nil {
		t.Fatal(err)
	}
	groupPayload, _ := json.Marshal(IntercomGroupCreatePayload{DisplayName: "Driver", Password: "pw"})
	groupMessage, _ := json.Marshal(Message{Type: TypeIntercomGroupCreate, RequestID: "group-create", Payload: groupPayload})
	rm.HandleMessage(oldServer, groupMessage, oldPeer, oldWriteMu, "127.0.0.1")
	var joined Message
	if err := oldClient.ReadJSON(&joined); err != nil || joined.Type != TypeIntercomJoined {
		t.Fatalf("initial join = %+v, %v", joined, err)
	}

	newServer, newClient := openSignalingPair(t)
	defer newServer.Close()
	defer newClient.Close()
	rejoinRaw, _ := json.Marshal(Message{Type: TypeRoomRejoin, RoomID: created.RoomID, OwnerToken: created.OwnerToken, RoomName: "Driver"})
	newPeer := rm.HandleMessage(newServer, rejoinRaw, nil, &sync.Mutex{}, "127.0.0.1")
	rm.RemovePeer(oldPeer)
	newClient.SetReadDeadline(time.Now().Add(time.Second))
	for _, want := range []string{TypeRoomCreated, TypeIntercomJoined} {
		var message Message
		if err := newClient.ReadJSON(&message); err != nil || message.Type != want {
			t.Fatalf("rebind replay = %+v, %v; want %s", message, err, want)
		}
		if want == TypeRoomCreated && (message.Features == nil || message.Features.IntercomVersion != IntercomProtocolVersion) {
			t.Fatalf("rebind feature advertisement = %+v", message.Features)
		}
	}
	rm.intercom.mu.Lock()
	member := rm.intercom.byPeer[newPeer]
	_, staleStillBound := rm.intercom.byPeer[oldPeer]
	rm.intercom.mu.Unlock()
	if member == nil || staleStillBound {
		t.Fatalf("atomic transfer member=%+v staleBound=%t", member, staleStillBound)
	}
}

func TestIntercomRebindGatesConcurrentStateUntilFeatureAdvertisement(t *testing.T) {
	manager, group, driver, engineer, _ := newIntercomPrivateTestGroup(t)
	serverConn, clientConn := openSignalingPair(t)
	defer serverConn.Close()
	defer clientConn.Close()
	replacement := &peer{conn: serverConn, role: roleEngineer, writeMu: &sync.Mutex{}}
	originalGeneration := engineer.generation

	manager.transferPeer(engineer.peer, replacement)
	manager.activity(driver.peer, IntercomActivityPayload{Speaking: true, BusEnabled: true})
	manager.mu.Lock()
	gatedDelivery := engineer.delivery
	wantRevision := group.revision
	manager.mu.Unlock()
	if message, ok := gatedDelivery.pop(); ok {
		t.Fatalf("intercom state escaped before room feature advertisement: %+v", message)
	}

	if err := replacement.sendJSON(Message{Type: TypeRoomJoined, Features: &Features{IntercomVersion: IntercomProtocolVersion}}); err != nil {
		t.Fatal(err)
	}
	manager.advertisePeer(replacement)
	clientConn.SetReadDeadline(time.Now().Add(time.Second))
	for index, wantType := range []string{TypeRoomJoined, TypeIntercomJoined, TypeIntercomState} {
		var message Message
		if err := clientConn.ReadJSON(&message); err != nil || message.Type != wantType {
			t.Fatalf("message %d = %+v, %v; want %s", index, message, err, wantType)
		}
		switch wantType {
		case TypeIntercomJoined:
			var payload IntercomJoinedPayload
			if !decodeIntercomPayload(message.Payload, &payload) || payload.MembershipGeneration != originalGeneration+1 || payload.Snapshot.Revision != wantRevision {
				t.Fatalf("joined replay = %+v", payload)
			}
		case TypeIntercomState:
			var snapshot IntercomSnapshot
			if !decodeIntercomPayload(message.Payload, &snapshot) || snapshot.Revision != wantRevision {
				t.Fatalf("latest state replay = %+v", snapshot)
			}
		}
	}
}

func TestIntercomStaleDeliveryFailureCannotCloseReboundPeer(t *testing.T) {
	manager, _, _, engineer, _ := newIntercomPrivateTestGroup(t)
	serverConn, clientConn := openSignalingPair(t)
	defer serverConn.Close()
	defer clientConn.Close()
	replacement := &peer{conn: serverConn, role: roleEngineer, writeMu: &sync.Mutex{}}
	manager.transferPeer(engineer.peer, replacement)
	manager.mu.Lock()
	staleDelivery := engineer.delivery
	manager.resetMemberDeliveryReadyLocked(engineer, false)
	manager.mu.Unlock()

	manager.closeMemberOnDeliveryFailure(engineer, staleDelivery)
	if err := replacement.sendJSON(Message{Type: TypeHeartbeat}); err != nil {
		t.Fatalf("stale delivery failure closed rebound peer: %v", err)
	}
	clientConn.SetReadDeadline(time.Now().Add(time.Second))
	var message Message
	if err := clientConn.ReadJSON(&message); err != nil || message.Type != TypeHeartbeat {
		t.Fatalf("rebound peer message = %+v, %v", message, err)
	}
}

func TestIntercomLeaveRPCIsIdempotentForConnectionLifetime(t *testing.T) {
	rm := newIntercomTestRoomManager(t)
	serverConn, clientConn := openSignalingPair(t)
	defer serverConn.Close()
	defer clientConn.Close()
	p := addIntercomTestRoom(rm, "room-a", "epoch-a", roleDriver)
	p.conn = serverConn
	rm.intercom.createGroup(rm, p, "create-1", "127.0.0.1", IntercomGroupCreatePayload{DisplayName: "Driver", Password: "pw"})
	var initial Message
	if err := clientConn.ReadJSON(&initial); err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(IntercomLeavePayload{})
	leave := Message{Type: TypeIntercomLeave, RequestID: "leave-1", Payload: payload}
	rm.intercom.handle(rm, p, leave, "127.0.0.1")
	rm.intercom.handle(rm, p, leave, "127.0.0.1")
	for range 2 {
		var response Message
		if err := clientConn.ReadJSON(&response); err != nil || response.Type != TypeIntercomLeft || response.RequestID != leave.RequestID {
			t.Fatalf("leave replay = %+v, %v", response, err)
		}
	}
}

func TestIntercomGroupUsesServerDerivedRoomEpochIdentity(t *testing.T) {
	rm := newIntercomTestRoomManager(t)
	driver := addIntercomTestRoom(rm, "room-a", "epoch-a", roleDriver)
	rm.intercom.createGroup(rm, driver, "create-1", "127.0.0.1", IntercomGroupCreatePayload{DisplayName: "Driver A", Password: "team-secret"})

	rm.intercom.mu.Lock()
	if len(rm.intercom.groups) != 1 {
		rm.intercom.mu.Unlock()
		t.Fatalf("group count = %d", len(rm.intercom.groups))
	}
	var group *intercomGroup
	for _, candidate := range rm.intercom.groups {
		group = candidate
	}
	driverMember := rm.intercom.byPeer[driver]
	if driverMember == nil || driverMember.driverKey != "epoch-a:room-a" || driverMember.role != IntercomRoleDriver {
		rm.intercom.mu.Unlock()
		t.Fatalf("driver member = %+v", driverMember)
	}
	code := group.code
	rm.intercom.mu.Unlock()

	engineer := addIntercomTestRoom(rm, "room-a", "epoch-a", roleEngineer)
	rm.intercom.joinGroup(rm, engineer, "join-1", "127.0.0.2", IntercomJoinPayload{
		GroupCode: code, Password: "team-secret", Role: IntercomRoleEngineer, DisplayName: "Engineer A",
	})
	rm.intercom.mu.Lock()
	engineerMember := rm.intercom.byPeer[engineer]
	if engineerMember == nil || engineerMember.assignmentDriverKey != "epoch-a:room-a" || engineerMember.driverKey != "" {
		rm.intercom.mu.Unlock()
		t.Fatalf("engineer member = %+v", engineerMember)
	}
	if string(group.passwordHash[:]) == "team-secret" || group.chiefCode == "" {
		rm.intercom.mu.Unlock()
		t.Fatal("group credentials were not safely represented")
	}
	rm.intercom.mu.Unlock()
}

func TestIntercomResumeRequiresOfflineMatchingRoomEpochAndRole(t *testing.T) {
	rm := newIntercomTestRoomManager(t)
	driver := addIntercomTestRoom(rm, "room-a", "epoch-a", roleDriver)
	rm.intercom.createGroup(rm, driver, "create-1", "127.0.0.1", IntercomGroupCreatePayload{DisplayName: "Driver A", Password: "pw"})
	rm.intercom.mu.Lock()
	member := rm.intercom.byPeer[driver]
	groupCode, resumeToken, participantID := member.group.code, member.resumeToken, member.id
	rm.intercom.mu.Unlock()
	rm.intercom.detachPeer(driver)

	replacement := &peer{role: roleDriver, roomID: driver.roomID, roomCode: driver.roomCode, writeMu: &sync.Mutex{}}
	rm.mu.RLock()
	room := rm.roomsByID[driver.roomID]
	rm.mu.RUnlock()
	room.mu.Lock()
	room.Driver = replacement
	room.DriverLostAt = nil
	room.mu.Unlock()
	rm.intercom.joinGroup(rm, replacement, "join-2", "127.0.0.1", IntercomJoinPayload{
		GroupCode: groupCode, Password: "pw", ResumeToken: resumeToken, Role: IntercomRoleDriver, DisplayName: "Driver A",
	})

	rm.intercom.mu.Lock()
	resumed := rm.intercom.byPeer[replacement]
	if resumed == nil || resumed.id != participantID || resumed.generation != 2 || !resumed.online {
		rm.intercom.mu.Unlock()
		t.Fatalf("resumed = %+v", resumed)
	}
	resumeResponse := resumed.responseCache["join-2"]
	rm.intercom.mu.Unlock()
	var joined IntercomJoinedPayload
	if err := json.Unmarshal(resumeResponse.Payload, &joined); err != nil || joined.ChiefCode == "" {
		t.Fatalf("creator resume payload = %+v, %v", joined, err)
	}
}

func TestIntercomPrivateModeWaitsForRequiredGenerationReady(t *testing.T) {
	manager, group, driver, engineer, chief := newIntercomPrivateTestGroup(t)
	manager.setPrivate(chief.peer, "private-1", IntercomPrivateSetPayload{DriverKey: driver.driverKey, Active: true})

	manager.mu.Lock()
	if group.private == nil || group.private.phase != IntercomPrivatePreparing || !manager.forcedMutedLocked(engineer) {
		manager.mu.Unlock()
		t.Fatalf("preparing private = %+v forced=%t", group.private, manager.forcedMutedLocked(engineer))
	}
	revision := group.private.revision
	manager.mu.Unlock()

	manager.privateReady(chief.peer, IntercomPrivateReadyPayload{Revision: revision})
	manager.privateReady(driver.peer, IntercomPrivateReadyPayload{Revision: revision})
	manager.mu.Lock()
	if group.private.phase != IntercomPrivatePreparing {
		manager.mu.Unlock()
		t.Fatal("private became active before assigned engineer was ready")
	}
	manager.mu.Unlock()
	manager.privateReady(engineer.peer, IntercomPrivateReadyPayload{Revision: revision})
	manager.mu.Lock()
	if group.private == nil || group.private.phase != IntercomPrivateActive {
		manager.mu.Unlock()
		t.Fatalf("private phase = %+v", group.private)
	}
	manager.mu.Unlock()

	manager.detachPeer(chief.peer)
	manager.mu.Lock()
	if group.private != nil || manager.forcedMutedLocked(engineer) {
		manager.mu.Unlock()
		t.Fatal("chief disconnect did not end private mode")
	}
	manager.mu.Unlock()
}

func TestIntercomPrivateReadyAcceptsLaterSnapshotAndGenerationChangeAborts(t *testing.T) {
	manager, group, driver, engineer, chief := newIntercomPrivateTestGroup(t)
	manager.setPrivate(chief.peer, "private-1", IntercomPrivateSetPayload{DriverKey: driver.driverKey, Active: true})
	manager.activity(driver.peer, IntercomActivityPayload{Speaking: true, BusEnabled: true})
	manager.mu.Lock()
	preparedAt := group.private.revision
	latestRevision := group.revision
	manager.mu.Unlock()
	if latestRevision <= preparedAt {
		t.Fatalf("activity did not advance ordinary state revision: prepared=%d latest=%d", preparedAt, latestRevision)
	}
	for _, member := range []*intercomMember{chief, driver, engineer} {
		manager.privateReady(member.peer, IntercomPrivateReadyPayload{Revision: latestRevision})
	}
	manager.mu.Lock()
	active := group.private != nil && group.private.phase == IntercomPrivateActive
	manager.mu.Unlock()
	if !active {
		t.Fatal("valid ACKs from a later preparation snapshot did not activate private mode")
	}

	manager.setPrivate(chief.peer, "private-2", IntercomPrivateSetPayload{DriverKey: driver.driverKey, Active: true})
	replacement := &peer{role: roleEngineer, writeMu: &sync.Mutex{}}
	manager.transferPeer(engineer.peer, replacement)
	manager.mu.Lock()
	private := group.private
	manager.mu.Unlock()
	if private != nil {
		t.Fatal("required membership generation change did not abort private preparation")
	}
}

func TestIntercomTalkingTargetsAndActivityLease(t *testing.T) {
	manager, group, driver, engineer, chief := newIntercomPrivateTestGroup(t)
	manager.activity(engineer.peer, IntercomActivityPayload{Speaking: true, PTT: true, BusEnabled: true})
	manager.mu.Lock()
	targets := manager.talkingToLocked(engineer)
	leaseID := engineer.activityLeaseID
	generation := engineer.generation
	manager.mu.Unlock()
	wantTargets := map[string]bool{driver.id: true, chief.id: true}
	if len(targets) != 2 || !wantTargets[targets[0]] || !wantTargets[targets[1]] {
		t.Fatalf("talking targets = %v", targets)
	}
	manager.expireActivity(engineer.id, generation, leaseID)
	manager.mu.Lock()
	if engineer.speaking || engineer.ptt || len(manager.talkingToLocked(engineer)) != 0 || group.revision < 2 {
		manager.mu.Unlock()
		t.Fatalf("expired activity = speaking:%t ptt:%t", engineer.speaking, engineer.ptt)
	}
	manager.mu.Unlock()
}

func TestIntercomStateDeliveryCoalescesWhenRecipientIsSlow(t *testing.T) {
	manager := newIntercomManager(slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(manager.stop)
	group := &intercomGroup{code: "123456", revision: 1, topologyRevision: 1, members: make(map[string]*intercomMember)}
	member := &intercomMember{id: "slow", group: group, online: true, delivery: newIntercomDeliveryQueue()}
	group.members[member.id] = member
	first := IntercomSnapshot{Revision: 1, GroupCode: group.code, Participants: []IntercomParticipant{}}
	latest := IntercomSnapshot{Revision: 3, GroupCode: group.code, Participants: []IntercomParticipant{}}
	manager.queueSnapshot([]*intercomMember{member}, first)
	manager.queueSnapshot([]*intercomMember{member}, IntercomSnapshot{Revision: 2, GroupCode: group.code, Participants: []IntercomParticipant{}})
	manager.queueSnapshot([]*intercomMember{member}, latest)
	message, ok := member.delivery.pop()
	if !ok {
		t.Fatal("coalesced snapshot was not queued")
	}
	var snapshot IntercomSnapshot
	if !decodeIntercomPayload(message.Payload, &snapshot) || snapshot.Revision != latest.Revision {
		t.Fatalf("coalesced snapshot = %+v", snapshot)
	}
}

func TestIntercomStateCoalescingPreservesReliableDeliveryOrder(t *testing.T) {
	queue := newIntercomDeliveryQueue()
	state := func(revision uint64) Message {
		return intercomMessage(TypeIntercomState, "", IntercomSnapshot{Revision: revision, GroupCode: "123456", Participants: []IntercomParticipant{}})
	}
	if !queue.enqueue(state(1)) || !queue.enqueue(intercomMessage(TypeIntercomSFUSession, "rpc-1", IntercomSFUSessionPayload{SessionHandle: "handle"})) || !queue.enqueue(state(3)) || !queue.enqueue(state(2)) {
		t.Fatal("delivery queue rejected valid messages")
	}
	first, ok := queue.pop()
	if !ok || first.RequestID != "rpc-1" {
		t.Fatalf("first delivery = %+v; reliable response was reordered", first)
	}
	second, ok := queue.pop()
	if !ok {
		t.Fatal("latest state was not queued")
	}
	var snapshot IntercomSnapshot
	if !decodeIntercomPayload(second.Payload, &snapshot) || snapshot.Revision != 3 {
		t.Fatalf("coalesced state = %+v", snapshot)
	}
}

func TestIntercomStateDeliveryRejectsRevisionOlderThanAlreadyPoppedState(t *testing.T) {
	queue := newIntercomDeliveryQueue()
	state := func(revision uint64) Message {
		return intercomMessage(TypeIntercomState, "", IntercomSnapshot{Revision: revision, GroupCode: "123456", Participants: []IntercomParticipant{}})
	}
	if !queue.enqueue(state(3)) {
		t.Fatal("new state was not accepted")
	}
	message, ok := queue.pop()
	if !ok {
		t.Fatal("new state was not popped")
	}
	var snapshot IntercomSnapshot
	if !decodeIntercomPayload(message.Payload, &snapshot) || snapshot.Revision != 3 {
		t.Fatalf("popped state = %+v", snapshot)
	}
	if !queue.enqueue(state(2)) {
		t.Fatal("stale state should be treated as already delivered")
	}
	if message, ok := queue.pop(); ok {
		t.Fatalf("stale state was queued after newer delivery: %+v", message)
	}
}

func TestIntercomAuthenticationThrottleSurvivesReconnectAndRotatingIP(t *testing.T) {
	manager := newIntercomManager(slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(manager.stop)
	manager.mu.Lock()
	for index := 0; index < 6; index++ {
		if !manager.allowAttemptLocked("stable-participant", fmt.Sprintf("192.0.2.%d", index+1), true) {
			manager.mu.Unlock()
			t.Fatalf("participant attempt %d was prematurely limited", index+1)
		}
	}
	if manager.allowAttemptLocked("stable-participant", "192.0.2.99", true) {
		manager.mu.Unlock()
		t.Fatal("rotating IP reset the authenticated participant throttle")
	}
	for index := 0; index < 6; index++ {
		if !manager.allowAttemptLocked(fmt.Sprintf("participant-%d", index), "198.51.100.7", true) {
			manager.mu.Unlock()
			t.Fatalf("IP attempt %d was prematurely limited", index+1)
		}
	}
	if manager.allowAttemptLocked("participant-7", "198.51.100.7", true) {
		manager.mu.Unlock()
		t.Fatal("new participant reset the IP throttle")
	}
	manager.mu.Unlock()
}

func TestIntercomAuthenticationThrottleIgnoresUnattributableIP(t *testing.T) {
	manager := newIntercomManager(slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(manager.stop)
	manager.mu.Lock()
	for index := 0; index < 7; index++ {
		if !manager.allowAttemptLocked(fmt.Sprintf("shared-proxy-participant-%d", index), "198.51.100.9", false) {
			manager.mu.Unlock()
			t.Fatalf("unattributable shared IP limited participant %d", index)
		}
	}
	for index := 0; index < 6; index++ {
		if !manager.allowAttemptLocked("stable-unattributable-participant", "198.51.100.9", false) {
			manager.mu.Unlock()
			t.Fatalf("stable participant attempt %d was prematurely limited", index+1)
		}
	}
	if manager.allowAttemptLocked("stable-unattributable-participant", "198.51.100.9", false) {
		manager.mu.Unlock()
		t.Fatal("unattributable IP disabled the stable participant throttle")
	}
	manager.mu.Unlock()
}

func TestIntercomChiefResumeAndExpiryAreBoundToOriginRoomEpoch(t *testing.T) {
	manager, group, _, _, chief := newIntercomPrivateTestGroup(t)
	resumeToken := chief.resumeToken
	manager.detachPeer(chief.peer)
	replacement := &peer{role: roleEngineer, writeMu: &sync.Mutex{}}
	manager.mu.Lock()
	if resumed := manager.resumeMemberLocked(group, replacement, IntercomJoinPayload{Role: IntercomRoleChief, ResumeToken: resumeToken}, "other-epoch:other-room", "", ""); resumed != nil {
		manager.mu.Unlock()
		t.Fatal("chief resumed from a different originating room epoch")
	}
	manager.mu.Unlock()

	manager.removeRoom(&Room{ID: "room", Epoch: "epoch"})
	manager.mu.Lock()
	_, stillPresent := group.members[chief.id]
	manager.mu.Unlock()
	if stillPresent {
		t.Fatal("chief membership survived originating room expiry")
	}
}

func TestIntercomActivityTimersClearOnDetach(t *testing.T) {
	manager, _, driver, _, _ := newIntercomPrivateTestGroup(t)
	manager.activity(driver.peer, IntercomActivityPayload{Speaking: true})
	manager.activity(driver.peer, IntercomActivityPayload{Speaking: false})
	manager.detachPeer(driver.peer)
	manager.mu.Lock()
	pending := driver.pendingActivity
	activityTimer, leaseTimer := driver.activityTimer, driver.leaseTimer
	manager.mu.Unlock()
	if pending != nil || activityTimer != nil || leaseTimer != nil {
		t.Fatalf("detached activity state pending=%v activityTimer=%v leaseTimer=%v", pending, activityTimer, leaseTimer)
	}
}

func TestIntercomCredentialGenerationFailsClosed(t *testing.T) {
	tests := map[string]func(*intercomManager){
		"group code": func(manager *intercomManager) {
			manager.groupCodeGen = func() (string, error) { return "", errors.New("entropy unavailable") }
		},
		"chief code": func(manager *intercomManager) {
			manager.chiefCodeGen = func(int) (string, error) { return "", errors.New("entropy unavailable") }
		},
		"password salt": func(manager *intercomManager) {
			manager.randomRead = func([]byte) error { return errors.New("entropy unavailable") }
		},
		"member tokens": func(manager *intercomManager) {
			manager.randomHex = func(int) (string, error) { return "", errors.New("entropy unavailable") }
		},
	}
	for name, configure := range tests {
		t.Run(name, func(t *testing.T) {
			rm := newIntercomTestRoomManager(t)
			driver := addIntercomTestRoom(rm, "room-a", "epoch-a", roleDriver)
			configure(rm.intercom)
			rm.intercom.createGroup(rm, driver, "create-1", "127.0.0.1", IntercomGroupCreatePayload{DisplayName: "Driver", Password: "pw"})
			rm.intercom.mu.Lock()
			groupCount := len(rm.intercom.groups)
			member := rm.intercom.byPeer[driver]
			rm.intercom.mu.Unlock()
			if groupCount != 0 || member != nil {
				t.Fatalf("entropy failure created group=%d member=%+v", groupCount, member)
			}
		})
	}
}

func TestIntercomProviderDispatchDoesNotBlockControl(t *testing.T) {
	p := &peer{}
	providerStarted := make(chan struct{})
	providerRelease := make(chan struct{})
	controlDone := make(chan struct{})
	if !p.dispatchIntercomProvider(func() {
		close(providerStarted)
		<-providerRelease
	}) {
		t.Fatal("provider task was not dispatched")
	}
	<-providerStarted
	if !p.dispatchIntercom(func() { close(controlDone) }) {
		t.Fatal("control task was not dispatched")
	}
	select {
	case <-controlDone:
	case <-time.After(time.Second):
		t.Fatal("control task was blocked behind provider I/O")
	}
	close(providerRelease)
	p.stopIntercomDispatch()
}

func TestIntercomDispatchOverflowClosesWithoutGoroutineAmplification(t *testing.T) {
	rm := newIntercomTestRoomManager(t)
	serverConn, clientConn := openSignalingPair(t)
	defer serverConn.Close()
	defer clientConn.Close()
	p := &peer{conn: serverConn, role: roleDriver, writeMu: &sync.Mutex{}}
	providerStarted := make(chan struct{})
	providerRelease := make(chan struct{})
	if !p.dispatchIntercomProvider(func() {
		close(providerStarted)
		<-providerRelease
	}) {
		t.Fatal("blocking provider task was not dispatched")
	}
	<-providerStarted
	for index := 0; index < cap(p.intercomProvider); index++ {
		if !p.dispatchIntercomProvider(func() {}) {
			close(providerRelease)
			t.Fatalf("provider queue filled early at %d", index)
		}
	}
	p.writeMu.Lock()
	baseline := runtime.NumGoroutine()
	payload, _ := json.Marshal(IntercomSFUSessionNewPayload{})
	raw, _ := json.Marshal(Message{Type: TypeIntercomSFUSessionNew, RequestID: "overflow", Payload: payload})
	for range 100 {
		rm.HandleMessage(serverConn, raw, p, p.writeMu, "127.0.0.1")
	}
	runtime.Gosched()
	after := runtime.NumGoroutine()
	p.writeMu.Unlock()
	close(providerRelease)
	if !p.inactive.Load() {
		t.Fatal("provider queue overflow did not fail-close the peer")
	}
	if after > baseline+8 {
		t.Fatalf("overflow amplified goroutines: before=%d after=%d", baseline, after)
	}
	clientConn.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := clientConn.ReadMessage(); err == nil {
		t.Fatal("overflowed signaling connection remained open")
	}
}

func newIntercomTestRoomManager(t *testing.T) *RoomManager {
	t.Helper()
	rm := NewRoomManager(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, false)
	t.Cleanup(rm.Stop)
	return rm
}

func addIntercomTestRoom(rm *RoomManager, roomID, epoch string, role peerRole) *peer {
	p := &peer{role: role, roomID: roomID, roomCode: "1234", writeMu: &sync.Mutex{}}
	rm.mu.Lock()
	room := rm.roomsByID[roomID]
	if room == nil {
		room = &Room{ID: roomID, Epoch: epoch, Code: "1234", Engineers: make(map[string]*peer), turnCredentials: make(map[string]*turnCredentialState)}
		rm.roomsByID[roomID] = room
		rm.roomsByCode[room.Code] = room
	}
	rm.mu.Unlock()
	room.mu.Lock()
	if role == roleDriver {
		room.Driver = p
		room.DriverLostAt = nil
	} else {
		var err error
		p.id, err = generatePeerID()
		if err != nil {
			panic(err)
		}
		room.Engineers[p.id] = p
	}
	room.mu.Unlock()
	return p
}

func newIntercomPrivateTestGroup(t *testing.T) (*intercomManager, *intercomGroup, *intercomMember, *intercomMember, *intercomMember) {
	return newIntercomPrivateTestGroupWithEngineerPeer(t, nil)
}

func newIntercomPrivateTestGroupWithEngineerPeer(t *testing.T, engineerPeer *peer) (*intercomManager, *intercomGroup, *intercomMember, *intercomMember, *intercomMember) {
	t.Helper()
	manager := newIntercomManager(slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(manager.stop)
	group := &intercomGroup{code: "123456", revision: 1, topologyRevision: 1, members: make(map[string]*intercomMember)}
	manager.groups[group.code] = group
	driverPeer := &peer{role: roleDriver, writeMu: &sync.Mutex{}}
	if engineerPeer == nil {
		engineerPeer = &peer{role: roleEngineer, writeMu: &sync.Mutex{}}
	}
	chiefPeer := &peer{role: roleEngineer, writeMu: &sync.Mutex{}}
	manager.mu.Lock()
	driver, err := manager.newMemberLocked(group, driverPeer, IntercomRoleDriver, "Driver", "epoch:room", "epoch:room", "")
	if err != nil {
		t.Fatal(err)
	}
	engineer, err := manager.newMemberLocked(group, engineerPeer, IntercomRoleEngineer, "Engineer", "epoch:room", "", driver.driverKey)
	if err != nil {
		t.Fatal(err)
	}
	chief, err := manager.newMemberLocked(group, chiefPeer, IntercomRoleChief, "Chief", "epoch:room", "", "")
	if err != nil {
		t.Fatal(err)
	}
	manager.mu.Unlock()
	return manager, group, driver, engineer, chief
}

func waitUntil(t *testing.T, timeout time.Duration, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatal("condition did not become true")
		}
		time.Sleep(time.Millisecond)
	}
}
