package engineer

import (
	"sort"
	"time"
	"unicode/utf8"
)

const (
	queueCap       = 12
	historyCap     = 30
	keyCooldown    = 45 * time.Second
	spacingPadding = 800 * time.Millisecond
)

func ttlFor(p Priority) time.Duration {
	switch p {
	case PriorityUrgent:
		return 15 * time.Second
	case PriorityHigh:
		return 30 * time.Second
	case PriorityNormal:
		return 20 * time.Second
	default:
		return 15 * time.Second
	}
}

// speechDuration estimates how long a TTS voice needs for text, so the next
// non-urgent call does not talk over the previous one.
func speechDuration(text, lang string) time.Duration {
	n := utf8.RuneCountInString(text)
	perSec := 15.0
	if lang != "en" {
		perSec = 7.0
	}
	d := time.Duration(float64(n) / perSec * float64(time.Second))
	return max(d, 1200*time.Millisecond)
}

type queued struct {
	call     Call
	awaiting bool      // enforce mode: waiting for the decision model
	deadline time.Time // fail-open deadline while awaiting
	suppress bool
	shadowed bool
}

type queue struct {
	items     []*queued
	lastKeyAt map[string]time.Time
	nextFree  time.Time
	history   []Call
	nextID    uint64
	released  uint64
	dropped   uint64
}

func newQueue() *queue { return &queue{lastKeyAt: map[string]time.Time{}} }

// push filters and enqueues a call. It returns the queued item or nil and the
// reason the call was dropped.
func (q *queue) push(c Call, now time.Time, s Settings) (*queued, string) {
	if !c.forced {
		if !s.Categories.allows(c.Category) {
			return nil, "muted"
		}
		if c.Priority < s.minPriority() {
			return nil, "verbosity"
		}
		if at, ok := q.lastKeyAt[c.Key]; ok && now.Sub(at) < keyCooldown {
			return nil, "cooldown"
		}
	}
	q.nextID++
	c.ID = q.nextID
	c.CreatedAt = now
	c.ExpiresAt = now.Add(ttlFor(c.Priority))
	for i, it := range q.items {
		if it.call.Key == c.Key {
			q.items[i] = &queued{call: c}
			return q.items[i], ""
		}
	}
	item := &queued{call: c}
	q.items = append(q.items, item)
	if len(q.items) > queueCap {
		q.sort()
		q.items = q.items[:queueCap]
		q.dropped++
		for _, it := range q.items {
			if it == item {
				return item, ""
			}
		}
		return nil, "overflow"
	}
	return item, ""
}

// sort orders by priority (high first), then age (old first).
func (q *queue) sort() {
	sort.SliceStable(q.items, func(i, j int) bool {
		a, b := q.items[i].call, q.items[j].call
		if a.Priority != b.Priority {
			return a.Priority > b.Priority
		}
		return a.ID < b.ID
	})
}

// next releases at most one call that may be spoken now. Expired and
// suppressed calls are returned through the dropped callback.
func (q *queue) next(now time.Time, in Inputs, s Settings, dropped func(Call, string)) *Call {
	kept := q.items[:0]
	for _, it := range q.items {
		switch {
		case it.suppress:
			dropped(it.call, "suppressed")
		case now.After(it.call.ExpiresAt):
			q.dropped++
			dropped(it.call, "expired")
		default:
			kept = append(kept, it)
		}
	}
	q.items = kept
	q.sort()
	for i, it := range q.items {
		if it.awaiting {
			continue
		}
		if it.call.Priority < PriorityUrgent {
			if now.Before(q.nextFree) || (s.BrakeGate && in.busy()) {
				return nil
			}
		}
		q.items = append(q.items[:i], q.items[i+1:]...)
		c := it.call
		c.ReleasedAt = now
		q.lastKeyAt[c.Key] = now
		q.nextFree = now.Add(speechDuration(c.Text, s.Language) + spacingPadding)
		q.released++
		q.history = append(q.history, c)
		if len(q.history) > historyCap {
			q.history = q.history[len(q.history)-historyCap:]
		}
		return &c
	}
	return nil
}

// flush drops every queued call (used after a flashback).
func (q *queue) flush() int {
	n := len(q.items)
	q.items = nil
	return n
}

func (q *queue) find(id uint64) *queued {
	for _, it := range q.items {
		if it.call.ID == id {
			return it
		}
	}
	return nil
}
