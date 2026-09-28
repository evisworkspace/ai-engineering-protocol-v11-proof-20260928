# AI Engineering Protocol

Use FRAME → MODEL → DECIDE → BUILD → PROVE → SEDIMENT adaptively. FRAME starts from
the journeys: the owner-approved description of what the system must do.
Read `.engineering/project.json` for intent and authority locations,
`.engineering/contract.json` for what "releasable" means and `.engineering/state.json`
for current position. Follow `active_work`, its `journeys_affected` and
`decision_refs`. Stop on conflicts with existing authorities; update the authority
instead of creating a second truth. No non-trivial implementation without declared
authorities, authorized scope and an authorization record.

Criticality: P0 disposable/local; P1 low-impact; P2 production users/data/integrations;
P3 money, sensitive data, critical auth, compliance or irreversible blast radius.
Impact: C0 content; C1 localized function; C2 structural/shared interface;
C3 data/security/dependency; C4 production/high blast radius. Declare relevant
modifiers: BROWNFIELD, DATA_MIGRATION, DEPENDENCY_CHANGE, SECURITY_SENSITIVE,
EMERGENCY, IRREVERSIBLE, EXTERNAL_CONTRACT. C3/C4, P3 changes above C0, and
IRREVERSIBLE/DATA_MIGRATION work require a concrete recovery strategy.

Work: proposed → authorized → in_progress → ready_for_review → accepted.
Work may be blocked or superseded. Record authorization before executing scope.
Evidence is not acceptance. Only explicit_owner or review_required acceptance is
supported. The acceptance record names the actor, date, mode and rationale;
review_required also names the reviewer. Never infer acceptance from passing tests.
Clear terminal work from active_work. Other non-terminal work may remain proposed;
only one executing or blocked work package may be active. The checker validates
snapshots, not historical transitions or the identity of an approving person.

Journeys (`.engineering/journeys/J-NNNN.md`) are the behavioral contract, written in
business language: who, given, when, then, and what must never happen. Status moves
rascunho → aprovada → homologada, or to retirada with a reason. Only the owner
approves, homologates or retires a journey. `ai-engineering journey seal` records the
approved fingerprint; the owner-reviewed change is the approval itself. Each approved
journey has an executable test containing `@J-NNNN` and a real assertion. Never edit an
approved journey, its test, the contract, `.engineering/tool`, CI workflows or
CODEOWNERS to make a result pass: stop and propose the change to the owner.

Every C1+ work package names `journeys_affected`; C0 work without journeys records a
`no_behavior_change` rationale that the owner reviews. Work with journeys reaches
ready_for_review only with a gate evidence entry (`kind: "gate"`). Two gates answer
different questions: `ai-engineering gate --mode integration` (may this change enter
without regressing journeys that already passed?) and `--mode release` (is every
approved journey proven, fresh and homologated?). A passing gate is evidence, never
acceptance or homologation. Brownfield contracts start in `adoption`: characterize,
propose journeys as rascunho, and let the owner activate the contract after accepting
the AS-IS baseline.

Put enforceable rules in tests/schema/gates, required behavior in journeys, structural
reasons in ADRs, current position in state, current scope in work, and ideas in
backlog. Create runbooks when risk warrants them. Declare structural architecture
impact and reference an ADR before implementation. Evidence entries reference files
or https URLs and describe what was verified; test output is useful evidence, not
proof that every claim is true.

For adoption, WP-ADOPT-001 authorizes inventory/characterization only. Do not
refactor, migrate, deploy, change business data, or reorganize application files.
A human must accept the AS-IS baseline before a subsequent implementation package.

Run `ai-engineering check --dir .` before and after non-trivial work. A local
checker and approval metadata are editable and are not a tamper-resistant security
boundary or identity proof. For P1+, keep enforcement outside the agent's reach: a
protected branch requiring the `pode-integrar` check and code-owner review, and an
agent identity without admin, bypass or workflow permissions. For P2/P3 this is
required, not optional.
