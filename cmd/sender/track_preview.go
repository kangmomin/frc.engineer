package main

import (
	"errors"
	"os"

	"frc.engineer/internal/telemetry"
	"frc.engineer/internal/tracks"
)

type senderCurrentTrack struct {
	ID                 int    `json:"id"`
	Name               string `json:"name"`
	Filename           string `json:"filename,omitempty"`
	HasRecordedPreview bool   `json:"hasRecordedPreview"`
}

type senderCurrentTrackPreview struct {
	CurrentTrack *senderCurrentTrack          `json:"currentTrack,omitempty"`
	Available    bool                         `json:"available"`
	Preview      *tracks.RecordedTrackPreview `json:"preview,omitempty"`
}

func getCurrentTrack(processorState trackSessionProvider, trackStore *tracks.TrackStore) *senderCurrentTrack {
	session := processorState.currentSession()
	if session == nil {
		return nil
	}
	name := tracks.TrackDisplayName(session.TrackName)
	current := &senderCurrentTrack{
		ID:   session.TrackID,
		Name: name,
	}
	if info, _, ok := trackStore.FindRecordedFile(session.TrackName); ok {
		current.Filename = info.Filename
		current.HasRecordedPreview = true
	}
	return current
}

func getCurrentTrackPreview(processorState trackSessionProvider, trackStore *tracks.TrackStore) (*senderCurrentTrackPreview, error) {
	current := getCurrentTrack(processorState, trackStore)
	if current == nil {
		return &senderCurrentTrackPreview{}, nil
	}
	if !current.HasRecordedPreview {
		return &senderCurrentTrackPreview{
			CurrentTrack: current,
			Available:    false,
		}, nil
	}
	preview, err := trackStore.LoadRecordedPreview(current.Name)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &senderCurrentTrackPreview{
				CurrentTrack: current,
				Available:    false,
			}, nil
		}
		return nil, err
	}
	return &senderCurrentTrackPreview{
		CurrentTrack: current,
		Available:    preview != nil,
		Preview:      preview,
	}, nil
}

type trackSessionProvider interface {
	currentSession() *senderTrackSession
}

type senderTrackSession struct {
	TrackID   int
	TrackName string
}

type senderProcessorTrackState struct {
	processor *telemetry.Processor
}

func (s senderProcessorTrackState) currentSession() *senderTrackSession {
	state := s.processor.PitwallManager().BuildState()
	if state == nil || state.Session == nil {
		return nil
	}
	return &senderTrackSession{
		TrackID:   int(state.Session.TrackID),
		TrackName: state.Session.TrackName,
	}
}
