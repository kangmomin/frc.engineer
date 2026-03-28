package main

import (
	"flag"
	"fmt"
	"log"
	"time"

	"frc.engineer/internal/strategydata"
)

func main() {
	inputRoot := flag.String("in", "data/strategy", "source strategy data directory")
	outputRoot := flag.String("out", "data/strategy/normalized", "normalized output directory")
	flag.Parse()

	manifest, err := strategydata.NormalizeDirectory(*inputRoot, *outputRoot, time.Now())
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("normalized %d tracks into %s\n", manifest.TrackCount, *outputRoot)
}
