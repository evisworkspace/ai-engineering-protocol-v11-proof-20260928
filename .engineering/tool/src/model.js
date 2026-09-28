export const VERSION = '1.1.0';
export const SCHEMA = 1;
// Installed overlays this CLI can validate as "older" and upgrade in place.
export const UPGRADABLE = /^0\.\d+\.\d+$|^1\.0\.0$|^1\.1\.0$/;
export const MODIFIERS = ['BROWNFIELD','DATA_MIGRATION','DEPENDENCY_CHANGE','SECURITY_SENSITIVE','EMERGENCY','IRREVERSIBLE','EXTERNAL_CONTRACT'];
export const DIMENSIONS = ['funcional','integracao','operacao','seguranca'];
export const JOURNEY_STATUS = ['rascunho','aprovada','homologada','retirada'];
export function work(criticality = 'P1') {
  return { schema_version: 1, id: 'WP-NEW-001', status: 'proposed', project_criticality: criticality, change_impact: 'C1', modifiers: [], objective: '', scope: [], non_goals: [], journeys_affected: [], no_behavior_change: null, acceptance: [], evidence_required: [], acceptance_mode: 'explicit_owner', authorization_record: null, architecture_impact: 'none', data_migration: null, recovery: null, decision_refs: [], evidence: [], acceptance_record: null };
}
// The operational contract is project-owned: created once, never refreshed by upgrade.
export function contract(status = 'active') {
  const all = [...DIMENSIONS];
  return { schema_version: 1, status,
    dimensions_required: { P0: [], P1: ['funcional'], P2: all, P3: all },
    internal_layers_required: { P0: [], P1: ['unit'], P2: ['unit','integration','e2e'], P3: ['unit','integration','e2e'] },
    periodic_windows_hours: { cada_mudanca: 0, diaria: 26, semanal: 192 } };
}
