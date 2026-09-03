---
preset: go
language: ko

buildCommand: "go build ./... && npm --prefix web run build && npm --prefix apps/setup-manager run build"
testCommand: "go test ./... && npm --prefix web test"
lintCommand: "go vet ./... && npm --prefix web run lint"
typeCheckCommand: ""
makeTestCommand: ""

runServerCommand: "go run ./cmd/server"
serverUrl: "http://localhost:8080"
e2eEnabled: true
apiDocsPath: ""
e2eLockDir: ""

reportDir: ""

sourceDirs: ["cmd/", "internal/", "pkg/", "web/src/", "apps/setup-manager/src/", "shared/"]
testDirs: ["cmd/", "internal/", "pkg/", "web/src/", "apps/setup-manager/src/", "shared/"]

mainBranch: main
featureBranchPrefix: feat/
hotfixBranchPrefix: hotfix/

commitPrefixes: [Add, Fix, Del, Refactor, Doc, Test, Chore, WIP]
commitCoAuthor: ""

projectConventions: ["AGENTS.md"]
feedbackUpstreamRepo: ""

# 에이전트 토폴로지 슬롯 (선택. 생략 시 기본 배정 — 규칙: start-workflow references/agent-topology.md "슬롯 설정")
# topologyModels:
#   executor: { model: gpt-5.6-terra, effort: high }   # executor의 model·effort 교체
#   advisor:  { model: gpt-5.6-sol, effort: xhigh }    # advisor effort만 조정
---

# Project Notes

Go 서버, Pitwall 웹, Minmo Driver Pack을 함께 검증하는 모노레포 프로필.
