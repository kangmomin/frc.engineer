package races

import (
	"errors"
	"io"
	"os"
)

// Windows can reject replacement of an open destination, even with delete
// sharing. Copy locally while the storage lock is held, then stream the copy
// so slow clients cannot block Save's rename. Memory use stays bounded.
func openReplayFile(name string) (io.ReadCloser, error) {
	source, err := os.Open(name)
	if err != nil {
		return nil, err
	}
	file, err := os.CreateTemp("", "frc-replay-*.json")
	if err != nil {
		return nil, errors.Join(err, source.Close())
	}
	snapshot := &replaySnapshot{File: file}
	_, copyErr := io.Copy(file, source)
	if err := errors.Join(copyErr, source.Close()); err != nil {
		return nil, errors.Join(err, snapshot.Close())
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, errors.Join(err, snapshot.Close())
	}
	return snapshot, nil
}

type replaySnapshot struct {
	*os.File
}

func (s *replaySnapshot) Close() error {
	closeErr := s.File.Close()
	return errors.Join(closeErr, os.Remove(s.File.Name()))
}
