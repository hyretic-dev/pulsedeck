/** Fehlercodes des Migrationswerkzeugs; der Prozess beendet sich mit dem zugehörigen Exit-Code. */
export const EXIT_CODES = {
  UNEXPECTED: 1,
  USAGE: 2,
  SOURCE_CONNECT: 10,
  SCHEMA_DRIFT: 11,
  EXPORT_CORRUPT: 12,
  STORAGE_OBJECT_MISSING: 13,
  SOURCE_PRIVILEGE: 14,
  TARGET_CONNECT: 15,
  TARGET_NOT_EMPTY: 20,
  CONSTRAINT_VIOLATION: 21,
  CHECKPOINT_MISMATCH: 22,
  MISSING_SECRET: 23,
  NEWSLETTER_ORG_AMBIGUOUS: 24,
  UNKNOWN_PLATFORM_ADMIN: 25,
  VALIDATION_FAILED: 30,
} as const;

export type FehlerCode = keyof typeof EXIT_CODES;

export class MigrationError extends Error {
  constructor(
    readonly code: FehlerCode,
    message: string
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}
