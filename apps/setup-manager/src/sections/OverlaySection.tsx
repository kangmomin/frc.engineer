import type { OverlayControls, OverlayKind } from "../hooks/useOverlayControls";
import { Button, Card, Field, Grid, Hint, Notice, Panel, Spread, StatusPill, TextInput, type PillTone } from "../ui";

const OVERLAYS: Array<{ key: OverlayKind; label: string; detail: string; tone: PillTone }> = [
  { key: "radar", label: "Radar", detail: "Nearby car radar.", tone: "accent" },
  { key: "weather", label: "Weather", detail: "Weather forecast.", tone: "lime" },
  { key: "strategy", label: "Strategy", detail: "Track strategy guide.", tone: "soft" },
  { key: "radio", label: "Engineer Radio", detail: "Virtual engineer calls.", tone: "accent" },
];

export function OverlaySection({ overlay }: { overlay: OverlayControls }) {
  const { overlayState, hotkeys, draftHotkeys } = overlay;

  return (
    <>
      <Panel title="Overlays" detail="Sender가 실행 중인 PC의 게임 화면 위에 표시됩니다.">
        {overlay.error ? <Notice tone="error">{overlay.error}</Notice> : null}
        {overlay.notice ? <Notice tone="success">{overlay.notice}</Notice> : null}
        <Grid cols={2}>
          {OVERLAYS.map((item) => {
            const active = overlayState[item.key];
            return (
              <Card key={item.key}>
                <Spread>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{item.label}</div>
                    <Hint>{item.detail}</Hint>
                  </div>
                  <StatusPill tone={active ? item.tone : "muted"} label={active ? "ON" : "OFF"} />
                </Spread>
                <Spread>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "0.04em", color: "var(--t3)" }}>HOTKEY {hotkeys[item.key]}</span>
                  <Button size="sm" variant={active ? "ghost" : "primary"} onClick={() => void overlay.toggle(item.key)} disabled={overlay.applying} busy={overlay.applying}>
                    {active ? "Close" : "Open"}
                  </Button>
                </Spread>
              </Card>
            );
          })}
        </Grid>
      </Panel>

      <Panel title="Hotkeys" detail="Driver Pack이 실행 중인 동안 전역으로 동작합니다.">
        <Hint>
          Use combos like <strong style={{ color: "var(--t1)" }}>Alt+Shift+1</strong> or <strong style={{ color: "var(--t1)" }}>Ctrl+Alt+R</strong>.
        </Hint>
        <Grid cols={4}>
          {OVERLAYS.map((item) => (
            <Field key={item.key} label={item.key === "radio" ? "Radio" : item.label}>
              <TextInput value={draftHotkeys[item.key]} placeholder="Alt+Shift+1" onChange={(event) => overlay.setDraftHotkey(item.key, event.target.value)} />
            </Field>
          ))}
        </Grid>
        <Spread>
          <Hint>
            Saved: Radar {hotkeys.radar} · Weather {hotkeys.weather} · Strategy {hotkeys.strategy} · Radio {hotkeys.radio}
          </Hint>
          <Button variant="go" onClick={() => void overlay.saveHotkeys()} disabled={overlay.savingHotkeys} busy={overlay.savingHotkeys}>
            Save
          </Button>
        </Spread>
      </Panel>
    </>
  );
}
