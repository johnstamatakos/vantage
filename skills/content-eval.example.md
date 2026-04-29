# Content Relevance Criteria

This file defines what makes an article relevant to your feed. The scoring
formula, output schema, and universal evaluation principles are managed by
the app — this file controls only the Relevance dimension (50% of the score).

---

## High-relevance topic areas

- [Your primary technical domain, e.g. distributed systems, AI infrastructure, developer tooling]
- [Your secondary domain, e.g. platform architecture, API design, reliability engineering]
- [Leadership topics relevant to your work, e.g. engineering org design, hiring, performance management]
- [Industry segments central to your work, e.g. fintech, marketplace, enterprise SaaS]
- [Specific technologies or protocols you work with closely]

## Opinion-triggered relevance

An article is relevant if it connects — in agreement or in opposition — to any
opinion in the Points of View section. A piece that challenges a held view is
just as valuable as one that reinforces it.

Ask: would this article prompt a genuine reaction based on what the author
actually believes? That includes articles that provide evidence against their
position, complicate it, or argue the opposite.

Examples:
- An article about org flattening → relevant if you have an opinion on
  middle management being over-pruned (reinforces or challenges it)
- An article about AI-generated code → relevant if you have an opinion on
  review being the bottleneck and engineers losing depth
- An article on infrastructure cost growth → relevant if you have an opinion
  on teams underestimating the operational cost of scaling AI
- [Add one example per major opinion in your Points of View file]

## Secondary relevance signals

Draw from these when strongly applicable:
- [Adjacent domains worth including occasionally, e.g. developer experience, technical hiring]
- [Specific company announcements or ecosystem developments worth tracking]

## Low-relevance signals

Skip these:
- Pure research papers without practical product engineering application
- [Domains entirely outside your work, e.g. blockchain/web3, hardware]
- General career advice or motivational content without specific insight
- Marketing pieces without technical substance
- [Any content types you consistently want to filter out]

---

## Scoring notes (optional)

Add freeform notes here to refine how dimensions beyond relevance are applied
to your context. These are injected alongside the scoring criteria.

- [e.g. For leadership content, prioritize articles with specific case studies
  or data over broad frameworks]
- [e.g. Weight AI/infrastructure content more heavily when two articles score
  similarly on relevance]
