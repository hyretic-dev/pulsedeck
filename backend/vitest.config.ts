import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // SWC statt esbuild: NestJS braucht emitDecoratorMetadata für class-validator,
  // was esbuild nicht kann.
  plugins: [swc.vite()],
  test: {
    include: ['src/**/*.spec.ts'],
    globalSetup: ['./scripts/test-db-setup.mjs'],
    // Test-Datenbanken werden pro Datei angelegt und mit DROP DATABASE … FORCE entfernt; bei vielen parallelen Dateien
    // wartet PostgreSQL dabei länger als die 10 s Standard (Ressourcenengpass, kein Fehler).
    hookTimeout: 60_000,
    // Einzelne Tests senden viele Anfragen und berechnen bcrypt-Hashes (synchron, ≈ 55 ms); auf langsamen Runnern oder unter
    // Last reichen die 5 s Standard nicht (gemessen: 6 CPU-Dauerläufer → Zeitüberschreitungen und Folgefehler).
    testTimeout: 30_000,
  },
});
