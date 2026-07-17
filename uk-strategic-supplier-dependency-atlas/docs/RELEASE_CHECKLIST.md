# Release checklist

State: see docs/RELEASE_STATE.md (currently BLOCKED / NEEDS HUMAN
DECISION). This checklist is what any future public alpha must satisfy —
none of it may be skipped.

## Before PRIVATE alpha

- [ ] Source probe verdict PASS or PARTIAL
- [ ] Official list captured, locked, hashed (evidence-grade)
- [ ] First supplier selected from captured list; reason in DECISIONS.md
- [ ] Truth slice built offline from locked raw
- [ ] GATE-SCHEMA-01, GATE-PROV-01, GATE-SLICE-01 pass
- [ ] GATE-SECRET-01, GATE-FIX-01, GATE-SAFE-01 pass
- [ ] Static profile renders without live access
- [ ] Manual-review queue populated and inspectable

## Before PUBLIC alpha (additionally)

- [ ] Licence review re-verified from live terms (GATE-LIC-01 pass);
      raw terms captures locked
- [ ] Gold-set validation meets thresholds (docs/VALIDATION.md)
- [ ] Zero confirmed claims without source evidence
- [ ] Evidence-ID completeness 100% for displayed claims
- [ ] Source-link completeness ≥95%
- [ ] All findings pass the public-claim firewall
- [ ] Personal-data exposure review complete (PUBLICATION_SAFETY.md)
- [ ] docs/OPERATOR_REVIEW_GATE.md approval box ticked by a human
- [ ] package_release produced and inspected

Nothing publishes automatically. A private alpha with correct evidence is
better than a public alpha with weak claims.
