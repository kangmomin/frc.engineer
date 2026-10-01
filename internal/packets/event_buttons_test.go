package packets

import "testing"

func TestParseButtonStatusEvent(t *testing.T) {
	data := make([]byte, PacketHeaderSize+4+4)
	copy(data[PacketHeaderSize:], EventButtonStatus)
	status := UDPActionMask(1) | UDPActionMask(12)
	data[PacketHeaderSize+4] = byte(status)
	data[PacketHeaderSize+5] = byte(status >> 8)
	data[PacketHeaderSize+6] = byte(status >> 16)
	data[PacketHeaderSize+7] = byte(status >> 24)
	pkt, err := ParseEventPacket(data, &PacketHeader{})
	if err != nil {
		t.Fatal(err)
	}
	b, ok := pkt.EventDetails.(*ButtonsEvent)
	if !ok || b.ButtonStatus != status {
		t.Fatalf("button status not parsed: %#v", pkt.EventDetails)
	}
	if UDPActionMask(12) != 0x80000000 || UDPActionMask(0) != 0 || UDPActionMask(13) != 0 {
		t.Fatal("UDP action mask range wrong")
	}
	if _, err := ParseEventPacket(data[:PacketHeaderSize+6], &PacketHeader{}); err == nil {
		t.Fatal("truncated button event must fail")
	}
}
