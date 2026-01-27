export interface SectorBoundaries {
  sector1End: number;
  sector2End: number;
}

/**
 * Divides track into 3 equal sectors.
 * Real F1 sector boundaries vary per track, but equal thirds is a reasonable default.
 */
export function calculateSectorBoundaries(trackLength: number): SectorBoundaries {
  return {
    sector1End: Math.round(trackLength * 0.33),
    sector2End: Math.round(trackLength * 0.67),
  };
}
