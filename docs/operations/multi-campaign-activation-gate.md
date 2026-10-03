# Multi-campaign activation gate

> Status: operational gate for #1138 and product-coherence acceptance #1288
> Owner: testing / identity-access / operations
> Última revisão: 2026-10-03

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


## Registry first-class activation (#1284)

The registry activation uses the canonical migrations:

- `20261001204500_activate_first_class_campaign_registry`;
- `20261001205000_harden_campaign_discovery_authorization`.

Before treating the first-class registry as active, the Production receipt must
show all of the following for the deployed candidate:

- both migration names present in remote migration history;
- `campaigns.public_slug/lifecycle/visibility/archived_at` present;
- `yuhara-main` remains the technical slug while
  `cronicas-da-mesa` is canonical and `yuhara-main` is an alias;
- the second identity `antes-que-seja-tarde` remains
  `active/private/identity_only` until an explicit later activation;
- public discovery excludes private/archived rows;
- authenticated campaign discovery is capability-based and does not expose raw
  grants;
- security/performance advisors are reviewed after DDL;
- the semantic public smoke and campaign isolation gate are green for the same
  SHA.

Do not restore Edit tools by falling back to `yuhara-main` client-side. If the
registry read fails, navigation must remain fail-closed until the database
contract is healthy.


## Product-coherence acceptance (#1288)

The browser slice also runs a small semantic A/B acceptance over the actual public
routes and authenticated navigation. It complements the isolation matrix instead
of duplicating it.

Synthetic browser state is intentionally publishable-only:

- campaign A is active/public, has its own cover, published sessions and World
  relations;
- campaign B is active/public, has no campaign cover and exercises fallback to
  artwork from its newest published session;
- private/archived fixture campaigns carry artwork but must never appear in the
  public directory;
- Lore resolves an A-linked item, a B-linked item and one explicitly unlinked
  curated item without consulting Production storage;
- authenticated projections cover A+B, A-only, anonymous, dependency-unavailable
  and no-campaign/no-grant states.

The fast acceptance asserts semantics, URLs, campaign labels, artwork decoding,
fail-closed capability projection and absence of cross-campaign World state.
`tests/world-edge-anchor-geometry.spec.ts` remains the numeric pan/zoom/resize/
reload relation-anchor contract and is reused by the same Playwright config.

The governed quick layout matrix is 390x844, 1366x768 and 683x384 (the project
proxy for 200% browser zoom). Expected missing artwork must render an intentional
fallback with no image element; any declared artwork must decode successfully,
so a broken asset is not silently treated as an expected missing image.

Workflow and browser/receipt artifacts remain synthetic and are named with the
exact source SHA. The JSON receipt records #1288's semantic, interaction and
geometry specs plus the tested viewport contract. No Production mutation or
private narrative read is part of this acceptance.

### Interaction matrix added after the 2026-10-03 UX audit

The quick gate must exercise interaction state, not merely open routes. The
synthetic browser contract therefore also covers:

- opening the global menu, entering the World drilldown and returning with the
  Back control while verifying focus restoration;
- explicit campaign selection followed by navigation and browser Back, proving
  that route context wins over a stale tool selection;
- keyboard Escape returning focus to the global-menu trigger;
- zero, one and many authorized campaign contexts, including a deliberately long
  campaign name;
- reachability of the final menu control in a short viewport;
- 320x720, 390x844, 1366x768 and the governed 683x384 200%-zoom proxy;
- recorded bounding boxes/clipping state for interactive targets together with
  sanitized screenshots. These files are uploaded as exact-SHA CI artifacts.

The interaction measurements are product evidence, not a replacement for
surface-specific functional assertions. A passing menu/layout measurement must
not be used to claim that a World edge is visibly painted, an empty transcript
inventory is semantically correct, or a Lembra picker is readable.

### Known product blockers for complete #1288 acceptance

The semantic/interaction harness is integrated independently from product fixes.
As of the 2026-10-03 audit, complete product-coherence acceptance still depends
on the owning issues below being resolved and then encoded as regression
assertions:

- #1327 campaign root is a useful canonical hub;
- #1328 session arc filter identity/counts are coherent;
- #1329 World/entity shells do not let global chrome intercept local controls;
- #1330 account permissions name the campaign context;
- #1333 non-narrative headers keep actions/content reachable early;
- #1340 published World relation strokes are visibly painted, not merely present
  in the DOM;
- #1341 World toolbar/canvas controls remain reachable on small viewports;
- #1344 an empty transcript inventory does not report false complete coverage;
- #1346 Lembra campaign/sort choices remain readable on mobile.

#1349 (avatar rendering) and #1350 (scroll lock) are investigation issues. They
only become required regression cases after a reproducible failing sequence is
confirmed; absence of reproduction must not be rewritten as a pass.

The synthetic gate also does not replace the release contract: the exact
published SHA still needs `/api/version` evidence and real, non-mutating
post-release interaction checks. Writing flows, R2 upload/read-back and ASR
quality retain their own domain gates.
