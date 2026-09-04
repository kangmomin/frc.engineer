export function isCurrentAdminAnalysisRequest(responseGeneration: number, currentGeneration: number, mounted: boolean): boolean {
  return mounted && responseGeneration === currentGeneration;
}
