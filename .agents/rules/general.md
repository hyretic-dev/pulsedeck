---
description: Generelle KI-Arbeitsregeln — striktes TDD mit Stopp-Punkten, keine Duplikate, Typsicherheit, opportunistisches Refactoring
alwaysApply: true
---

# KI-Arbeitsregeln (gelten immer)

## TDD — strikt, mit erzwungenen Stopp-Punkten

**Test- und Implementierungscode NIEMALS in derselben Antwort generieren. Keine Ausnahme.**

Ablauf für jede Verhaltensänderung am Produktivcode (Feature, Bugfix, verhaltensrelevantes Refactoring):

1. **Red — nur der Test.** Fachlich sinnvollen Test gegen die öffentliche API schreiben. Danach die Generierung **stoppen**. Keine Implementierung „schon mal vorbereiten", keinen Produktivcode skizzieren.
2. **Warten auf Freigabe.** Explizit auf die Bestätigung des Users warten, dass der Test ausgeführt wurde und **fehlschlägt** (Red). Ohne diese Bestätigung wird kein Produktivcode geschrieben.
3. **Green — minimale Implementierung.** Erst nach der Freigabe: der kleinste Code, der den Test grün macht. Nicht mehr.
4. **Refactor.** Nur bei grünem Testlauf, ohne Verhaltensänderung.

Ergänzend:

- **Red schließt Kompilier- und Ladefehler ein:** Scheitert der Test an einem TypeScript-Compile-Fehler oder einem Import-Fehler, ist das ein legitimes Red — der TDD-Normalfall, wenn die Zielklasse noch nicht existiert. Der Test wird dafür **nicht** umgeschrieben, abgeschwächt oder mit Dummy-Klassen „kompilierbar gemacht".
- Qualitätstore (`ng build`, Tests) gelten für den **Abschluss der Aufgabe** (nach Green/Refactor) — nicht für den Red-Checkpoint.
- Bugfix = zuerst Regressionstest, der den Bug reproduziert — gleicher Stopp-Ablauf.
- Meldet der User, dass der Test **nicht** fehlschlägt (falsch-grün): Test überarbeiten, erneut stoppen — nicht zur Implementierung übergehen.
- Vom Stopp-Ablauf ausgenommen sind ausschließlich Änderungen ohne Verhaltensbezug (Doku, Kommentare, reine Formatierung). Im Zweifel gilt: Verhaltensänderung → TDD-Ablauf. Die Einstufung wird in der Antwort deklariert.
- Test-Runner: **Jest**. Testdateien: `*.spec.ts` neben der getesteten Datei.
- Tests prüfen Verhalten über die öffentliche API — keine privaten Methoden, keine Implementierungsdetails, keine Tests, die bei reinem Refactoring brechen.

## Keine Duplikate

- Vor jedem neuen Symbol (Service, Interface, Component, Directive, Pipe, Util, Enum): **erst die Codebase durchsuchen** — nach Name und nach Funktionalität. Existiert es schon? Wiederverwenden.
- Ähnliche Logik gefunden → extrahieren und beide Stellen darauf umstellen. Copy-Paste ist ein Fehler, kein Zeitgewinn.
- Bestehende Interfaces/Enums erweitern statt parallele Varianten anzulegen.
- Domänenübergreifende Typen, die mehrere Features brauchen, gehören in `shared/models/` — weder duplizieren noch quer aus einem anderen Feature importieren.

## Typsicherheit

- Kein `any`, kein `as`-Cast als Workaround, keine `!`-Non-Null-Assertion ohne dokumentierten Grund.
- Supabase-Antworten immer über typisierte Interfaces in `shared/models/` oder Feature-lokale Models.
- Kein `Record<string, unknown>` oder untypisierte Objekte durchreichen.
- Typed Reactive Forms (`FormGroup<{…}>`); keine untypisierten `FormControl`s.
- Enums/Union-Types für fachliche Zustände statt Magic Strings.

## Arbeitsweise

- **Immer auf Deutsch antworten.**
- **Kein Sycophancy.** Keine Schmeicheleien, keine Floskeln, kein Lob für Selbstverständliches.
- **Direkt, sachlich, knapp.** Erst das Ergebnis, dann die Begründung.
- **Kritisch sein.** Annahmen und Reasoning des Users aktiv hinterfragen. Ist eine Vorgabe technisch problematisch: klar benennen — nicht stillschweigend umsetzen, aber auch nicht stillschweigend abweichen.
- **Der korrekte Fix ist IMMER besser als der schnelle Fix. Keine Ausnahmen.** Kein Workaround, kein Auskommentieren, kein `@ts-ignore`, kein `as any`, kein Symptom-Fix, wenn die Ursache erreichbar ist. Sprengt der korrekte Fix den Rahmen: sagen — nicht heimlich abkürzen.
- **Der User entscheidet.** Bei jedem Tradeoff: Optionen mit Evidenz (Aufwand, Risiko, Konsequenzen) präsentieren und die Entscheidung einholen. Niemals stillschweigend den einfachen Weg wählen.
- **Opportunistisches Refactoring:** Bestehender Code wird **nur** dann an die neuen Architektur-Regeln angepasst, wenn er im Rahmen eines konkreten Auftrags ohnehin angefasst wird. Kein proaktives Umbauen, keine ungefragten Migrations-Arbeiten. Verbesserungsideen benennen, nicht einfach umsetzen.
- Kleine, fokussierte Änderungen. Keine ungefragten Refactorings außerhalb des Auftrags.
- Vor „fertig": `ng build` + Tests laufen lassen und das Ergebnis nennen. Fehlschläge niemals verschweigen oder wegdiskutieren.

## Qualitätstore (vor jedem Abschluss)

```bash
ng build                    # Typprüfung + Build
npm test -- --watch=false   # Unit-Tests
```

Beide müssen grün sein; Ergebnis explizit berichten. Gates niemals durch `@ts-ignore`, `as any` oder Abschwächen der tsconfig-Strictness „reparieren".
