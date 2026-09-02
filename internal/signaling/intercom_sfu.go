package signaling

import (
	"context"
	"sort"
	"strings"

	"frc.engineer/internal/realtimesfu"
)

type intercomBrokerState uint8

const (
	intercomBrokerStable intercomBrokerState = iota
	intercomBrokerAwaitingAnswer
)

type intercomBrokerSession struct {
	handle           string
	providerID       string
	generation       uint64
	state            intercomBrokerState
	invalid          bool
	reconcilePending bool
	local            map[string]*intercomPublished
	remote           map[string]*intercomRemoteBinding
	inactiveMIDs     []string
}

type intercomPublished struct {
	trackKey          string
	providerTrackName string
	providerSessionID string
	mid               string
	class             IntercomTrackClass
	targetDriverKey   string
	participantID     string
}

type intercomRemoteBinding struct {
	source *intercomPublished
	mid    string
}

type intercomBrokerOperation struct {
	member          *intercomMember
	peer            *peer
	generation      uint64
	session         *intercomBrokerSession
	sessionDetached bool
	dispatchEpoch   uint64
	dispatchBound   bool
}

func newIntercomBrokerOperation(member *intercomMember, p *peer, generation uint64, bindings []intercomDispatchBinding) intercomBrokerOperation {
	operation := intercomBrokerOperation{member: member, peer: p, generation: generation}
	if len(bindings) > 0 {
		operation.dispatchEpoch = bindings[0].epoch
		operation.dispatchBound = true
	}
	return operation
}

func (m *intercomManager) sfuSessionNew(p *peer, requestID string, bindings ...intercomDispatchBinding) {
	member, provider, generation, ok, bindingCurrent := m.currentBrokerMemberBound(p, bindings)
	if !bindingCurrent {
		return
	}
	if !ok {
		if len(bindings) > 0 {
			m.respondBrokerError(newIntercomBrokerOperation(nil, p, 0, bindings), requestID, "not_joined", "intercom membership required", false)
			return
		}
		m.respondError(p, requestID, "not_joined", "intercom membership required", false)
		return
	}
	operation := newIntercomBrokerOperation(member, p, generation, bindings)
	if provider == nil {
		m.respondBrokerError(operation, requestID, "sfu_unavailable", "intercom media is not configured", false)
		return
	}

	member.opMu.Lock()
	defer member.opMu.Unlock()
	if !m.memberGenerationCurrent(member, p, generation) {
		return
	}
	handle, err := m.randomHex(16)
	if err != nil {
		m.respondBrokerError(operation, requestID, "sfu_unavailable", "secure intercom media credentials unavailable", true)
		return
	}
	ctx, cancel := withIntercomProviderTimeout()
	providerSession, err := provider.NewSession(ctx)
	cancel()
	if err != nil {
		m.respondBrokerError(operation, requestID, "sfu_unavailable", "intercom media is temporarily unavailable", true)
		return
	}

	m.mu.Lock()
	if !m.memberGenerationCurrentLocked(member, p, generation) {
		m.mu.Unlock()
		return
	}
	oldSession := member.sfu
	member.sfu = &intercomBrokerSession{
		handle:     handle,
		providerID: providerSession.SessionID,
		generation: generation,
		state:      intercomBrokerStable,
		local:      make(map[string]*intercomPublished),
		remote:     make(map[string]*intercomRemoteBinding),
	}
	operation.session = member.sfu
	if oldSession != nil && len(oldSession.local) > 0 {
		member.group.topologyRevision++
		member.group.revision++
	}
	response := intercomMessage(TypeIntercomSFUSession, requestID, IntercomSFUSessionPayload{SessionHandle: member.sfu.handle})
	recipients := m.stateRecipientsLocked(member.group, "")
	snapshot := m.snapshotLocked(member.group)
	m.mu.Unlock()

	if oldSession != nil {
		m.closeBrokerSession(provider, oldSession)
	}
	if m.respondBrokerOperation(operation, response) {
		m.queueSnapshot(recipients, snapshot)
	}
}

func (m *intercomManager) sfuPublish(p *peer, requestID string, payload IntercomSFUPublishPayload, bindings ...intercomDispatchBinding) {
	member, provider, generation, ok, bindingCurrent := m.currentBrokerMemberBound(p, bindings)
	if !bindingCurrent {
		return
	}
	if !ok {
		if len(bindings) > 0 {
			m.respondBrokerError(newIntercomBrokerOperation(nil, p, 0, bindings), requestID, "not_joined", "intercom membership required", false)
			return
		}
		m.respondError(p, requestID, "not_joined", "intercom membership required", false)
		return
	}
	operation := newIntercomBrokerOperation(member, p, generation, bindings)
	if provider == nil {
		m.respondBrokerError(operation, requestID, "sfu_unavailable", "intercom media is not configured", false)
		return
	}

	member.opMu.Lock()
	defer member.opMu.Unlock()
	m.mu.Lock()
	if !m.memberGenerationCurrentLocked(member, p, generation) || member.sfu == nil || member.sfu.generation != generation || member.sfu.invalid || member.sfu.handle != payload.SessionHandle {
		m.mu.Unlock()
		m.respondBrokerError(operation, requestID, "session_invalid", "create a new intercom media session", false)
		return
	}
	session := member.sfu
	operation.session = session
	if session.state != intercomBrokerStable {
		session.reconcilePending = true
		m.mu.Unlock()
		m.respondBrokerError(operation, requestID, "negotiation_in_progress", "intercom media negotiation is already in progress", true)
		return
	}
	if !validIntercomPublishLocked(member, payload) {
		m.mu.Unlock()
		m.respondBrokerError(operation, requestID, "unauthorized_track", "published tracks are not authorized", false)
		return
	}
	providerTracks := make([]realtimesfu.Track, 0, len(payload.Tracks))
	pending := make([]*intercomPublished, 0, len(payload.Tracks))
	for _, track := range payload.Tracks {
		providerToken, randomErr := m.randomHex(12)
		trackKey, trackErr := m.randomHex(16)
		if randomErr != nil || trackErr != nil {
			m.mu.Unlock()
			m.respondBrokerError(operation, requestID, "sfu_unavailable", "secure intercom media credentials unavailable", true)
			return
		}
		providerName := "pub-" + providerToken
		providerTracks = append(providerTracks, realtimesfu.Track{Location: "local", MID: track.MID, TrackName: providerName, Kind: "audio"})
		pending = append(pending, &intercomPublished{
			trackKey:          trackKey,
			providerTrackName: providerName,
			providerSessionID: session.providerID,
			mid:               track.MID,
			class:             track.Class,
			targetDriverKey:   track.TargetDriverKey,
			participantID:     member.id,
		})
	}
	providerID := session.providerID
	m.mu.Unlock()

	description := realtimesfu.SessionDescription{Type: string(payload.SessionDescription.Type), SDP: payload.SessionDescription.SDP}
	ctx, cancel := withIntercomProviderTimeout()
	providerResponse, err := provider.NewTracks(ctx, providerID, realtimesfu.TracksRequest{SessionDescription: &description, Tracks: providerTracks})
	cancel()
	if err != nil || !publishedProviderResponseMatches(providerResponse, pending) {
		m.invalidateBroker(member, p, generation, session)
		m.respondBrokerError(operation, requestID, "broker_rebuild_required", "rebuild the intercom media session", true)
		return
	}

	m.mu.Lock()
	if !m.brokerCurrentLocked(member, p, generation, session) {
		m.mu.Unlock()
		m.closeProviderMIDs(provider, providerID, midsFromPublished(pending))
		return
	}
	for _, track := range pending {
		session.local[track.trackKey] = track
	}
	needsAnswer := providerNeedsAnswer(providerResponse)
	if needsAnswer {
		session.state = intercomBrokerAwaitingAnswer
	}
	member.group.topologyRevision++
	member.group.revision++
	responseTracks := make([]IntercomPublishedTrack, 0, len(pending))
	for _, track := range pending {
		responseTracks = append(responseTracks, IntercomPublishedTrack{MID: track.mid, TrackKey: track.trackKey, Class: track.class})
	}
	response := intercomMessage(TypeIntercomSFUPublished, requestID, IntercomSFUPublishedPayload{
		SessionDescription:             fromProviderDescription(providerResponse.SessionDescription),
		RequiresImmediateRenegotiation: needsAnswer,
		Tracks:                         responseTracks,
	})
	recipients := m.stateRecipientsLocked(member.group, "")
	snapshot := m.snapshotLocked(member.group)
	m.mu.Unlock()
	if m.respondBrokerOperation(operation, response) {
		m.queueSnapshot(recipients, snapshot)
	}
}

func (m *intercomManager) sfuSubscribe(p *peer, requestID string, payload IntercomSFUSubscribePayload, bindings ...intercomDispatchBinding) {
	member, provider, generation, ok, bindingCurrent := m.currentBrokerMemberBound(p, bindings)
	if !bindingCurrent {
		return
	}
	if !ok {
		if len(bindings) > 0 {
			m.respondBrokerError(newIntercomBrokerOperation(nil, p, 0, bindings), requestID, "not_joined", "intercom membership required", false)
			return
		}
		m.respondError(p, requestID, "not_joined", "intercom membership required", false)
		return
	}
	operation := newIntercomBrokerOperation(member, p, generation, bindings)
	if provider == nil {
		m.respondBrokerError(operation, requestID, "sfu_unavailable", "intercom media is not configured", false)
		return
	}

	member.opMu.Lock()
	defer member.opMu.Unlock()
	m.mu.Lock()
	if !m.memberGenerationCurrentLocked(member, p, generation) || member.sfu == nil || member.sfu.generation != generation || member.sfu.invalid || member.sfu.handle != payload.SessionHandle {
		m.mu.Unlock()
		m.respondBrokerError(operation, requestID, "session_invalid", "create a new intercom media session", false)
		return
	}
	session := member.sfu
	operation.session = session
	if session.state != intercomBrokerStable {
		session.reconcilePending = true
		m.mu.Unlock()
		m.respondBrokerError(operation, requestID, "negotiation_in_progress", "intercom media negotiation is already in progress", true)
		return
	}
	desired := m.authorizedSubscriptionsLocked(member)
	topologyRevision := member.group.topologyRevision
	current := cloneRemoteBindings(session.remote)
	inactive := append([]string(nil), session.inactiveMIDs...)
	providerID := session.providerID
	m.mu.Unlock()

	removedKeys := make([]string, 0)
	removedMIDs := make([]string, 0)
	for trackKey, binding := range current {
		if desired[trackKey] == nil {
			removedKeys = append(removedKeys, trackKey)
			removedMIDs = append(removedMIDs, binding.mid)
			delete(current, trackKey)
		}
	}
	sort.Strings(removedKeys)
	var negotiation *realtimesfu.TracksResponse
	if len(removedMIDs) > 0 {
		ctx, cancel := withIntercomProviderTimeout()
		providerResponse, err := provider.CloseTracks(ctx, providerID, closeRequest(removedMIDs))
		cancel()
		if err != nil || providerResponse.RequiresImmediateRenegotiation || providerResponse.SessionDescription != nil {
			m.invalidateBroker(member, p, generation, session)
			m.respondBrokerError(operation, requestID, "broker_rebuild_required", "rebuild the intercom media session", true)
			return
		}
		if !m.subscriptionPlanCurrent(member, p, generation, session, topologyRevision, desired) {
			m.invalidateBroker(member, p, generation, session)
			m.respondBrokerError(operation, requestID, "broker_rebuild_required", "subscription topology changed; rebuild the intercom media session", true)
			return
		}
		inactive = append(inactive, removedMIDs...)
	}

	missing := make([]*intercomPublished, 0)
	for trackKey, source := range desired {
		if current[trackKey] == nil {
			missing = append(missing, source)
		}
	}
	sort.Slice(missing, func(i, j int) bool { return missing[i].trackKey < missing[j].trackKey })

	allocatedMIDs := make([]string, 0)
	updatedMIDs := make([]string, 0)
	reuseCount := len(missing)
	if reuseCount > len(inactive) {
		reuseCount = len(inactive)
	}
	if reuseCount > 0 {
		updates := make([]realtimesfu.UpdateTrack, 0, reuseCount)
		for index := 0; index < reuseCount; index++ {
			source := missing[index]
			mid := inactive[len(inactive)-1-index]
			updates = append(updates, realtimesfu.UpdateTrack{Location: "remote", MID: mid, SessionID: source.providerSessionID, TrackName: source.providerTrackName})
			updatedMIDs = append(updatedMIDs, mid)
			current[source.trackKey] = &intercomRemoteBinding{source: source, mid: mid}
		}
		inactive = inactive[:len(inactive)-reuseCount]
		ctx, cancel := withIntercomProviderTimeout()
		response, err := provider.UpdateTracks(ctx, providerID, realtimesfu.UpdateTracksRequest{Tracks: updates})
		cancel()
		needsAnswer, validNegotiation := providerOfferState(response)
		if err != nil || !validNegotiation {
			m.closeProviderMIDs(provider, providerID, updatedMIDs)
			m.invalidateBroker(member, p, generation, session)
			m.respondBrokerError(operation, requestID, "broker_rebuild_required", "rebuild the intercom media session", true)
			return
		}
		if !m.subscriptionPlanCurrent(member, p, generation, session, topologyRevision, desired) {
			m.closeProviderMIDs(provider, providerID, updatedMIDs)
			m.invalidateBroker(member, p, generation, session)
			m.respondBrokerError(operation, requestID, "broker_rebuild_required", "subscription topology changed; rebuild the intercom media session", true)
			return
		}
		if needsAnswer {
			negotiation = &response
			if reuseCount < len(missing) {
				m.markReconcilePending(member, p, generation, session)
			}
		}
	}

	remaining := missing[reuseCount:]
	if len(remaining) > 0 && negotiation == nil {
		tracks := make([]realtimesfu.Track, 0, len(remaining))
		for _, source := range remaining {
			tracks = append(tracks, realtimesfu.Track{Location: "remote", SessionID: source.providerSessionID, TrackName: source.providerTrackName, Kind: "audio"})
		}
		ctx, cancel := withIntercomProviderTimeout()
		response, err := provider.NewTracks(ctx, providerID, realtimesfu.TracksRequest{Tracks: tracks})
		cancel()
		needsAnswer, validNegotiation := providerOfferState(response)
		if err != nil || !validNegotiation || !needsAnswer || len(response.Tracks) != len(remaining) {
			m.closeProviderMIDs(provider, providerID, updatedMIDs)
			m.invalidateBroker(member, p, generation, session)
			m.respondBrokerError(operation, requestID, "broker_rebuild_required", "rebuild the intercom media session", true)
			return
		}
		usedMIDs := make(map[string]bool)
		remainingByName := make(map[string]*intercomPublished, len(remaining))
		for _, source := range remaining {
			remainingByName[source.providerTrackName] = source
		}
		for _, result := range response.Tracks {
			source := remainingByName[result.TrackName]
			if result.MID == "" || usedMIDs[result.MID] || source == nil {
				m.closeProviderMIDs(provider, providerID, append(updatedMIDs, allocatedMIDs...))
				m.invalidateBroker(member, p, generation, session)
				m.respondBrokerError(operation, requestID, "broker_rebuild_required", "rebuild the intercom media session", true)
				return
			}
			usedMIDs[result.MID] = true
			allocatedMIDs = append(allocatedMIDs, result.MID)
			current[source.trackKey] = &intercomRemoteBinding{source: source, mid: result.MID}
		}
		if !m.subscriptionPlanCurrent(member, p, generation, session, topologyRevision, desired) {
			m.closeProviderMIDs(provider, providerID, append(updatedMIDs, allocatedMIDs...))
			m.invalidateBroker(member, p, generation, session)
			m.respondBrokerError(operation, requestID, "broker_rebuild_required", "subscription topology changed; rebuild the intercom media session", true)
			return
		}
		negotiation = &response
	}

	m.mu.Lock()
	planCurrent := m.brokerCurrentLocked(member, p, generation, session) && member.group.topologyRevision == topologyRevision && sameSubscriptionPlan(desired, m.authorizedSubscriptionsLocked(member))
	if !planCurrent {
		m.mu.Unlock()
		m.closeProviderMIDs(provider, providerID, append(updatedMIDs, allocatedMIDs...))
		m.invalidateBroker(member, p, generation, session)
		m.respondBrokerError(operation, requestID, "broker_rebuild_required", "subscription topology changed; rebuild the intercom media session", true)
		return
	}
	session.remote = current
	session.inactiveMIDs = inactive
	responsePayload := IntercomSFUSubscribedPayload{Tracks: remoteResponseTracks(current), RemovedTrackKeys: removedKeys}
	if negotiation != nil {
		responsePayload.SessionDescription = fromProviderDescription(negotiation.SessionDescription)
		responsePayload.RequiresImmediateRenegotiation = providerNeedsAnswer(*negotiation)
		if responsePayload.RequiresImmediateRenegotiation {
			session.state = intercomBrokerAwaitingAnswer
		}
	}
	response := intercomMessage(TypeIntercomSFUSubscribed, requestID, responsePayload)
	m.mu.Unlock()
	m.respondBrokerOperation(operation, response)
}

func (m *intercomManager) sfuRenegotiate(p *peer, requestID string, payload IntercomSFURenegotiatePayload, bindings ...intercomDispatchBinding) {
	member, provider, generation, ok, bindingCurrent := m.currentBrokerMemberBound(p, bindings)
	if !bindingCurrent {
		return
	}
	if !ok {
		if len(bindings) > 0 {
			m.respondBrokerError(newIntercomBrokerOperation(nil, p, 0, bindings), requestID, "session_invalid", "create a new intercom media session", false)
			return
		}
		m.respondError(p, requestID, "session_invalid", "create a new intercom media session", false)
		return
	}
	operation := newIntercomBrokerOperation(member, p, generation, bindings)
	if provider == nil {
		m.respondBrokerError(operation, requestID, "session_invalid", "create a new intercom media session", false)
		return
	}
	if !validIntercomDescription(payload.SessionDescription) {
		m.respondBrokerError(operation, requestID, "invalid_request", "invalid session description", false)
		return
	}
	member.opMu.Lock()
	defer member.opMu.Unlock()
	m.mu.Lock()
	if !m.memberGenerationCurrentLocked(member, p, generation) || member.sfu == nil || member.sfu.generation != generation || member.sfu.invalid || member.sfu.handle != payload.SessionHandle {
		m.mu.Unlock()
		m.respondBrokerError(operation, requestID, "session_invalid", "create a new intercom media session", false)
		return
	}
	session := member.sfu
	operation.session = session
	if session.state != intercomBrokerAwaitingAnswer || payload.SessionDescription.Type != IntercomSDPAnswer {
		m.mu.Unlock()
		m.respondBrokerError(operation, requestID, "invalid_negotiation_state", "no intercom offer is awaiting an answer", false)
		return
	}
	providerID := session.providerID
	m.mu.Unlock()

	ctx, cancel := withIntercomProviderTimeout()
	response, err := provider.Renegotiate(ctx, providerID, realtimesfu.SessionDescription{Type: string(payload.SessionDescription.Type), SDP: payload.SessionDescription.SDP})
	cancel()
	if err != nil || response.RequiresImmediateRenegotiation || response.SessionDescription != nil || len(response.Tracks) != 0 {
		m.invalidateBroker(member, p, generation, session)
		m.respondBrokerError(operation, requestID, "broker_rebuild_required", "rebuild the intercom media session", true)
		return
	}
	m.mu.Lock()
	if !m.brokerCurrentLocked(member, p, generation, session) {
		m.mu.Unlock()
		return
	}
	session.state = intercomBrokerStable
	reconcilePending := session.reconcilePending
	session.reconcilePending = false
	var recipients []*intercomMember
	var snapshot IntercomSnapshot
	if reconcilePending {
		member.group.topologyRevision++
		member.group.revision++
		recipients = m.stateRecipientsLocked(member.group, "")
		snapshot = m.snapshotLocked(member.group)
	}
	responseMessage := intercomMessage(TypeIntercomSFURenegotiated, requestID, IntercomSFURenegotiatedPayload{})
	m.mu.Unlock()
	if m.respondBrokerOperation(operation, responseMessage) && reconcilePending {
		m.queueSnapshot(recipients, snapshot)
	}
}

func (m *intercomManager) sfuClose(p *peer, requestID string, payload IntercomSFUClosePayload, bindings ...intercomDispatchBinding) {
	member, provider, generation, ok, bindingCurrent := m.currentBrokerMemberBound(p, bindings)
	if !bindingCurrent {
		return
	}
	if !ok {
		if len(bindings) > 0 {
			m.respondBrokerError(newIntercomBrokerOperation(nil, p, 0, bindings), requestID, "not_joined", "intercom membership required", false)
			return
		}
		m.respondError(p, requestID, "not_joined", "intercom membership required", false)
		return
	}
	operation := newIntercomBrokerOperation(member, p, generation, bindings)
	member.opMu.Lock()
	defer member.opMu.Unlock()
	m.mu.Lock()
	if !m.memberGenerationCurrentLocked(member, p, generation) || member.sfu == nil || member.sfu.generation != generation || member.sfu.handle != payload.SessionHandle {
		m.mu.Unlock()
		m.respondBrokerError(operation, requestID, "session_invalid", "create a new intercom media session", false)
		return
	}
	session := member.sfu
	operation.session = session
	member.sfu = nil
	operation.sessionDetached = true
	if len(session.local) > 0 {
		member.group.topologyRevision++
		member.group.revision++
	}
	response := intercomMessage(TypeIntercomSFUClosed, requestID, IntercomSFUClosedPayload{})
	recipients := m.stateRecipientsLocked(member.group, "")
	snapshot := m.snapshotLocked(member.group)
	m.mu.Unlock()
	if provider != nil {
		m.closeBrokerSession(provider, session)
	}
	if m.respondBrokerOperation(operation, response) {
		m.queueSnapshot(recipients, snapshot)
	}
}

func (m *intercomManager) currentBrokerMember(p *peer) (*intercomMember, realtimesfu.Provider, uint64, bool) {
	member, provider, generation, ok, _ := m.currentBrokerMemberBound(p, nil)
	return member, provider, generation, ok
}

func (m *intercomManager) currentBrokerMemberBound(p *peer, bindings []intercomDispatchBinding) (*intercomMember, realtimesfu.Provider, uint64, bool, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(bindings) > 0 && !m.dispatchBindingCurrentLocked(p, bindings[0]) {
		return nil, m.provider, 0, false, false
	}
	member := m.byPeer[p]
	if p == nil || p.inactive.Load() || member == nil || member.peer != p || !member.online {
		return nil, m.provider, 0, false, true
	}
	return member, m.provider, member.generation, true, true
}

func (m *intercomManager) memberGenerationCurrent(member *intercomMember, p *peer, generation uint64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.memberGenerationCurrentLocked(member, p, generation)
}

func (m *intercomManager) memberGenerationCurrentLocked(member *intercomMember, p *peer, generation uint64) bool {
	return member != nil && p != nil && !p.inactive.Load() && member.online && member.peer == p && member.generation == generation && m.byPeer[p] == member
}

func (m *intercomManager) brokerCurrentLocked(member *intercomMember, p *peer, generation uint64, session *intercomBrokerSession) bool {
	return session != nil && session.generation == generation && m.memberGenerationCurrentLocked(member, p, generation) && member.sfu == session && !session.invalid
}

func (m *intercomManager) subscriptionPlanCurrent(member *intercomMember, p *peer, generation uint64, session *intercomBrokerSession, topologyRevision uint64, expected map[string]*intercomPublished) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.brokerCurrentLocked(member, p, generation, session) && member.group.topologyRevision == topologyRevision && sameSubscriptionPlan(expected, m.authorizedSubscriptionsLocked(member))
}

func (m *intercomManager) markReconcilePending(member *intercomMember, p *peer, generation uint64, session *intercomBrokerSession) {
	m.mu.Lock()
	if m.brokerCurrentLocked(member, p, generation, session) {
		session.reconcilePending = true
	}
	m.mu.Unlock()
}

func (m *intercomManager) invalidateBroker(member *intercomMember, p *peer, generation uint64, session *intercomBrokerSession) {
	var recipients []*intercomMember
	var snapshot IntercomSnapshot
	m.mu.Lock()
	if m.brokerCurrentLocked(member, p, generation, session) {
		session.invalid = true
		if len(session.local) > 0 {
			member.group.topologyRevision++
			member.group.revision++
			recipients = m.stateRecipientsLocked(member.group, "")
			snapshot = m.snapshotLocked(member.group)
		}
	}
	m.mu.Unlock()
	if len(recipients) > 0 {
		m.queueSnapshot(recipients, snapshot)
	}
}

func (m *intercomManager) closeMemberBroker(member *intercomMember) {
	if member == nil {
		return
	}
	member.opMu.Lock()
	defer member.opMu.Unlock()
	m.mu.Lock()
	session := member.sfu
	member.sfu = nil
	provider := m.provider
	m.mu.Unlock()
	if provider != nil && session != nil {
		m.closeBrokerSession(provider, session)
	}
}

func (m *intercomManager) closeDetachedBroker(member *intercomMember, provider realtimesfu.Provider, session *intercomBrokerSession) {
	if member == nil || provider == nil || session == nil {
		return
	}
	member.opMu.Lock()
	defer member.opMu.Unlock()
	m.closeBrokerSession(provider, session)
}

func (m *intercomManager) closeBrokerSession(provider realtimesfu.Provider, session *intercomBrokerSession) {
	if provider == nil || session == nil {
		return
	}
	mids := make([]string, 0, len(session.local)+len(session.remote)+len(session.inactiveMIDs))
	for _, track := range session.local {
		mids = append(mids, track.mid)
	}
	for _, binding := range session.remote {
		mids = append(mids, binding.mid)
	}
	mids = append(mids, session.inactiveMIDs...)
	m.closeProviderMIDs(provider, session.providerID, mids)
}

func (m *intercomManager) closeProviderMIDs(provider realtimesfu.Provider, providerID string, mids []string) {
	if len(mids) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), intercomProviderTimeout)
	defer cancel()
	_, _ = provider.CloseTracks(ctx, providerID, closeRequest(mids))
}

func (m *intercomManager) authorizedSubscriptionsLocked(member *intercomMember) map[string]*intercomPublished {
	result := make(map[string]*intercomPublished)
	for _, sourceMember := range member.group.members {
		if sourceMember == member || !sourceMember.online || sourceMember.sfu == nil || sourceMember.sfu.invalid {
			continue
		}
		for trackKey, published := range sourceMember.sfu.local {
			authorized := false
			switch member.role {
			case IntercomRoleDriver:
				authorized = (published.class == IntercomTrackDriverRadio && sourceMember.role == IntercomRoleEngineer && sourceMember.assignmentDriverKey == member.driverKey) ||
					(published.class == IntercomTrackChiefPrivate && published.targetDriverKey == member.driverKey)
			case IntercomRoleEngineer:
				authorized = (published.class == IntercomTrackEngineerBus && sourceMember.role != IntercomRoleDriver) ||
					(published.class == IntercomTrackDriverEngineer && sourceMember.driverKey == member.assignmentDriverKey)
			case IntercomRoleChief:
				authorized = published.class == IntercomTrackEngineerBus || published.class == IntercomTrackDriverChief
			}
			if authorized {
				result[trackKey] = published
			}
		}
	}
	return result
}

func validIntercomPublishLocked(member *intercomMember, payload IntercomSFUPublishPayload) bool {
	if !validIntercomDescription(payload.SessionDescription) || payload.SessionDescription.Type != IntercomSDPOffer || len(payload.Tracks) == 0 {
		return false
	}
	if strings.Contains(payload.SessionDescription.SDP, "m=video") || strings.Contains(payload.SessionDescription.SDP, "m=application") || !strings.Contains(payload.SessionDescription.SDP, "m=audio") {
		return false
	}
	seenMID := make(map[string]bool)
	seenRoute := make(map[string]bool)
	if member.sfu != nil {
		for _, existing := range member.sfu.local {
			seenMID[existing.mid] = true
			seenRoute[string(existing.class)+":"+existing.targetDriverKey] = true
		}
	}
	for _, track := range payload.Tracks {
		if track.MID == "" || len(track.MID) > 32 || seenMID[track.MID] || !strings.Contains(payload.SessionDescription.SDP, "a=mid:"+track.MID) {
			return false
		}
		seenMID[track.MID] = true
		route := string(track.Class) + ":" + track.TargetDriverKey
		if seenRoute[route] {
			return false
		}
		seenRoute[route] = true
		switch member.role {
		case IntercomRoleDriver:
			if track.TargetDriverKey != "" || (track.Class != IntercomTrackDriverEngineer && track.Class != IntercomTrackDriverChief) || len(payload.Tracks) > 2 {
				return false
			}
		case IntercomRoleEngineer:
			if track.TargetDriverKey != "" || (track.Class != IntercomTrackEngineerBus && track.Class != IntercomTrackDriverRadio) || len(payload.Tracks) > 2 {
				return false
			}
		case IntercomRoleChief:
			if len(payload.Tracks) > maxIntercomDrivers+1 {
				return false
			}
			if track.Class == IntercomTrackEngineerBus {
				if track.TargetDriverKey != "" {
					return false
				}
			} else if track.Class != IntercomTrackChiefPrivate || member.group == nil || member.group.members == nil || !driverExistsLocked(member.group, track.TargetDriverKey) {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func validIntercomDescription(description IntercomSessionDescription) bool {
	return (description.Type == IntercomSDPOffer || description.Type == IntercomSDPAnswer) && description.SDP != "" && len(description.SDP) <= maxIntercomSDPBytes
}

func driverExistsLocked(group *intercomGroup, driverKey string) bool {
	if driverKey == "" {
		return false
	}
	for _, member := range group.members {
		if member.online && member.role == IntercomRoleDriver && member.driverKey == driverKey {
			return true
		}
	}
	return false
}

func cloneRemoteBindings(source map[string]*intercomRemoteBinding) map[string]*intercomRemoteBinding {
	result := make(map[string]*intercomRemoteBinding, len(source))
	for key, binding := range source {
		copyBinding := *binding
		result[key] = &copyBinding
	}
	return result
}

func remoteResponseTracks(bindings map[string]*intercomRemoteBinding) []IntercomSubscribedTrack {
	result := make([]IntercomSubscribedTrack, 0, len(bindings))
	for trackKey, binding := range bindings {
		result = append(result, IntercomSubscribedTrack{
			MID:             binding.mid,
			TrackKey:        trackKey,
			ParticipantID:   binding.source.participantID,
			Class:           binding.source.class,
			TargetDriverKey: binding.source.targetDriverKey,
		})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].TrackKey < result[j].TrackKey })
	return result
}

func closeRequest(mids []string) realtimesfu.CloseTracksRequest {
	tracks := make([]realtimesfu.CloseTrack, 0, len(mids))
	seen := make(map[string]bool)
	for _, mid := range mids {
		if mid != "" && !seen[mid] {
			seen[mid] = true
			tracks = append(tracks, realtimesfu.CloseTrack{MID: mid})
		}
	}
	return realtimesfu.CloseTracksRequest{Tracks: tracks, Force: true}
}

func midsFromPublished(tracks []*intercomPublished) []string {
	result := make([]string, 0, len(tracks))
	for _, track := range tracks {
		result = append(result, track.mid)
	}
	return result
}

func fromProviderDescription(description *realtimesfu.SessionDescription) *IntercomSessionDescription {
	if description == nil {
		return nil
	}
	return &IntercomSessionDescription{Type: IntercomSDPType(description.Type), SDP: description.SDP}
}

func providerNeedsAnswer(response realtimesfu.TracksResponse) bool {
	return response.RequiresImmediateRenegotiation || (response.SessionDescription != nil && response.SessionDescription.Type == "offer")
}

func providerOfferState(response realtimesfu.TracksResponse) (needsAnswer, valid bool) {
	if response.SessionDescription == nil {
		return false, !response.RequiresImmediateRenegotiation
	}
	if response.SessionDescription.Type != "offer" {
		return false, false
	}
	return true, true
}

func sameSubscriptionPlan(left, right map[string]*intercomPublished) bool {
	if len(left) != len(right) {
		return false
	}
	for trackKey, expected := range left {
		actual := right[trackKey]
		if actual == nil || expected == nil || actual != expected || actual.providerSessionID != expected.providerSessionID || actual.providerTrackName != expected.providerTrackName {
			return false
		}
	}
	return true
}

func publishedProviderResponseMatches(response realtimesfu.TracksResponse, tracks []*intercomPublished) bool {
	if len(response.Tracks) != len(tracks) || response.RequiresImmediateRenegotiation || response.SessionDescription == nil || response.SessionDescription.Type != "answer" {
		return false
	}
	expected := make(map[string]string, len(tracks))
	for _, track := range tracks {
		expected[track.providerTrackName] = track.mid
	}
	for _, result := range response.Tracks {
		mid, ok := expected[result.TrackName]
		if !ok || result.MID != mid {
			return false
		}
		delete(expected, result.TrackName)
	}
	return len(expected) == 0
}

func (m *intercomManager) brokerOperationCurrentLocked(operation intercomBrokerOperation) bool {
	if operation.dispatchBound && (operation.peer == nil || operation.peer.intercomMembershipEpoch.Load() != operation.dispatchEpoch) {
		return false
	}
	if operation.member == nil {
		return operation.dispatchBound && operation.peer != nil && !operation.peer.inactive.Load() && m.byPeer[operation.peer] == nil
	}
	if !m.memberGenerationCurrentLocked(operation.member, operation.peer, operation.generation) {
		return false
	}
	if operation.session == nil {
		return true
	}
	if operation.session.generation != operation.generation {
		return false
	}
	if operation.sessionDetached {
		return operation.member.sfu == nil
	}
	return operation.member.sfu == operation.session
}

func (m *intercomManager) respondBrokerOperation(operation intercomBrokerOperation, response Message) bool {
	m.mu.Lock()
	current := m.brokerOperationCurrentLocked(operation)
	if current {
		m.cacheResponseLocked(operation.member, response)
	}
	m.mu.Unlock()
	if !current || operation.peer == nil || operation.peer.conn == nil || operation.peer.writeMu == nil {
		return current
	}

	operation.peer.writeMu.Lock()
	defer operation.peer.writeMu.Unlock()
	m.mu.Lock()
	current = m.brokerOperationCurrentLocked(operation)
	m.mu.Unlock()
	if !current {
		return false
	}
	_ = operation.peer.writeJSONLocked(response)
	return true
}

func (m *intercomManager) respondBrokerError(operation intercomBrokerOperation, requestID, code, message string, retryable bool) bool {
	return m.respondBrokerOperation(operation, intercomMessage(TypeIntercomError, requestID, IntercomErrorPayload{Code: code, Message: message, Retryable: retryable}))
}

func (m *intercomManager) respondProviderDispatchError(p *peer, requestID, code, message string, bindings []intercomDispatchBinding) {
	if len(bindings) == 0 {
		m.respondError(p, requestID, code, message, false)
		return
	}
	member, _, generation, _, bindingCurrent := m.currentBrokerMemberBound(p, bindings)
	if !bindingCurrent {
		return
	}
	m.respondBrokerError(newIntercomBrokerOperation(member, p, generation, bindings), requestID, code, message, false)
}

func (m *intercomManager) respondError(p *peer, requestID, code, message string, retryable bool) {
	response := intercomMessage(TypeIntercomError, requestID, IntercomErrorPayload{Code: code, Message: message, Retryable: retryable})
	m.mu.Lock()
	if member := m.byPeer[p]; member != nil && member.peer == p {
		m.cacheResponseLocked(member, response)
	}
	m.mu.Unlock()
	if p != nil {
		_ = p.sendJSON(response)
	}
}
