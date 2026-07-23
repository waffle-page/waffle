# Canonical Schemas & Units

The semantic-interoperability layer: data from any provider lands in shared shapes with disciplined units, or integration dies by a thousand near-matches. Principle: **adopt, don't invent** — and enforce at the connector boundary, not in widgets.

## Two-layer table contract

- **Canonical tables** (`health.sleep`, `finance.balance`, `home.sensor_reading`, …) are defined by the open schema catalog. All providers land in the same shape — a sleep widget works regardless of who supplied the rows.
- **Extension tables** (`oura.readiness`, …) hold what genuinely doesn't map. Namespaced per connector, declared in the manifest. (FHIR core + extensions pattern.)

## Adopted standards

| Domain | Standard | Unit rule |
| --- | --- | --- |
| Health / wearables | **IEEE 1752 (Open mHealth)** schema shapes; field naming kept FHIR-*mappable*, not FHIR-*compliant* (clinical machinery would crush a consumer app; EHDS-ready for EU records ~2029) | **UCUM** codes per field; canonical storage: seconds, ms, bpm, kg, °C |
| Finance | **ISO 4217** currencies; ISO 20022 vocabulary for transaction fields | See currency exception below |
| Home / sensors | Home Assistant device-class model (de facto) | SI: °C, W, kWh, % |
| Time | **ISO 8601**, stored UTC + IANA tz | Timezone-aware from row one — sleep sessions cross midnight and DST |

## Unit mechanics

Units attach to the **schema, not the row**: `health.sleep.duration` *is* seconds, permanently. Conversion happens once, at ingest, via the SDK utility — connector authors never hand-roll it:

```ts
await ctx.write('health.sleep', rows, { units: { duration: 'min', hrv: 'ms' } });
// host converts min→s (UCUM), validates types, stamps source='oura'
```

Display is the only other place units exist: user preference decides °C/°F, kg/lb at render time. **Storage canonical, display preferential — never mixed.**

## The currency exception (ADR-010)

Currency is a *time-varying* unit; converting at ingest destroys information. Store native currency + an `fx_rates` table; convert at query time. Physical units convert at ingest (lossless); currencies convert at read (rate-dependent).

## Multi-provider collisions (ADR-011)

Standardized schemas make same-domain rows *collide* instead of coexist (Watch + Oura both report last night). Every canonical row carries `source`; each canonical table has a user-orderable source priority ("sleep: prefer Oura; workouts: prefer Watch"). Widgets read the winner by default; provenance is never destroyed. This ships **with** the canonical layer — without it, multi-provider users get 14-hour sleep and double-counted net worth.

## Topping properties inherit the discipline

A `money` property is amount + ISO 4217 code; a `duration` is seconds; `coords` is WGS84 lat/lng. This is what makes "sort wedding shirts by price" work when one store lists in GBP.

## Governance

The catalog lives in an open `waffle-schemas` repo, versioned, evolved via the same PR + CI process as the connector store. New domains (`health.glucose`, `mobility.ev_charge`) are public proposals, not forks. Schema versions are declared in connector manifests; the host runs declared migrations.
