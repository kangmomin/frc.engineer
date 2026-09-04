// Access screen — RBAC 관리(Role 그랜트 편집 + 계정 Role 할당). 셸 관례는
// Analysis.tsx (title header + Card + busy/err). 서버가 pithub.rbac.* 로 게이트하므로
// 이 화면은 그 권한이 있을 때만 마운트된다 (HubApp 분기) — 진짜 경계는 서버다.
//
// 설계 불변식 — /rbac 변경 API는 전부 치환(replace) semantics다:
//  * 보낸 배열이 곧 전체가 된다. 그래서 이 화면은 항상 "현재 상태 전체"를 체크박스로
//    띄우고 그대로 되돌려 보낸다. 부분 add/remove를 만들지 말 것 — 누락이 곧 회수다.
//  * 마지막 admin이 자기 rbac 권한을 떼면 API로는 복구할 수 없다(env 재기동 또는 SQL).
//    저장 전에 그 조건을 계산해 경고한다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HubTheme } from '../theme';
import { canStartViewAs, hasPermission } from '../data/permissions';
import type { PlatformAccount } from '../data/session';
import { viewAsEligibility } from './accessState';
import {
  PlatformMarket, ListingError,
  type PlatformRole, type PlatformAccountRoles,
} from '../data/platform';

const MONO = "'JetBrains Mono',monospace";

// 서버가 삭제를 거부하는 시드 Role — 삭제 버튼 자체를 내려 400을 유발하지 않는다.
const SEED_ROLES = ['user', 'admin'];

// 자기 락아웃 판정 기준. 이 노드를 잃으면 /rbac 변경 API를 더는 호출할 수 없다.
const RBAC_UPDATE = 'pithub.rbac.update';

interface Props {
  t: HubTheme;
  market: PlatformMarket;
  // 로그인한 본인 계정 id — 자기 락아웃 경고 판정에만 쓴다.
  selfAccountId: string | null;
  actor: PlatformAccount;
  onViewAs: (accountId: string) => Promise<void>;
}

export function Access({ t, market, selfAccountId, actor, onViewAs }: Props) {
  const [roles, setRoles] = useState<PlatformRole[] | null>(null);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [err, setErr] = useState('');

  const refreshRoles = useCallback(() => {
    market.listRoles().then(setRoles).catch((e: unknown) => setErr(msgOf(e)));
  }, [market]);

  useEffect(() => {
    refreshRoles();
    market.listPermissionCatalog().then(setCatalog).catch((e: unknown) => setErr(msgOf(e)));
  }, [market, refreshRoles]);

  return (
    <section>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.01em', color: t.t1 }}>권한 관리</div>
        <div style={{ fontSize: 12.5, color: t.t2, marginTop: 4 }}>
          Role별 권한 그랜트 · 계정별 Role 할당 · 저장은 언제나 전체 치환입니다
        </div>
      </div>

      {err && <Banner t={t} tone="err">{err}</Banner>}
      {!canStartViewAs(actor) && <Banner t={t} tone="warn">View As를 시작하려면 pithub.view-as.create 권한이 필요합니다.</Banner>}

      <RolePanel t={t} market={market} roles={roles} catalog={catalog} onChanged={refreshRoles} onErr={setErr} />
      <AccountPanel t={t} market={market} roles={roles} selfAccountId={selfAccountId} canCreateViewAs={canStartViewAs(actor)} onViewAs={onViewAs} onErr={setErr} />
    </section>
  );
}

/* ---------------------------------- Roles --------------------------------- */

function RolePanel({ t, market, roles, catalog, onChanged, onErr }: {
  t: HubTheme; market: PlatformMarket; roles: PlatformRole[] | null; catalog: string[];
  onChanged: () => void; onErr: (m: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const role = roles?.find((r) => r.name === selected) ?? null;

  // Role을 고르거나 서버 상태가 갱신되면 초안을 서버 값으로 되돌린다.
  useEffect(() => { setDraft(role ? [...role.permissions] : []); }, [role]);

  const dirty = role != null && !sameSet(draft, role.permissions);

  const save = () => {
    if (!role) return;
    setBusy(true);
    market.setRolePermissions(role.name, draft)
      .then(() => { onErr(''); onChanged(); })
      .catch((e: unknown) => onErr(msgOf(e)))
      .finally(() => setBusy(false));
  };

  const create = () => {
    setBusy(true);
    market.createRole(newName.trim(), newDesc.trim())
      .then(() => { setNewName(''); setNewDesc(''); onErr(''); onChanged(); })
      .catch((e: unknown) => onErr(msgOf(e)))
      .finally(() => setBusy(false));
  };

  const remove = (name: string) => {
    setBusy(true);
    market.deleteRole(name)
      .then(() => { if (selected === name) setSelected(null); onErr(''); onChanged(); })
      .catch((e: unknown) => onErr(msgOf(e)))
      .finally(() => setBusy(false));
  };

  return (
    <Card t={t}>
      <SectionTitle t={t}>ROLES</SectionTitle>

      {roles == null ? (
        <Muted t={t}>불러오는 중…</Muted>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,300px) 1fr', gap: 16, alignItems: 'start' }}>
          {/* 좌: Role 목록 + 생성 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {roles.map((r) => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 8,
                background: selected === r.name ? t.accSoft : t.inset,
                border: `1px solid ${selected === r.name ? t.accBorder : t.line}`,
              }}>
                <button onClick={() => setSelected(r.name)} style={{
                  flex: 1, textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: t.t1,
                }}>
                  {r.name}
                  <span style={{ display: 'block', marginTop: 2, fontFamily: MONO, fontSize: 10, fontWeight: 400, color: t.t3 }}>
                    {r.permissions.length}개 그랜트{r.description ? ` · ${r.description}` : ''}
                  </span>
                </button>
                {!SEED_ROLES.includes(r.name) && (
                  <MiniButton t={t} onClick={() => remove(r.name)} disabled={busy}>삭제</MiniButton>
                )}
              </div>
            ))}

            <div style={{ marginTop: 8, padding: 11, borderRadius: 8, background: t.inset, border: `1px dashed ${t.line2}` }}>
              <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.1em', color: t.t3, marginBottom: 7 }}>새 ROLE</div>
              <Input t={t} value={newName} onChange={setNewName} placeholder="이름 (소문자·숫자·하이픈)" />
              <div style={{ height: 6 }} />
              <Input t={t} value={newDesc} onChange={setNewDesc} placeholder="설명 (선택)" />
              <div style={{ height: 8 }} />
              <MiniButton t={t} onClick={create} disabled={busy || newName.trim() === ''} primary>만들기</MiniButton>
            </div>
          </div>

          {/* 우: 선택된 Role의 그랜트 편집 */}
          <div>
            {role == null ? (
              <Muted t={t}>왼쪽에서 Role을 선택하면 권한을 편집할 수 있습니다.</Muted>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.t1 }}>{role.name}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: t.t3 }}>{draft.length}개 선택</div>
                  <div style={{ flex: 1 }} />
                  {dirty && <MiniButton t={t} onClick={() => setDraft([...role.permissions])} disabled={busy}>되돌리기</MiniButton>}
                  <MiniButton t={t} onClick={save} disabled={busy || !dirty} primary>저장</MiniButton>
                </div>

                {role.name === 'admin' && (
                  <Banner t={t} tone="warn">
                    admin의 그랜트를 줄이면 본인이 이 화면을 잃을 수 있습니다. 복구 경로는
                    PLATFORM_ADMIN_ACCOUNT_IDS 재기동 또는 SQL뿐입니다.
                  </Banner>
                )}

                <GrantPicker t={t} catalog={catalog} draft={draft} onToggle={(node) => {
                  setDraft((d) => (d.includes(node) ? d.filter((x) => x !== node) : [...d, node]));
                }} />
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// GrantPicker renders the catalog grouped by service root, indented by depth.
// 상위 노드가 선택되면 하위는 자동 포함이므로 "이미 포함" 표시로 혼동을 없앤다
// (dot 경계는 hasPermission이 지킨다 — pithub.race가 race-analyze를 덮지 않는다).
function GrantPicker({ t, catalog, draft, onToggle }: {
  t: HubTheme; catalog: string[]; draft: string[]; onToggle: (node: string) => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const node of catalog) {
      const root = node.split('.')[0];
      const list = m.get(root);
      if (list) list.push(node);
      else m.set(root, [node]);
    }
    return [...m.entries()];
  }, [catalog]);

  if (catalog.length === 0) return <Muted t={t}>권한 카탈로그를 불러오는 중…</Muted>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 14 }}>
      {groups.map(([root, nodes]) => (
        <div key={root} style={{ background: t.inset, border: `1px solid ${t.line}`, borderRadius: 8, padding: 11 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.12em', color: t.accInk, marginBottom: 8 }}>
            {root.toUpperCase()}
          </div>
          {nodes.map((node) => {
            const checked = draft.includes(node);
            // 자기 자신을 뺀 나머지 그랜트가 이 노드를 이미 덮는가.
            const covered = !checked && hasPermission(draft, node);
            const depth = node.split('.').length - 1;
            return (
              <label key={node} style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '3px 0',
                paddingLeft: depth * 12, cursor: 'pointer',
                fontFamily: MONO, fontSize: 11,
                color: checked ? t.t1 : covered ? t.t3 : t.t2,
              }}>
                <input type="checkbox" checked={checked} onChange={() => onToggle(node)} style={{ accentColor: t.acc, cursor: 'pointer' }} />
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {node.slice(root.length + 1) || root}
                </span>
                {covered && <span style={{ fontSize: 9.5, color: t.t3, whiteSpace: 'nowrap' }}>상위 포함</span>}
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------- Accounts -------------------------------- */

function AccountPanel({ t, market, roles, selfAccountId, canCreateViewAs, onViewAs, onErr }: {
  t: HubTheme; market: PlatformMarket; roles: PlatformRole[] | null;
  selfAccountId: string | null; canCreateViewAs: boolean; onViewAs: (accountId: string) => Promise<void>; onErr: (m: string) => void;
}) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PlatformAccountRoles[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [viewBusyId, setViewBusyId] = useState<string | null>(null);

  const search = useCallback((term: string) => {
    setRows(null);
    market.searchAccounts(term)
      .then((r) => { setRows(r); onErr(''); })
      .catch((e: unknown) => { setRows([]); onErr(msgOf(e)); });
  }, [market, onErr]);

  useEffect(() => { search(''); }, [search]);

  const open = (row: PlatformAccountRoles) => {
    setOpenId(row.id);
    setDraft([...row.roles]);
  };

  const current = rows?.find((r) => r.id === openId) ?? null;
  const dirty = current != null && !sameSet(draft, current.roles);

  // 자기 계정에서 rbac.update를 잃게 되는가 — 잃으면 API로는 되돌릴 수 없다.
  const lockout = useMemo(() => {
    if (!current || !roles || current.id !== selfAccountId) return false;
    const grants = roles.filter((r) => draft.includes(r.name)).flatMap((r) => r.permissions);
    return !hasPermission(grants, RBAC_UPDATE);
  }, [current, roles, draft, selfAccountId]);

  const save = () => {
    if (!current) return;
    setBusy(true);
    market.setAccountRoles(current.id, draft)
      .then(() => { onErr(''); search(q); setOpenId(null); })
      .catch((e: unknown) => onErr(msgOf(e)))
      .finally(() => setBusy(false));
  };

  return (
    <Card t={t} style={{ marginTop: 14 }}>
      <SectionTitle t={t}>ACCOUNTS</SectionTitle>

      <form
        onSubmit={(e) => { e.preventDefault(); search(q); }}
        style={{ display: 'flex', gap: 8, marginBottom: 12, maxWidth: 420 }}
      >
        <Input t={t} value={q} onChange={setQ} placeholder="persona 검색 (비우면 전체)" />
        <MiniButton t={t} onClick={() => search(q)} disabled={busy}>검색</MiniButton>
      </form>

      {rows == null ? (
        <Muted t={t}>불러오는 중…</Muted>
      ) : rows.length === 0 ? (
        <Muted t={t}>일치하는 계정이 없습니다.</Muted>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((row) => {
            const active = openId === row.id;
            const viewAs = viewAsEligibility(row, selfAccountId, canCreateViewAs);
            return (
              <div key={row.id} style={{
                padding: '10px 12px', borderRadius: 8,
                background: active ? t.accSoft : t.inset,
                border: `1px solid ${active ? t.accBorder : t.line}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={() => (active ? setOpenId(null) : open(row))} style={{
                    flex: 1, textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: t.t1,
                  }}>
                    {row.persona}
                    {row.id === selfAccountId && <span style={{ marginLeft: 6, fontFamily: MONO, fontSize: 9.5, color: t.accInk }}>본인</span>}
                    {row.kind !== 'user' && <span style={{ marginLeft: 6, fontFamily: MONO, fontSize: 9.5, color: t.t3 }}>{row.kind}</span>}
                    <span style={{ display: 'block', marginTop: 2, fontFamily: MONO, fontSize: 10, fontWeight: 400, color: t.t3 }}>
                      {row.roles.length ? row.roles.join(' · ') : 'Role 없음'}
                    </span>
                  </button>
                  <MiniButton
                    t={t}
                    disabled={!viewAs.eligible || viewBusyId !== null}
                    primary={viewAs.eligible}
                    onClick={() => {
                      if (!viewAs.eligible) return;
                      setViewBusyId(row.id);
                      onViewAs(row.id).catch((e: unknown) => onErr(msgOf(e))).finally(() => setViewBusyId(null));
                    }}
                  >
                    {viewBusyId === row.id ? '전환 중…' : 'View As'}
                  </MiniButton>
                </div>
                {!viewAs.eligible && <div style={{ marginTop: 5, fontFamily: MONO, fontSize: 9.5, color: t.t3 }}>View As 불가 · {viewAs.reason}</div>}

                {active && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${t.line}` }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10 }}>
                      {(roles ?? []).map((r) => (
                        <label key={r.id} style={{
                          display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                          fontFamily: MONO, fontSize: 11, color: draft.includes(r.name) ? t.t1 : t.t2,
                        }}>
                          <input
                            type="checkbox"
                            checked={draft.includes(r.name)}
                            onChange={() => setDraft((d) => (d.includes(r.name) ? d.filter((x) => x !== r.name) : [...d, r.name]))}
                            style={{ accentColor: t.acc, cursor: 'pointer' }}
                          />
                          {r.name}
                        </label>
                      ))}
                    </div>

                    {lockout && (
                      <Banner t={t} tone="err">
                        이 조합에는 {RBAC_UPDATE} 권한이 없습니다. 저장하면 본인이 권한 관리에서 잠깁니다 —
                        복구는 PLATFORM_ADMIN_ACCOUNT_IDS 재기동 또는 SQL뿐입니다.
                      </Banner>
                    )}

                    <div style={{ display: 'flex', gap: 8 }}>
                      <MiniButton t={t} onClick={save} disabled={busy || !dirty} primary={!lockout} danger={lockout}>
                        {lockout ? '락아웃 감수하고 저장' : '저장'}
                      </MiniButton>
                      {dirty && <MiniButton t={t} onClick={() => setDraft([...row.roles])} disabled={busy}>되돌리기</MiniButton>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------- bits ---------------------------------- */

function Card({ t, children, style }: { t: HubTheme; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.line}`, borderRadius: 12, padding: 20, ...style }}>
      {children}
    </div>
  );
}

function SectionTitle({ t, children }: { t: HubTheme; children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.22em', color: t.accInk, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function Muted({ t, children }: { t: HubTheme; children: React.ReactNode }) {
  return <div style={{ fontFamily: MONO, fontSize: 11, color: t.t3 }}>{children}</div>;
}

function Banner({ t, tone, children }: { t: HubTheme; tone: 'err' | 'warn'; children: React.ReactNode }) {
  const color = tone === 'err' ? t.negRed : t.warn;
  return (
    <div style={{
      fontSize: 11.5, lineHeight: 1.6, color, marginBottom: 10, padding: '8px 11px',
      background: tone === 'err' ? 'transparent' : t.warnSoft,
      border: `1px solid ${tone === 'err' ? t.line2 : t.warnBorder}`, borderRadius: 7,
    }}>
      {children}
    </div>
  );
}

function Input({ t, value, onChange, placeholder }: {
  t: HubTheme; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 7,
        border: `1px solid ${t.line2}`, background: t.panel, color: t.t1,
        fontFamily: MONO, fontSize: 11.5, outline: 'none',
      }}
    />
  );
}

function MiniButton({ t, onClick, disabled, primary, danger, children }: {
  t: HubTheme; onClick: () => void; disabled?: boolean;
  primary?: boolean; danger?: boolean; children: React.ReactNode;
}) {
  const bg = danger ? t.negRed : primary ? t.acc : t.panel2;
  const fg = danger ? t.panel : primary ? t.onAcc : t.t3;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: MONO, fontSize: 10, padding: '6px 11px', borderRadius: 6, whiteSpace: 'nowrap',
        border: `1px solid ${danger || primary ? 'transparent' : t.line2}`,
        background: bg, color: fg,
        opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

// sameSet: 순서를 무시한 동등 비교 — 치환 API라 순서는 의미가 없고, 순서 차이로
// "변경됨"이 켜지면 불필요한 저장을 유도한다.
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

function msgOf(e: unknown): string {
  return e instanceof ListingError ? e.message : '오류가 발생했습니다';
}
