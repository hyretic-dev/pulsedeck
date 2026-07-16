---
description: Angular-Frontend-Konventionen (Angular 21, TypeScript 5.9, RxJS 7.8, PrimeNG 21, Tailwind 3, Jest)
globs: src/**/*.ts,src/**/*.html,src/**/*.css
alwaysApply: false
---

# Frontend: Angular

## Komponenten

- Standalone Components. Feature-Ordner unter `src/app/features/<feature>/`, Routing über `app.routes.ts` mit Lazy Loading pro Feature.
- `ChangeDetectionStrategy.OnPush` als Standard.
- Zustand über Signals (`signal`, `computed`); Inputs/Outputs als `input()` / `output()`.
- Neue Control-Flow-Syntax (`@if`, `@for` mit `track`) statt `*ngIf` / `*ngFor`.
- DI über `inject()` statt Konstruktor-Parameter.
- Smart/Dumb-Trennung: Datenbeschaffung im Smart-Component bzw. UseCase, Präsentationskomponenten arbeiten nur mit Inputs/Outputs.

## Zoneless — Zielzustand

Die App läuft aktuell mit `provideZoneChangeDetection()` (Zone.js). Ziel ist die Migration auf zoneless.

- **Neuer Code muss bereits zoneless-kompatibel sein:** Async-Ergebnisse (Supabase-Calls, Timer, Promises) müssen in Signals landen — ein Plain-Field-Assignment nach `await` aktualisiert die View in zoneless nicht.
- Die eigentliche Migration (Austausch des Providers in `app.config.ts`, Entfernen von `zone.js`) ist ein **separater Task** und wird nicht beiläufig durchgeführt.

## UI-Komponenten

- **PrimeNG** als primäre Komponentenbibliothek. Keine rohen HTML-Elemente für Standard-UI-Patterns (Tabellen, Dialoge, Buttons, Inputs), wenn PrimeNG ein Pendant hat.
- Styling-Anpassungen über **Tailwind**. PrimeNG-Theme (`Aura`) ist konfiguriert mit CSS-Layer-Order `tailwind-base, primeng, tailwind-utilities`.
- Keine Inline-Styles. Feature-lokale Styles in der Komponente, gemeinsame in `styles.css`.

## Datenzugriff — Clean Architecture

- Komponenten greifen **niemals** direkt auf `SupabaseService` zu.
- Neuer Code: Komponenten injizieren **UseCases** oder **Application-Services** (siehe Rule `architecture`).
- Bestehender Code: Feature-Services aus `shared/services/` werden bei Bedarf opportunistisch umgebaut (siehe Rule `architecture`, Abschnitt Opportunistisches Refactoring).
- Ergebnisse von async Operationen landen **immer** in Signals.

## Typsicherheit

- Kein `any`, keine unnötigen `as`-Casts oder `!`-Assertions.
- Typed Reactive Forms (`FormGroup<{…}>`); keine untypisierten `FormControl`s.
- Enums/Union-Types für fachliche Zustände statt Magic Strings.

## RxJS & Signals

- Manuelle Subscriptions vermeiden: `toSignal()` bevorzugen. Wenn doch subscribed wird: `takeUntilDestroyed()`.
- Keine verschachtelten `subscribe`-Aufrufe — Operatoren verwenden (`switchMap`, `combineLatest`, `forkJoin`).
- Signals sind der primäre Zustandsmechanismus. RxJS nur wo reaktive Streams tatsächlich nötig sind (z.B. Debounce, Merge komplexer Event-Ströme).

## Tests

- Jede Komponente / jeder Service hat eine `*.spec.ts` daneben.
- TDD gemäß Rule `general`.
- Tests prüfen Verhalten (gerendertes DOM, Outputs, Service-Verträge), nicht Interna.
- Repository-Ports in Tests mocken — nicht den echten SupabaseService.

## Qualitätstore (vor jedem Abschluss)

```bash
ng build                    # Typprüfung + Build
npm test -- --watch=false   # Unit-Tests
```

Beide müssen grün sein; Ergebnis explizit berichten. Gates niemals durch `@ts-ignore`, `as any` oder Abschwächen der tsconfig-Strictness „reparieren".

## Zeilenlänge

100 Zeichen (konsistent mit Prettier-Config `printWidth: 100`).
