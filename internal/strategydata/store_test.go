package strategydata

import "testing"

func TestTrackByNameResolvesTelemetryAliases(t *testing.T) {
	store, err := LoadStore("../../data/strategy/normalized")
	if err != nil {
		t.Fatalf("LoadStore() error = %v", err)
	}

	cases := []struct {
		name string
		want string
	}{
		{name: "melbourne", want: "australia"},
		{name: "silverstone", want: "britain"},
		{name: "monza", want: "italy"},
		{name: "jeddah", want: "saudi-arabia"},
		{name: "losail", want: "qatar"},
	}

	for _, tc := range cases {
		track := store.TrackByName(tc.name)
		if track == nil {
			t.Fatalf("TrackByName(%q) = nil", tc.name)
		}
		if track.Track != tc.want {
			t.Fatalf("TrackByName(%q).Track = %q, want %q", tc.name, track.Track, tc.want)
		}
	}
}

func TestTrackBySessionFallsBackToTrackNameAlias(t *testing.T) {
	store, err := LoadStore("../../data/strategy/normalized")
	if err != nil {
		t.Fatalf("LoadStore() error = %v", err)
	}

	track := store.TrackBySession(-1, "Melbourne")
	if track == nil {
		t.Fatal("TrackBySession() = nil")
	}
	if track.Track != "australia" {
		t.Fatalf("TrackBySession().Track = %q, want australia", track.Track)
	}
}
