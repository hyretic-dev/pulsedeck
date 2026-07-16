---
description: Clean Architecture — Feature-Isolation, Domain/Application/Infrastructure-Schichten, Ports für Backend-Austauschbarkeit, opportunistisches Refactoring
alwaysApply: true
---

# Architektur: Clean Architecture mit Feature-Isolation

## Grundprinzip

Jedes Feature lebt als eigenständige Einheit unter `src/app/features/<feature>/` mit eigener interner Schichtenarchitektur. Features sind voneinander isoliert.

**Zwei Ziele:**

1. **Feature-Isolation:** Kein Feature importiert interne Klassen eines anderen Features.
2. **Backend-Austauschbarkeit:** Kein Feature-Code (Domain, Application, Components) kennt Supabase direkt. Die Datenschicht ist hinter Interfaces (Ports) abstrahiert, sodass Supabase jederzeit durch ein eigenes Backend ersetzt werden kann, ohne Feature-Code zu ändern.

## Schichten pro Feature

| Schicht | Ordner | Enthält | Darf abhängen von |
|---|---|---|---|
| Domain | `domain/` | Interfaces (Models, Enums, Value Objects), Repository-**Ports** (Interfaces) | nichts (reines TypeScript, kein Framework, kein Supabase) |
| Application | `application/` | UseCases, Application-Services, DTOs | Domain |
| Infrastructure | `infrastructure/` | Supabase-Repository-Implementierungen, HTTP-Adapter, Mapper | Domain, Application, `shared/services/supabase` |
| Components | Feature-Root oder `components/` | Smart + Dumb Components | Domain, Application, `shared/` |

**Abhängigkeitsregel: Abhängigkeiten zeigen immer nach innen.**

- Domain kennt weder Angular noch Supabase noch andere Features. Reines TypeScript.
- Application kennt nur Domain und die eigenen Ports.
- Nur Infrastructure kennt Supabase und die konkrete Datenbeschaffung.
- Components injizieren UseCases oder Application-Services — nie Infrastructure direkt.

### Beispielstruktur (Soll-Zustand)

```
features/members/
├── domain/
│   ├── member.model.ts          # Interface Member
│   └── member.repository.ts     # Interface MemberRepository (Port)
├── application/
│   ├── get-members.usecase.ts   # Nutzt MemberRepository-Port
│   └── invite-member.usecase.ts
├── infrastructure/
│   └── supabase-member.repository.ts  # Implementiert MemberRepository
├── components/
│   └── members.ts               # Smart Component, injiziert UseCase
└── members.providers.ts         # DI-Bindings: Port → Supabase-Impl
```

### DI-Binding: Port → Implementierung

Jedes Feature definiert seine Port-Bindings in einer `providers`-Datei oder direkt in der Route-Config:

```typescript
// members.providers.ts
import { Provider } from '@angular/core';
import { MEMBER_REPOSITORY } from './domain/member.repository';
import { SupabaseMemberRepository } from './infrastructure/supabase-member.repository';

export const MEMBERS_PROVIDERS: Provider[] = [
  { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository }
];
```

Bei einem Backend-Wechsel ändert sich nur diese Datei und die Infrastructure-Schicht — Domain, Application und Components bleiben unangetastet.

## Repository-Port-Konvention

- Repository-Interfaces (Ports) leben in `domain/` als `InjectionToken`:
  ```typescript
  export const MEMBER_REPOSITORY =
    new InjectionToken<MemberRepository>('MemberRepository');

  export interface MemberRepository {
    findAll(): Promise<Member[]>;
    findById(id: string): Promise<Member | null>;
    save(member: Omit<Member, 'id'>): Promise<Member>;
    update(id: string, changes: Partial<Member>): Promise<Member>;
    delete(id: string): Promise<void>;
  }
  ```
- Methoden-Signaturen verwenden **Domain-Models**, nicht Supabase-Typen.
- Supabase-spezifische Details (Tabellennamen, Spaltennamen, Realtime-Channels) existieren **ausschließlich** in der Infrastructure-Implementierung.

## Feature-Grenzen

- Ein Feature importiert **niemals** interne Klassen eines anderen Features. Kein `import { … } from '../../other-feature/…'`.
- Kommunikation zwischen Features nur über `shared/` (Services, Models, Events/Signals).
- `shared/` darf kein Feature importieren — Abhängigkeit strikt einseitig.
- `layout/` darf `shared/` und Feature-**Routen** referenzieren (via Lazy Loading), nicht Feature-Interna.

## Shared — gemeinsame Grundbausteine

`src/app/shared/` enthält domänenübergreifende Infrastruktur:

- `models/`: Gemeinsame Interfaces/Typen (nur was ≥2 Features tatsächlich braucht)
- `services/`: Infrastruktur-Services (`SupabaseService`, `AuthService`)
- `guards/`: Route Guards
- `utils/`: Zustandslose Hilfsfunktionen

Aufnahme-Kriterien (alle müssen erfüllt sein): domänenübergreifend, stabil, von mindestens **zwei** Features tatsächlich gebraucht, frei von Feature-Wissen. Im Zweifel: **nicht** in `shared/`.

Ein wachsendes `shared/` ist ein Architektur-Warnsignal, kein Sammelplatz.

## SupabaseService — eingefroren

`SupabaseService` (`shared/services/supabase.ts`) ist die zentrale Infrastruktur-Schicht. Sie wird **nicht** beiläufig verändert — Änderungen nur nach expliziter Absprache.

- **Nur** Infrastructure-Klassen (Repository-Implementierungen) greifen auf `SupabaseService` zu.
- Components und UseCases kennen `SupabaseService` **nicht**.
- Neuer Datenzugriff = neues Repository-Interface (Port) + Supabase-Implementierung.

## Opportunistisches Refactoring — Migration des Ist-Zustands

Die aktuellen Services in `shared/services/` (`members.service.ts`, `contacts.service.ts`, `events.service.ts`, `wiki.service.ts`, `working-groups.service.ts`) vermischen Application-Logik und Datenzugriff und liegen historisch in `shared/`.

**Sie werden NICHT proaktiv umgebaut.** Refactoring erfolgt ausschließlich, wenn ein Feature im Rahmen eines konkreten Auftrags ohnehin angefasst wird. Die Rules deklarieren den Soll-Zustand für neuen und angefassten Code — bestehender Code, der nicht berührt wird, bleibt unverändert.

Analoges gilt für alle Architektur-Regeln: Sie definieren, wie neuer Code aussehen soll und wie angefasster alter Code angepasst wird — nicht, dass alles sofort umgebaut werden muss.

### Refactoring-Reihenfolge (wenn ein Feature angefasst wird)

1. Domain-Models und Repository-Port (Interface) erstellen
2. Supabase-Repository-Implementierung in `infrastructure/` erstellen
3. UseCases in `application/` erstellen, die über den Port arbeiten
4. DI-Bindings in `providers.ts` einrichten
5. Komponenten auf UseCase-Injection umstellen
6. Alten Service aus `shared/services/` entfernen (wenn keine anderen Konsumenten mehr)
7. Tests laufen lassen

## Neues Feature — Checkliste

1. Ordner: `src/app/features/<feature>/`
2. Domain: Models + Repository-Port in `domain/`
3. Infrastructure: Supabase-Repository in `infrastructure/`
4. Application: UseCase(s) in `application/`
5. Providers: Port → Implementierung in `providers.ts`
6. Komponente(n) — Standalone, Lazy-Loaded via `app.routes.ts`
7. Tests: `*.spec.ts` neben jeder Datei
