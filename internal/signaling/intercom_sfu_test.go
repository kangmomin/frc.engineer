package signaling

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"frc.engineer/internal/realtimesfu"
)

type fakeRealtimeSFU struct {
	mu             sync.Mutex
	nextSession    int
	sessionStarted chan struct{}
	sessionRelease chan struct{}
	sessionOnce    sync.Once
	newTrackCalls  []realtimesfu.TracksRequest
	updateCalls    []realtimesfu.UpdateTracksRequest
	closeCalls     []realtimesfu.CloseTracksRequest
	renegotiate    int
	remoteStarted  chan struct{}
	remoteRelease  chan struct{}
	remoteOnce     sync.Once
	newStarted     chan struct{}
	newRelease     chan struct{}
	newOnce        sync.Once
	updateStarted  chan struct{}
	updateRelease  chan struct{}
	updateOnce     sync.Once
	closeStarted   chan struct{}
	closeRelease   chan struct{}
	closeOnce      sync.Once
	closeRequires  bool
	failNewTracks  bool
}

func (f *fakeRealtimeSFU) NewSession(context.Context) (realtimesfu.Session, error) {
	f.mu.Lock()
	f.nextSession++
	sessionNumber := f.nextSession
	sessionStarted, sessionRelease := f.sessionStarted, f.sessionRelease
	f.mu.Unlock()
	if sessionStarted != nil {
		f.sessionOnce.Do(func() { close(sessionStarted) })
	}
	if sessionRelease != nil {
		<-sessionRelease
	}
	return realtimesfu.Session{SessionID: fmt.Sprintf("provider-session-%d", sessionNumber)}, nil
}

func (f *fakeRealtimeSFU) NewTracks(_ context.Context, _ string, request realtimesfu.TracksRequest) (realtimesfu.TracksResponse, error) {
	f.mu.Lock()
	f.newTrackCalls = append(f.newTrackCalls, request)
	failNewTracks := f.failNewTracks
	newStarted, newRelease := f.newStarted, f.newRelease
	remoteStarted, remoteRelease := f.remoteStarted, f.remoteRelease
	f.mu.Unlock()
	if newStarted != nil {
		f.newOnce.Do(func() { close(newStarted) })
	}
	if newRelease != nil {
		<-newRelease
	}
	if failNewTracks {
		return realtimesfu.TracksResponse{}, realtimesfu.ErrUpstream
	}
	response := realtimesfu.TracksResponse{}
	if len(request.Tracks) > 0 && request.Tracks[0].Location == "local" {
		response.SessionDescription = &realtimesfu.SessionDescription{Type: "answer", SDP: "v=0"}
		for _, track := range request.Tracks {
			response.Tracks = append(response.Tracks, realtimesfu.TrackResult{MID: track.MID, TrackName: track.TrackName})
		}
		return response, nil
	}
	if remoteStarted != nil {
		f.remoteOnce.Do(func() { close(remoteStarted) })
	}
	if remoteRelease != nil {
		<-remoteRelease
	}
	for index, track := range request.Tracks {
		response.Tracks = append(response.Tracks, realtimesfu.TrackResult{Location: "remote", MID: fmt.Sprintf("remote-%d", index), SessionID: track.SessionID, TrackName: track.TrackName})
	}
	response.RequiresImmediateRenegotiation = true
	response.SessionDescription = &realtimesfu.SessionDescription{Type: "offer", SDP: "v=0"}
	return response, nil
}

func (f *fakeRealtimeSFU) Renegotiate(context.Context, string, realtimesfu.SessionDescription) (realtimesfu.TracksResponse, error) {
	f.mu.Lock()
	f.renegotiate++
	f.mu.Unlock()
	return realtimesfu.TracksResponse{}, nil
}

func (f *fakeRealtimeSFU) UpdateTracks(_ context.Context, _ string, request realtimesfu.UpdateTracksRequest) (realtimesfu.TracksResponse, error) {
	f.mu.Lock()
	f.updateCalls = append(f.updateCalls, request)
	updateStarted, updateRelease := f.updateStarted, f.updateRelease
	f.mu.Unlock()
	if updateStarted != nil {
		f.updateOnce.Do(func() { close(updateStarted) })
	}
	if updateRelease != nil {
		<-updateRelease
	}
	response := realtimesfu.TracksResponse{}
	for _, track := range request.Tracks {
		response.Tracks = append(response.Tracks, realtimesfu.TrackResult{Location: "remote", MID: track.MID, SessionID: track.SessionID, TrackName: track.TrackName})
	}
	return response, nil
}

func (f *fakeRealtimeSFU) CloseTracks(_ context.Context, _ string, request realtimesfu.CloseTracksRequest) (realtimesfu.TracksResponse, error) {
	f.mu.Lock()
	f.closeCalls = append(f.closeCalls, request)
	closeRequires := f.closeRequires
	closeStarted, closeRelease := f.closeStarted, f.closeRelease
	f.mu.Unlock()
	if closeStarted != nil {
		f.closeOnce.Do(func() { close(closeStarted) })
	}
	if closeRelease != nil {
		<-closeRelease
	}
	response := realtimesfu.TracksResponse{}
	for _, track := range request.Tracks {
		response.Tracks = append(response.Tracks, realtimesfu.TrackResult{MID: track.MID})
	}
	if closeRequires {
		response.RequiresImmediateRenegotiation = true
		response.SessionDescription = &realtimesfu.SessionDescription{Type: "offer", SDP: "v=0"}
	}
	return response, nil
}

func TestIntercomSFUBrokerAuthorizesAndReconcilesSubscriptions(t *testing.T) {
	manager, _, driver, engineer, _ := newIntercomPrivateTestGroup(t)
	provider := &fakeRealtimeSFU{}
	manager.setProvider(provider)
	manager.sfuSessionNew(driver.peer, "driver-session")
	manager.sfuSessionNew(engineer.peer, "engineer-session")
	driverHandle := brokerHandle(t, manager, driver)
	engineerHandle := brokerHandle(t, manager, engineer)

	manager.sfuPublish(driver.peer, "driver-publish", IntercomSFUPublishPayload{
		SessionHandle: driverHandle,
		SessionDescription: IntercomSessionDescription{
			Type: IntercomSDPOffer,
			SDP:  "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\na=mid:1\r\n",
		},
		Tracks: []IntercomPublishTrack{
			{MID: "0", Class: IntercomTrackDriverEngineer},
			{MID: "1", Class: IntercomTrackDriverChief},
		},
	})
	manager.sfuSubscribe(engineer.peer, "subscribe-1", IntercomSFUSubscribePayload{SessionHandle: engineerHandle})
	manager.sfuRenegotiate(engineer.peer, "subscribe-1-answer", IntercomSFURenegotiatePayload{
		SessionHandle: engineerHandle, SessionDescription: IntercomSessionDescription{Type: IntercomSDPAnswer, SDP: "v=0"},
	})

	manager.mu.Lock()
	if len(engineer.sfu.remote) != 1 {
		manager.mu.Unlock()
		t.Fatalf("engineer remote count = %d, want assigned driver track only", len(engineer.sfu.remote))
	}
	var oldTrackKey string
	for key, binding := range engineer.sfu.remote {
		oldTrackKey = key
		if binding.source.class != IntercomTrackDriverEngineer {
			manager.mu.Unlock()
			t.Fatalf("subscribed class = %s", binding.source.class)
		}
	}
	delete(driver.sfu.local, oldTrackKey)
	manager.mu.Unlock()
	manager.sfuSubscribe(engineer.peer, "subscribe-2", IntercomSFUSubscribePayload{SessionHandle: engineerHandle})
	provider.mu.Lock()
	if len(provider.closeCalls) == 0 || len(provider.closeCalls[len(provider.closeCalls)-1].Tracks) != 1 || !provider.closeCalls[len(provider.closeCalls)-1].Force {
		provider.mu.Unlock()
		t.Fatalf("force close calls = %+v", provider.closeCalls)
	}
	provider.mu.Unlock()

	manager.mu.Lock()
	replacement := &intercomPublished{
		trackKey: "replacement-track", providerTrackName: "replacement-provider-track", providerSessionID: driver.sfu.providerID,
		mid: "2", class: IntercomTrackDriverEngineer, participantID: driver.id,
	}
	driver.sfu.local[replacement.trackKey] = replacement
	manager.mu.Unlock()
	manager.sfuSubscribe(engineer.peer, "subscribe-3", IntercomSFUSubscribePayload{SessionHandle: engineerHandle})
	provider.mu.Lock()
	if len(provider.updateCalls) != 1 || provider.updateCalls[0].Tracks[0].TrackName != replacement.providerTrackName {
		provider.mu.Unlock()
		t.Fatalf("inactive MID reuse calls = %+v", provider.updateCalls)
	}
	provider.mu.Unlock()
}

func TestIntercomSFUBrokerNegotiationStateRequiresAnswer(t *testing.T) {
	manager, _, driver, engineer, _ := newIntercomPrivateTestGroup(t)
	provider := &fakeRealtimeSFU{}
	manager.setProvider(provider)
	manager.sfuSessionNew(driver.peer, "driver-session")
	manager.sfuSessionNew(engineer.peer, "engineer-session")
	manager.mu.Lock()
	driver.sfu.local["source-track"] = &intercomPublished{
		trackKey: "source-track", providerTrackName: "provider-track", providerSessionID: driver.sfu.providerID,
		mid: "0", class: IntercomTrackDriverEngineer, participantID: driver.id,
	}
	engineerHandle := engineer.sfu.handle
	manager.mu.Unlock()
	manager.sfuSubscribe(engineer.peer, "subscribe-1", IntercomSFUSubscribePayload{SessionHandle: engineerHandle})
	manager.mu.Lock()
	if engineer.sfu.state != intercomBrokerAwaitingAnswer {
		manager.mu.Unlock()
		t.Fatal("broker did not enter awaiting answer")
	}
	topologyBeforeRetry := engineer.group.topologyRevision
	manager.mu.Unlock()

	manager.sfuSubscribe(engineer.peer, "subscribe-2", IntercomSFUSubscribePayload{SessionHandle: engineerHandle})
	errorPayload := cachedIntercomError(t, manager, engineer, "subscribe-2")
	if errorPayload.Code != "negotiation_in_progress" {
		t.Fatalf("error code = %q", errorPayload.Code)
	}
	manager.sfuRenegotiate(engineer.peer, "answer-1", IntercomSFURenegotiatePayload{
		SessionHandle:      engineerHandle,
		SessionDescription: IntercomSessionDescription{Type: IntercomSDPAnswer, SDP: "v=0"},
	})
	manager.mu.Lock()
	stable := engineer.sfu.state == intercomBrokerStable
	topologyRetried := engineer.group.topologyRevision > topologyBeforeRetry
	manager.mu.Unlock()
	if !stable || !topologyRetried {
		t.Fatalf("stable=%t topology retry=%t", stable, topologyRetried)
	}
}

func TestIntercomSFUPublishRejectsUnauthorizedOrNonAudioSDP(t *testing.T) {
	manager, _, driver, _, _ := newIntercomPrivateTestGroup(t)
	provider := &fakeRealtimeSFU{}
	manager.setProvider(provider)
	manager.sfuSessionNew(driver.peer, "driver-session")
	handle := brokerHandle(t, manager, driver)
	manager.sfuPublish(driver.peer, "bad-publish", IntercomSFUPublishPayload{
		SessionHandle:      handle,
		SessionDescription: IntercomSessionDescription{Type: IntercomSDPOffer, SDP: "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\n"},
		Tracks:             []IntercomPublishTrack{{MID: "0", Class: IntercomTrackDriverEngineer}},
	})
	if payload := cachedIntercomError(t, manager, driver, "bad-publish"); payload.Code != "unauthorized_track" {
		t.Fatalf("error = %+v", payload)
	}
	provider.mu.Lock()
	defer provider.mu.Unlock()
	if len(provider.newTrackCalls) != 0 {
		t.Fatalf("provider called for unauthorized publish: %+v", provider.newTrackCalls)
	}
}

func TestIntercomSFUProviderFailureInvalidatesOpaqueSession(t *testing.T) {
	manager, _, driver, _, _ := newIntercomPrivateTestGroup(t)
	provider := &fakeRealtimeSFU{failNewTracks: true}
	manager.setProvider(provider)
	manager.sfuSessionNew(driver.peer, "driver-session")
	handle := brokerHandle(t, manager, driver)
	manager.sfuPublish(driver.peer, "publish-1", IntercomSFUPublishPayload{
		SessionHandle:      handle,
		SessionDescription: IntercomSessionDescription{Type: IntercomSDPOffer, SDP: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\n"},
		Tracks:             []IntercomPublishTrack{{MID: "0", Class: IntercomTrackDriverEngineer}},
	})
	errorPayload := cachedIntercomError(t, manager, driver, "publish-1")
	manager.mu.Lock()
	invalid := driver.sfu.invalid
	manager.mu.Unlock()
	if !invalid || errorPayload.Code != "broker_rebuild_required" {
		t.Fatalf("invalid=%t error=%+v", invalid, errorPayload)
	}
}

func TestIntercomSFUForceCloseRejectsUnexpectedNegotiation(t *testing.T) {
	manager, _, driver, engineer, _ := newIntercomPrivateTestGroup(t)
	provider := &fakeRealtimeSFU{closeRequires: true}
	manager.setProvider(provider)
	manager.sfuSessionNew(engineer.peer, "engineer-session")
	manager.mu.Lock()
	source := &intercomPublished{trackKey: "old-track", providerTrackName: "old-provider", providerSessionID: "source-session", mid: "0", class: IntercomTrackDriverEngineer, participantID: driver.id}
	engineer.sfu.remote[source.trackKey] = &intercomRemoteBinding{source: source, mid: "remote-0"}
	handle := engineer.sfu.handle
	manager.mu.Unlock()
	manager.sfuSubscribe(engineer.peer, "subscribe-close", IntercomSFUSubscribePayload{SessionHandle: handle})
	manager.mu.Lock()
	invalid := engineer.sfu.invalid
	manager.mu.Unlock()
	if payload := cachedIntercomError(t, manager, engineer, "subscribe-close"); !invalid || payload.Code != "broker_rebuild_required" {
		t.Fatalf("force-close negotiation invalid=%t error=%+v", invalid, payload)
	}
}

func TestIntercomSFUSubscribeRejectsTopologyChangeDuringProviderIO(t *testing.T) {
	manager, group, driver, engineer, _ := newIntercomPrivateTestGroup(t)
	provider := &fakeRealtimeSFU{remoteStarted: make(chan struct{}), remoteRelease: make(chan struct{})}
	manager.setProvider(provider)
	manager.sfuSessionNew(engineer.peer, "engineer-session")
	manager.mu.Lock()
	first := &intercomPublished{trackKey: "source-one", providerTrackName: "provider-one", providerSessionID: "source-session", mid: "0", class: IntercomTrackDriverEngineer, participantID: driver.id}
	driver.sfu = &intercomBrokerSession{handle: "driver", providerID: "source-session", generation: driver.generation, state: intercomBrokerStable, local: map[string]*intercomPublished{first.trackKey: first}, remote: make(map[string]*intercomRemoteBinding)}
	handle := engineer.sfu.handle
	manager.mu.Unlock()
	done := make(chan struct{})
	go func() {
		manager.sfuSubscribe(engineer.peer, "stale-subscribe", IntercomSFUSubscribePayload{SessionHandle: handle})
		close(done)
	}()
	<-provider.remoteStarted
	manager.mu.Lock()
	second := &intercomPublished{trackKey: "source-two", providerTrackName: "provider-two", providerSessionID: "source-session", mid: "1", class: IntercomTrackDriverEngineer, participantID: driver.id}
	driver.sfu.local[second.trackKey] = second
	group.topologyRevision++
	group.revision++
	manager.mu.Unlock()
	close(provider.remoteRelease)
	<-done
	manager.mu.Lock()
	invalid := engineer.sfu.invalid
	remoteCount := len(engineer.sfu.remote)
	manager.mu.Unlock()
	if !invalid || remoteCount != 0 {
		t.Fatalf("stale plan committed invalid=%t remoteCount=%d", invalid, remoteCount)
	}
	if payload := cachedIntercomError(t, manager, engineer, "stale-subscribe"); payload.Code != "broker_rebuild_required" {
		t.Fatalf("stale topology error = %+v", payload)
	}
}

func TestIntercomSFUStaleUpdateClosesReusedMID(t *testing.T) {
	manager, group, driver, engineer, _ := newIntercomPrivateTestGroup(t)
	provider := &fakeRealtimeSFU{updateStarted: make(chan struct{}), updateRelease: make(chan struct{})}
	manager.setProvider(provider)
	manager.sfuSessionNew(engineer.peer, "engineer-session")
	manager.mu.Lock()
	first := &intercomPublished{trackKey: "source-one", providerTrackName: "provider-one", providerSessionID: "source-session", mid: "0", class: IntercomTrackDriverEngineer, participantID: driver.id}
	driver.sfu = &intercomBrokerSession{handle: "driver", providerID: "source-session", generation: driver.generation, state: intercomBrokerStable, local: map[string]*intercomPublished{first.trackKey: first}, remote: make(map[string]*intercomRemoteBinding)}
	engineer.sfu.inactiveMIDs = []string{"inactive-0"}
	handle := engineer.sfu.handle
	manager.mu.Unlock()

	done := make(chan struct{})
	go func() {
		manager.sfuSubscribe(engineer.peer, "stale-update", IntercomSFUSubscribePayload{SessionHandle: handle})
		close(done)
	}()
	<-provider.updateStarted
	manager.mu.Lock()
	second := &intercomPublished{trackKey: "source-two", providerTrackName: "provider-two", providerSessionID: "source-session", mid: "1", class: IntercomTrackDriverEngineer, participantID: driver.id}
	driver.sfu.local[second.trackKey] = second
	group.topologyRevision++
	group.revision++
	manager.mu.Unlock()
	close(provider.updateRelease)
	<-done

	provider.mu.Lock()
	closed := false
	for _, call := range provider.closeCalls {
		for _, track := range call.Tracks {
			closed = closed || (call.Force && track.MID == "inactive-0")
		}
	}
	provider.mu.Unlock()
	manager.mu.Lock()
	invalid := engineer.sfu.invalid
	manager.mu.Unlock()
	if !closed || !invalid {
		t.Fatalf("stale updated MID cleanup closed=%t invalid=%t", closed, invalid)
	}
	if payload := cachedIntercomError(t, manager, engineer, "stale-update"); payload.Code != "broker_rebuild_required" {
		t.Fatalf("stale update error = %+v", payload)
	}
}

func TestIntercomSFURebindInvalidatesInFlightBrokerMutation(t *testing.T) {
	manager, _, driver, engineer, _ := newIntercomPrivateTestGroup(t)
	provider := &fakeRealtimeSFU{updateStarted: make(chan struct{}), updateRelease: make(chan struct{})}
	manager.setProvider(provider)
	manager.sfuSessionNew(engineer.peer, "engineer-session")
	manager.mu.Lock()
	source := &intercomPublished{trackKey: "source", providerTrackName: "provider-source", providerSessionID: "source-session", mid: "0", class: IntercomTrackDriverEngineer, participantID: driver.id}
	driver.sfu = &intercomBrokerSession{handle: "driver", providerID: "source-session", generation: driver.generation, state: intercomBrokerStable, local: map[string]*intercomPublished{source.trackKey: source}, remote: make(map[string]*intercomRemoteBinding)}
	oldSession := engineer.sfu
	oldSession.local["engineer-bus"] = &intercomPublished{trackKey: "engineer-bus", providerTrackName: "provider-bus", providerSessionID: oldSession.providerID, mid: "local-0", class: IntercomTrackEngineerBus, participantID: engineer.id}
	oldSession.inactiveMIDs = []string{"inactive-0"}
	handle := oldSession.handle
	originalGeneration := engineer.generation
	oldPeer := engineer.peer
	manager.mu.Unlock()

	done := make(chan struct{})
	go func() {
		manager.sfuSubscribe(oldPeer, "stale-after-rebind", IntercomSFUSubscribePayload{SessionHandle: handle})
		close(done)
	}()
	<-provider.updateStarted
	serverConn, clientConn := openSignalingPair(t)
	defer serverConn.Close()
	defer clientConn.Close()
	replacement := &peer{conn: serverConn, role: roleEngineer, writeMu: &sync.Mutex{}}
	manager.transferPeer(oldPeer, replacement)
	manager.mu.Lock()
	if engineer.generation != originalGeneration+1 || engineer.sfu != nil || !oldSession.invalid {
		manager.mu.Unlock()
		t.Fatalf("rebound broker generation=%d session=%+v oldInvalid=%t", engineer.generation, engineer.sfu, oldSession.invalid)
	}
	manager.mu.Unlock()
	if err := replacement.sendJSON(Message{Type: TypeRoomJoined, Features: &Features{IntercomVersion: IntercomProtocolVersion}}); err != nil {
		t.Fatal(err)
	}
	manager.advertisePeer(replacement)
	clientConn.SetReadDeadline(time.Now().Add(time.Second))
	var roomJoined, joined Message
	if err := clientConn.ReadJSON(&roomJoined); err != nil || roomJoined.Type != TypeRoomJoined {
		t.Fatalf("room advertisement = %+v, %v", roomJoined, err)
	}
	if err := clientConn.ReadJSON(&joined); err != nil || joined.Type != TypeIntercomJoined {
		t.Fatalf("rebuild authority = %+v, %v", joined, err)
	}
	var joinedPayload IntercomJoinedPayload
	if !decodeIntercomPayload(joined.Payload, &joinedPayload) || joinedPayload.MembershipGeneration != originalGeneration+1 {
		t.Fatalf("rebuild generation = %+v", joinedPayload)
	}

	close(provider.updateRelease)
	<-done
	waitUntil(t, time.Second, func() bool {
		provider.mu.Lock()
		defer provider.mu.Unlock()
		closed := make(map[string]bool)
		for _, call := range provider.closeCalls {
			for _, track := range call.Tracks {
				closed[track.MID] = true
			}
		}
		return closed["local-0"] && closed["inactive-0"]
	})
	provider.mu.Lock()
	closedMIDs := make(map[string]bool)
	for _, call := range provider.closeCalls {
		for _, track := range call.Tracks {
			closedMIDs[track.MID] = true
		}
	}
	provider.mu.Unlock()
	if !closedMIDs["local-0"] || !closedMIDs["inactive-0"] {
		t.Fatalf("detached broker close mids = %v", closedMIDs)
	}
	manager.mu.Lock()
	_, staleResponseCached := engineer.responseCache["stale-after-rebind"]
	stillDetached := engineer.sfu == nil
	manager.mu.Unlock()
	if staleResponseCached || !stillDetached {
		t.Fatalf("delayed provider result cached=%t sessionDetached=%t", staleResponseCached, stillDetached)
	}
}

func TestIntercomSFUDelayedErrorCannotCrossSamePeerFreshMembership(t *testing.T) {
	serverConn, clientConn := openSignalingPair(t)
	defer serverConn.Close()
	defer clientConn.Close()
	p := &peer{conn: serverConn, role: roleEngineer, writeMu: &sync.Mutex{}}
	manager, _, _, engineer, _ := newIntercomPrivateTestGroupWithEngineerPeer(t, p)
	manager.mu.Lock()
	manager.resetMemberDeliveryReadyLocked(engineer, false)
	manager.mu.Unlock()
	provider := &fakeRealtimeSFU{}
	manager.setProvider(provider)
	manager.sfuSessionNew(p, "old-session")
	readExpectedIntercomType(t, clientConn, TypeIntercomSFUSession)
	handle := brokerHandle(t, manager, engineer)
	provider.newStarted = make(chan struct{})
	provider.newRelease = make(chan struct{})
	provider.failNewTracks = true
	p.writeMu.Lock()
	writeLocked := true
	defer func() {
		if writeLocked {
			p.writeMu.Unlock()
		}
	}()
	released := false
	defer func() {
		if !released {
			close(provider.newRelease)
		}
	}()
	done := make(chan struct{})
	go func() {
		manager.sfuPublish(p, "stale-error", IntercomSFUPublishPayload{
			SessionHandle:      handle,
			SessionDescription: IntercomSessionDescription{Type: IntercomSDPOffer, SDP: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\n"},
			Tracks:             []IntercomPublishTrack{{MID: "0", Class: IntercomTrackEngineerBus}},
		})
		close(done)
	}()
	<-provider.newStarted
	close(provider.newRelease)
	released = true
	waitUntil(t, time.Second, func() bool {
		manager.mu.Lock()
		defer manager.mu.Unlock()
		_, cached := engineer.responseCache["stale-error"]
		return engineer.sfu != nil && engineer.sfu.invalid && cached
	})
	fresh := replaceIntercomMemberOnSamePeer(t, manager, engineer)
	p.writeMu.Unlock()
	writeLocked = false
	<-done
	manager.mu.Lock()
	_, crossed := fresh.responseCache["stale-error"]
	manager.mu.Unlock()
	if crossed {
		t.Fatal("delayed provider error was cached in the fresh membership")
	}
	assertOnlySentinelAfterStaleBrokerOperation(t, p, clientConn)
}

func TestIntercomSFUProviderErrorDoesNotResolveAgainstReplacementMember(t *testing.T) {
	serverConn, clientConn := openSignalingPair(t)
	defer serverConn.Close()
	defer clientConn.Close()
	p := &peer{conn: serverConn, role: roleEngineer, writeMu: &sync.Mutex{}}
	manager, _, _, engineer, _ := newIntercomPrivateTestGroupWithEngineerPeer(t, p)
	manager.mu.Lock()
	manager.resetMemberDeliveryReadyLocked(engineer, false)
	manager.mu.Unlock()
	provider := &fakeRealtimeSFU{}
	manager.setProvider(provider)
	manager.sfuSessionNew(p, "old-session")
	readExpectedIntercomType(t, clientConn, TypeIntercomSFUSession)
	handle := brokerHandle(t, manager, engineer)
	provider.newStarted = make(chan struct{})
	provider.newRelease = make(chan struct{})
	provider.failNewTracks = true
	done := make(chan struct{})
	go func() {
		manager.sfuPublish(p, "replacement-error", IntercomSFUPublishPayload{
			SessionHandle:      handle,
			SessionDescription: IntercomSessionDescription{Type: IntercomSDPOffer, SDP: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\n"},
			Tracks:             []IntercomPublishTrack{{MID: "0", Class: IntercomTrackEngineerBus}},
		})
		close(done)
	}()
	<-provider.newStarted
	fresh := replaceIntercomMemberOnSamePeer(t, manager, engineer)
	close(provider.newRelease)
	<-done
	manager.mu.Lock()
	_, crossed := fresh.responseCache["replacement-error"]
	manager.mu.Unlock()
	if crossed {
		t.Fatal("old provider error resolved against replacement member")
	}
	assertOnlySentinelAfterStaleBrokerOperation(t, p, clientConn)
}

func TestIntercomSFUQueuedOldSessionNewCannotBindFreshMembership(t *testing.T) {
	manager, _, _, engineer, _ := newIntercomPrivateTestGroup(t)
	provider := &fakeRealtimeSFU{sessionStarted: make(chan struct{}), sessionRelease: make(chan struct{})}
	manager.setProvider(provider)
	p := engineer.peer
	firstBinding := manager.captureDispatchBinding(p)
	firstDone := make(chan struct{})
	if !p.dispatchIntercomProvider(func() {
		manager.sfuSessionNew(p, "old-session-a", firstBinding)
		close(firstDone)
	}) {
		t.Fatal("first provider operation was not queued")
	}
	<-provider.sessionStarted
	secondBinding := manager.captureDispatchBinding(p)
	secondDone := make(chan struct{})
	if !p.dispatchIntercomProvider(func() {
		manager.sfuSessionNew(p, "old-session-b", secondBinding)
		close(secondDone)
	}) {
		t.Fatal("second provider operation was not queued")
	}
	p.intercomMembershipEpoch.Add(1)
	fresh := replaceIntercomMemberOnSamePeer(t, manager, engineer)
	close(provider.sessionRelease)
	<-firstDone
	<-secondDone
	provider.mu.Lock()
	newSessionCalls := provider.nextSession
	provider.mu.Unlock()
	manager.mu.Lock()
	_, firstCrossed := fresh.responseCache["old-session-a"]
	_, secondCrossed := fresh.responseCache["old-session-b"]
	freshSession := fresh.sfu
	manager.mu.Unlock()
	if newSessionCalls != 1 || firstCrossed || secondCrossed || freshSession != nil {
		t.Fatalf("queued provider work crossed membership: calls=%d first=%t second=%t session=%+v", newSessionCalls, firstCrossed, secondCrossed, freshSession)
	}
}

func TestIntercomSFUDelayedCloseCannotCrossSamePeerFreshMembership(t *testing.T) {
	serverConn, clientConn := openSignalingPair(t)
	defer serverConn.Close()
	defer clientConn.Close()
	p := &peer{conn: serverConn, role: roleEngineer, writeMu: &sync.Mutex{}}
	manager, _, _, engineer, _ := newIntercomPrivateTestGroupWithEngineerPeer(t, p)
	manager.mu.Lock()
	manager.resetMemberDeliveryReadyLocked(engineer, false)
	manager.mu.Unlock()
	provider := &fakeRealtimeSFU{}
	manager.setProvider(provider)
	manager.sfuSessionNew(p, "old-session")
	readExpectedIntercomType(t, clientConn, TypeIntercomSFUSession)
	manager.mu.Lock()
	engineer.sfu.local["local"] = &intercomPublished{trackKey: "local", providerTrackName: "provider-local", providerSessionID: engineer.sfu.providerID, mid: "0", class: IntercomTrackEngineerBus, participantID: engineer.id}
	handle := engineer.sfu.handle
	manager.mu.Unlock()
	provider.closeStarted = make(chan struct{})
	provider.closeRelease = make(chan struct{})
	p.writeMu.Lock()
	writeLocked := true
	defer func() {
		if writeLocked {
			p.writeMu.Unlock()
		}
	}()
	released := false
	defer func() {
		if !released {
			close(provider.closeRelease)
		}
	}()
	done := make(chan struct{})
	go func() {
		manager.sfuClose(p, "stale-close", IntercomSFUClosePayload{SessionHandle: handle})
		close(done)
	}()
	<-provider.closeStarted
	close(provider.closeRelease)
	released = true
	waitUntil(t, time.Second, func() bool {
		manager.mu.Lock()
		defer manager.mu.Unlock()
		_, cached := engineer.responseCache["stale-close"]
		return cached
	})
	fresh := replaceIntercomMemberOnSamePeer(t, manager, engineer)
	p.writeMu.Unlock()
	writeLocked = false
	<-done
	manager.mu.Lock()
	_, crossed := fresh.responseCache["stale-close"]
	manager.mu.Unlock()
	if crossed {
		t.Fatal("delayed close success was cached in the fresh membership")
	}
	assertOnlySentinelAfterStaleBrokerOperation(t, p, clientConn)
}

func replaceIntercomMemberOnSamePeer(t *testing.T, manager *intercomManager, old *intercomMember) *intercomMember {
	t.Helper()
	manager.mu.Lock()
	p := old.peer
	group := old.group
	manager.removeMemberLocked(old)
	fresh, err := manager.newMemberLocked(group, p, old.role, old.displayName+" fresh", old.originRoomKey, old.driverKey, old.assignmentDriverKey)
	manager.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	return fresh
}

func assertOnlySentinelAfterStaleBrokerOperation(t *testing.T, p *peer, clientConn interface {
	SetReadDeadline(time.Time) error
	ReadJSON(any) error
}) {
	t.Helper()
	if err := p.sendJSON(Message{Type: TypeHeartbeat}); err != nil {
		t.Fatal(err)
	}
	if err := clientConn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	var message Message
	if err := clientConn.ReadJSON(&message); err != nil || message.Type != TypeHeartbeat {
		t.Fatalf("stale broker response crossed membership before sentinel: %+v, %v", message, err)
	}
}

func readExpectedIntercomType(t *testing.T, clientConn interface {
	SetReadDeadline(time.Time) error
	ReadJSON(any) error
}, want string) {
	t.Helper()
	if err := clientConn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	var message Message
	if err := clientConn.ReadJSON(&message); err != nil || message.Type != want {
		t.Fatalf("message = %+v, %v; want %s", message, err, want)
	}
}

func brokerHandle(t *testing.T, manager *intercomManager, member *intercomMember) string {
	t.Helper()
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if member.sfu == nil || member.sfu.handle == "" || member.sfu.providerID == "" || member.sfu.handle == member.sfu.providerID {
		t.Fatalf("broker session = %+v", member.sfu)
	}
	return member.sfu.handle
}

func cachedIntercomError(t *testing.T, manager *intercomManager, member *intercomMember, requestID string) IntercomErrorPayload {
	t.Helper()
	manager.mu.Lock()
	message, ok := member.responseCache[requestID]
	manager.mu.Unlock()
	if !ok || message.Type != TypeIntercomError {
		t.Fatalf("cached response %q = %+v", requestID, message)
	}
	var payload IntercomErrorPayload
	if err := json.Unmarshal(message.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}
