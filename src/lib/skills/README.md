# `lib/skills` — the mastery model

**Responsibility.** Say what a student knows, and prove it can't be gamed.

**Public API.**

```ts
SKILLS, SKILL_BY_ID                    // 26 skills, 4 domains, 3 tiers
skillsByDomain(), DOMAIN_LABEL, TIER_LABEL

newRecord(skillId)                     // SkillRecord
observe(record, correct, now?)         // Bayesian update
stateOf(record)                        // 'unknown' | 'seen' | 'practising' | 'mastered'

BADGES, badgesFor(progress)            // 11 rules
emptyProgress(), loadProgress(), saveProgress()
recordAttempt, recordFaultFixed, recordMission
```

**The model.** Bayesian Knowledge Tracing with `P_TRANSIT 0.2`, `P_GUESS 0.35`, `P_SLIP 0.1`,
threshold `0.95`, and a minimum of three successes. All five constants are exported so the tuning
is visible and testable rather than buried.

**Two properties worth defending:**

- *No single observation masters a skill.* Neither can a short lucky streak.
- *Mastery is a live estimate, not a medal.* One slip on a well-known skill is attributed to
  carelessness — that is precisely what `pSlip` models, and there is a test for it. But sustained
  failure takes mastery away again, because a `confirmedAt` timestamp that ignores later evidence
  is a permanent record of a momentary estimate.

**Badges credit effort, not just correctness.** Finishing a first mission, fixing three faults,
ten recorded attempts — the cabinet is meant to reward the student who got it wrong and worked out
why. Every badge carries a `rationale` saying why it exists, and a `progress(ctx)` returning
`{ have, need }` so a locked badge shows how close it is instead of just being grey.

**Persistence.** `localStorage` at `sparklab:progress:v1`, so the mastery map page works with no
account. When accounts land, this is the shape that gets synced.

**Tests.** `npm test -- src/lib/skills`

`completeMission(progress, skills, slug)` awards one completion and one attempt per mission; repeated success is a no-op. Repeated Chaos repairs remain practice observations. Stored progress is schema-validated and a page-session copy survives blocked/quota-limited storage. This is local learner evidence, not tamper-proof assessment.
