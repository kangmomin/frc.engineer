package strategydata

import "strings"

const AccessKey = "mer260331"

func HasAccessKey(value string) bool {
	return strings.TrimSpace(value) == AccessKey
}
