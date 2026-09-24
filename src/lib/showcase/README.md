# `lib/showcase` — the 20 showcase projects

**Responsibility.** Ship the twenty ATL-catalogue projects the spec names, each as a runnable
revision a student can open, run and remix.

**Public API.**

```ts
SHOWCASE                      // 20 projects, in the spec's order
showcaseBySlug(slug)
showcaseDoc(project) -> ProjectDoc   // open in the builder: /builder?showcase=<slug>
showcaseBom(project)                 // [{ type, name, count }]
```

**Each project carries** parts, wiring, a sketch, learning outcomes, wiring notes for the real
bench, an optional "do this mission first" link, an honest `fidelityNote` for anything the
functional runtime cannot show (RFID card reads, Wi-Fi), and a **behaviour probe**: a short
automation scenario that proves the project does what its description claims.

**Tests.** `npm test -- src/lib/showcase` checks the titles match the spec, every part and pin
exists, every project is free of electrical errors, and every probe passes. Writing and running
these probes is what found the integer-division, array-initialiser and float-printing bugs in the
interpreter.
