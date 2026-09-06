package main

import (
	"context"

	"frc.engineer/internal/dto"
	"frc.engineer/internal/races"
)

func streamRaceReplay(ctx context.Context, storage *races.FileStorage, requestID, raceID string, send func(dto.WSResponse) error) error {
	const maxChunkBytes = 48 * 1024
	batch := make([]races.ReplayFrame, 0, 8)
	frameCount := 0
	chunk := func(frames []races.ReplayFrame) dto.WSResponse {
		return dto.WSResponse{Type: dto.MessageTypeRaceReplayChunk, RequestID: requestID, Data: map[string]any{"frames": frames}}
	}
	flush := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if len(batch) == 0 {
			return nil
		}
		return send(chunk(batch))
	}
	err := storage.WalkReplayContext(ctx, raceID, func(meta races.ReplayStreamMeta) error {
		return send(dto.WSResponse{Type: dto.MessageTypeRaceReplayMeta, RequestID: requestID, Data: meta})
	}, func(frame races.ReplayFrame) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		tentative := append(batch, frame)
		payload, err := dto.MsgpackMarshal(chunk(tentative))
		if err != nil {
			return err
		}
		if len(batch) > 0 && len(payload) > maxChunkBytes {
			if err := flush(); err != nil {
				return err
			}
			batch = append(batch[:0], frame)
		} else {
			batch = tentative
		}
		frameCount++
		return nil
	})
	if err != nil {
		return err
	}
	if err := flush(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return send(dto.WSResponse{Type: dto.MessageTypeRaceReplayDone, RequestID: requestID, Data: map[string]any{"frameCount": frameCount}})
}
