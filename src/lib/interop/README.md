# `lib/interop` — Wokwi, KiCad and BOM

**Responsibility.** Move a project in and out of SparkLab without losing anything, and say so
clearly when a format cannot carry something.

**Public API.**

```ts
// wokwi.ts
toWokwiDiagram(doc) -> { diagram, skipped[] }
fromWokwiDiagram(diagram, sketch?, name?) -> { doc, unknownParts[], droppedConnections }
toWokwiPin(type, pin), fromWokwiPin(type, pin), wokwiTypeFor(type)
librariesTxt(sketch)

// bundle.ts
wokwiZip(doc) -> { bytes, skipped[] }         // diagram.json + sketch.ino + libraries.txt
importWokwiZip(bytes, name?) -> WokwiImport

// exports.ts
bomRows(doc), bomCsv(doc), kicadNetlist(doc)

// zip.ts
createZip(files), readZip(bytes), crc32(bytes)
```

**Pin translation.** SparkLab uses teaching names (`D13`, an LED's `K`, a button's `1`); Wokwi uses
its own (`13`, `C`, `1.l`, `GND.1`, a servo's `V+`/`PWM`). Every mapping comes from the Wokwi part
reference. Two SparkLab parts sharing one Wokwi type (DHT11/DHT22, RGB LED/module) keep their exact
type through a round trip via a `sparklabType` attribute Wokwi ignores.

**Honesty.** Parts Wokwi has no model for (soil moisture, MQ-2, rain, line array, L298N) are listed
in `skipped` and shown to the user at export time. Imported Wokwi parts SparkLab cannot model are
listed in `unknownParts`, and their wires counted in `droppedConnections`.

**Tests.** `npm test -- src/lib/interop` round-trips the 28 of 41 seed projects Wokwi can fully represent (the rest contain soil, rain, MQ-2, line-array or L298N parts), checks behaviour survives
the trip, imports a diagram exactly as Wokwi writes one, verifies the zip with the system `unzip`,
and checks the KiCad netlist's parentheses balance.
