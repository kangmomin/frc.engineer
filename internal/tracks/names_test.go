package tracks

import "testing"

func TestTrackSearchNamesAndFormatPairing(t *testing.T) {
	names := TrackSearchNames(5)
	if len(names) == 0 || names[0] != "Monaco" {
		t.Fatalf("TrackSearchNames(5) = %#v", names)
	}
	if !contains(names, "monte_carlo") {
		t.Fatalf("TrackSearchNames(5) = %#v, want Monte Carlo alias", names)
	}
	if TrackSearchNames(99) != nil {
		t.Fatal("unknown track has search names")
	}

	for _, tt := range []struct {
		trackID int
		format  string
		want    bool
	}{
		{5, "F1 25", true},
		{5, "F1 26", true},
		{39, "F1 25", false},
		{39, "F1 26", true},
		{99, "F1 26", false},
		{5, "F1 24", false},
	} {
		if got := IsSupportedTrackFormat(tt.trackID, tt.format); got != tt.want {
			t.Errorf("IsSupportedTrackFormat(%d, %q) = %v, want %v", tt.trackID, tt.format, got, tt.want)
		}
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
