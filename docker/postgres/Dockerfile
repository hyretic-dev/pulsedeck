# Postgres mit pgvector und den getrennten Rollen (Migrations-Rolle = DDL, Runtime-Rolle = nur DML), Init-Skript im Image statt per Bind-Mount.
# Coolify baut Compose-Ressourcen in einem Hilfscontainer; relative Bind-Mounts auf Repo-Dateien zeigen dort auf einen Host-Pfad, den es nicht
# gibt – Docker legt dann einen leeren Ordner an, das Skript läuft nie und die Rollen fehlen („password authentication failed“).
FROM pgvector/pgvector:pg17
COPY 10-roles.sh /docker-entrypoint-initdb.d/10-roles.sh
RUN chmod 755 /docker-entrypoint-initdb.d/10-roles.sh
