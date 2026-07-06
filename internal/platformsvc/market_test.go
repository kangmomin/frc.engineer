package platformsvc

import (
	"reflect"
	"testing"
)

func TestDeriveStints(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want []Stint
	}{
		{"simple two stints", []string{"Soft", "Soft", "Medium", "Medium", "Medium"},
			[]Stint{{"Soft", 2}, {"Medium", 3}}},
		{"back to soft is a new stint", []string{"Soft", "Medium", "Soft"},
			[]Stint{{"Soft", 1}, {"Medium", 1}, {"Soft", 1}}},
		{"unknown tyre skipped", []string{"Soft", "", "Soft"},
			[]Stint{{"Soft", 2}}},
		{"empty", []string{}, []Stint{}},
		{"all unknown", []string{"", ""}, []Stint{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := deriveStints(c.in); !reflect.DeepEqual(got, c.want) {
				t.Fatalf("deriveStints(%v) = %v, want %v", c.in, got, c.want)
			}
		})
	}
}

func TestCanonicalizeStintsDeterministic(t *testing.T) {
	s := []Stint{{"Soft", 12}, {"Hard", 20}}
	b1, h1 := canonicalizeStints(s)
	b2, h2 := canonicalizeStints(s)
	if h1 != h2 || string(b1) != string(b2) {
		t.Fatal("canonicalizeStints not deterministic")
	}
	if h1 == "" || len(h1) != 64 {
		t.Fatalf("hash = %q, want 64 hex chars", h1)
	}
	// Different content → different hash.
	_, h3 := canonicalizeStints([]Stint{{"Soft", 13}, {"Hard", 20}})
	if h3 == h1 {
		t.Fatal("distinct stints collided")
	}
}
