package tracks

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeRecordedTrackName(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{in: "losail", want: "losail"},
		{in: "losail_record", want: "losail"},
		{in: "losail_recorded", want: "losail"},
		{in: "losail_record_recorded", want: "losail"},
		{in: "__losail_record__", want: "losail"},
		{in: "_record", want: "unknown"},
		{in: "", want: "unknown"},
	}

	for _, tc := range tests {
		got := NormalizeRecordedTrackName(tc.in)
		if got != tc.want {
			t.Fatalf("NormalizeRecordedTrackName(%q)=%q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestListRecordedFilesSupportsLegacySuffix(t *testing.T) {
	dir := t.TempDir()
	writeTrackFile(t, filepath.Join(dir, "losail_recorded.txt"))
	writeTrackFile(t, filepath.Join(dir, "monza_record.txt"))
	writeTrackFile(t, filepath.Join(dir, "ignore.txt"))

	store := &TrackStore{dataDir: dir}
	files := store.ListRecordedFiles()

	if len(files) != 2 {
		t.Fatalf("expected 2 recorded files, got %d", len(files))
	}

	found := map[string]string{}
	for _, f := range files {
		found[f.Filename] = f.Name
	}

	if got := found["losail_recorded.txt"]; got != "losail" {
		t.Fatalf("losail name mismatch: got %q", got)
	}
	if got := found["monza_record.txt"]; got != "monza" {
		t.Fatalf("monza name mismatch: got %q", got)
	}
}

func writeTrackFile(t *testing.T, path string) {
	t.Helper()
	content := "track metadata\ndist,pos_z,pos_x,pos_y,drs,sector\n0.0,0.0,0.0,0.0,0,0\n"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write %s: %v", path, err)
	}
}
