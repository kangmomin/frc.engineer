// 계층 permission 매칭 — canonical 구현은 internal/rbac/rbac.go (Go). 이 파일은
// 그 dot-boundary 규칙의 TS 미러다 (web/src/hub/data/permissions.ts와 동일 코드).
//
// grants는 서버가 내려주는 "그랜트 노드 원본"(leaf 전개 아님 — admin이면
// ["pithub","pitwall","sender"])이므로 includes()로 비교하면 안 되고 반드시 이
// 함수로 매칭한다. 상위 노드 그랜트는 서브트리 전체를 커버하되 dot 경계를
// 지킨다: "pithub.race"는 "pithub.race.read"를 커버하지만
// "pithub.race-analyze.read"는 절대 커버하지 않는다.
export function hasPermission(grants: readonly string[], node: string): boolean {
  return grants.some((g) => g === node || (g.length > 0 && node.startsWith(g + '.')));
}
