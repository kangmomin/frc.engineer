//go:build !windows

package main

import "fmt"

func openConsole(_ string) {}
func closeConsole()        {}

func printProgress(status string, pct int) {
	if pct < 0 {
		fmt.Printf("  %s\n", status)
		return
	}
	fmt.Printf("  [%3d%%] %s\n", pct, status)
}
