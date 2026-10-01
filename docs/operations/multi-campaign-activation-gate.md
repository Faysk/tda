# Multi-campaign activation gate

> Status: operational gate for #1138
> Owner: testing / identity-access / operations
> Última revisão: 2026-10-01

## Purpose

The second campaign must not be activated from CI color alone. The candidate is eligible only when the exact commit SHA has a sanitized cross-campaign receipt and staging has been smoked both before and after the activation step.

The executable gate is `.github/workflows/campaign-isolation.yml`. It uses synthetic A/B/C database fixtures and public browser fixtures only. It must not read private transcript/canon/audio content and it never applies Production mutations.

## Required evidence

For an activation candidate, preserve all of the following for the **same source SHA**:

1. normal PR/main Campaign Isolation Gate receipt;
2. manual `workflow_dispatch` with `require_ready=true`, `smoke_phase=pre_activation` and the HTTPS staging origin;
3. deliberate activation/deployment through the owning rollout/runbook; the gate itself does not deploy;
4. second manual run on the same SHA with `smoke_phase=post_activation`;
5. links to both run IDs and their `campaign-isolation-receipt.json` artifacts in #1138.

A missing, skipped or failed staging smoke makes the manual activation gate fail closed.

## What the receipt proves

`campaign-isolation-receipt.json` records:

- exact tested SHA and PR head SHA when applicable;
- readiness blockers;
- results for domain, PostgreSQL, browser, Processing and legacy-regression suites;
- the counted 12-case critical negative matrix, where every case is bound to a runnable file and a semantic assertion anchor;
- covered endpoint/action surface groups;
- staging smoke phase/result;
- explicit `synthetic=true`, `containsPrivateNarrativeData=false` and `productionMutation=false`.

The receipt is evidence for that SHA only. It does not prove a later merge, deployment or database rollout.

## Fail-closed rules

Do not activate while:

- the readiness scanner reports any implicit/global campaign consumer;
- #1135 media ownership or #1136 campaign-aware navigation remains unresolved in the candidate;
- any required suite is skipped/failed;
- the staging origin cannot be tested without credentials;
- pre/post smoke receipts do not point to the same source SHA;
- an artifact contains private narrative material.

Do not weaken scanner patterns, remove a negative case or replace its semantic assertion with an unrelated existing file to obtain a green receipt. The matrix fails closed when either the evidence file or its named assertion anchor disappears. Fix the owning domain.

## Staging smoke

The smoke is intentionally public and non-destructive. It performs GET requests only to:

- `/api/health`;
- `/`;
- `/campanhas`;
- `/campanhas/sessoes`.

It does not send cookies, Auth headers, tokens or campaign grants. Authenticated A→B negatives remain covered by synthetic server/DB contracts.

## Rollback

If post-activation smoke or any governed read-back fails, stop the rollout and use the owning feature/database rollback plan. Keep additive schema/data/aliases intact unless their owner explicitly authorizes a reverse migration. Never delete campaign rows, media bytes or receipts merely to make the gate green.
