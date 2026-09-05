//go:build !windows

package races

import (
	"io"
	"os"
)

func openReplayFile(name string) (io.ReadCloser, error) {
	return os.Open(name)
}
