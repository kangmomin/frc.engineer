import { describe, expect, it } from 'vitest';
import { resolveLogoOverrides } from './TeamLogo.derive';

const P = '../assets/team-logos';

describe('resolveLogoOverrides', () => {
  it('maps a team ID to its drop-in logo URL', () => {
    expect(resolveLogoOverrides({ [`${P}/478.svg`]: '/478.svg' })).toEqual({ '478': '/478.svg' });
  });

  it('prefers .svg over .png regardless of the glob key order', () => {
    const svgFirst = resolveLogoOverrides({ [`${P}/0.svg`]: '/a.svg', [`${P}/0.png`]: '/a.png' });
    const pngFirst = resolveLogoOverrides({ [`${P}/0.png`]: '/a.png', [`${P}/0.svg`]: '/a.svg' });
    expect(svgFirst).toEqual({ '0': '/a.svg' });
    expect(pngFirst).toEqual({ '0': '/a.svg' });
  });

  it('keeps a .png when no .svg exists for that ID', () => {
    expect(resolveLogoOverrides({ [`${P}/484.png`]: '/m.png' })).toEqual({ '484': '/m.png' });
  });

  it('ignores files that are not named after a team ID', () => {
    expect(resolveLogoOverrides({ [`${P}/README.md`]: '/r.md', [`${P}/mercedes.svg`]: '/m.svg' })).toEqual({});
  });

  it('returns an empty map when no logo files are present', () => {
    expect(resolveLogoOverrides({})).toEqual({});
  });
});
