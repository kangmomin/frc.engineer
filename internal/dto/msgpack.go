package dto

import (
	"bytes"

	"github.com/vmihailenco/msgpack/v5"
)

// MsgpackMarshal encodes v using msgpack with JSON struct tags.
func MsgpackMarshal(v interface{}) ([]byte, error) {
	var buf bytes.Buffer
	enc := msgpack.NewEncoder(&buf)
	enc.SetCustomStructTag("json")
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// MsgpackUnmarshal decodes msgpack data using JSON struct tags.
func MsgpackUnmarshal(data []byte, v interface{}) error {
	dec := msgpack.NewDecoder(bytes.NewReader(data))
	dec.SetCustomStructTag("json")
	return dec.Decode(v)
}
