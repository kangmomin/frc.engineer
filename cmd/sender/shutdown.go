package main

import (
	"bufio"
	"io"
)

// watchManagedShutdown reads the private pipe owned by Driver Pack. It must
// only run with FRC_MANAGED_STDIN=1: standalone GUI processes may have no stdin.
// EOF also requests a flush if the parent exits without sending a command.
func watchManagedShutdown(input io.Reader, cancel func()) {
	scanner := bufio.NewScanner(input)
	for scanner.Scan() {
		if scanner.Text() == "shutdown" {
			break
		}
	}
	cancel()
}
