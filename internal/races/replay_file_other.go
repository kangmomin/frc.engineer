//go:build !windows

package races

import (
	"context"
	"io"
	"os"
)

func openReplayFile(name string) (io.ReadCloser, error) {
	return openReplayFileContext(context.Background(), name)
}

func openReplayFileContext(ctx context.Context, name string) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return os.Open(name)
}
