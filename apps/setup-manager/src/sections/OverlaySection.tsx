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
      <Panel title="Overlays" detail="Native overlays on the sender host">
        {overlay.error ? <Notice tone="error">{overlay.error}</Notice> : null}
        {overlay.notice ? <Notice tone="success">{overlay.notice}</Notice> : null}
        <Grid cols={2}>
          {OVERLAYS.map((item) => {
            const active = overlayState[item.key];
            return (
              <Card key={item.key}>
                <Spread>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-racing)", fontSize: 14, fontWeight: 700 }}>{item.label}</div>
                    <Hint>{item.detail}</Hint>
                  </div>
                  <StatusPill tone={active ? item.tone : "muted"} label={active ? "ON" : "OFF"} />
                </Spread>
                <Spread>
                  <Hint style={{ fontSize: 10.5 }}>Hotkey {hotkeys[item.key]}</Hint>
                  <Button size="sm" variant={active ? "ghost" : "primary"} onClick={() => void overlay.toggle(item.key)} disabled={overlay.applying} busy={overlay.applying}>
                    {active ? "Close" : "Open"}
                  </Button>
                </Spread>
              </Card>
            );
          })}
        </Grid>
      </Panel>

      <Panel title="Hotkeys">
        <Hint>
          Global overlay hotkeys stay active while F1 Driver Pack is running. Use combos like <strong style={{ color: "var(--text-primary)" }}>Alt+Shift+1</strong> or{" "}
          <strong style={{ color: "var(--text-primary)" }}>Ctrl+Alt+R</strong>.
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
