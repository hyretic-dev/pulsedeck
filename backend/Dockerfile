# Build-Stage: TypeScript kompilieren
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build

# Runtime-Stage: nur Produktionsabhängigkeiten
FROM node:22-alpine

WORKDIR /app

# NODE_ENV bewusst nicht im Image gesetzt: base Compose läuft mit MAIL_TRANSPORT=log
# (O4 offen); docker-compose.prod.yml setzt NODE_ENV=production, sobald ein
# produktiver Mail-Adapter (O4) existiert — die Start-Validierung erzwingt das.

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY docker-entrypoint.sh ./
RUN chmod 755 docker-entrypoint.sh

# Produktdokumentation für die Wissensbasis des Chats: das Handbuch der Website (Build-Kontext "docs" = website/src/content/handbook,
# siehe docker-compose.yml). DOCS_FILE zeigt auf das Verzeichnis; das Backend entfernt das Frontmatter beim Einlesen.
COPY --from=docs . ./handbook/

# Dateispeicher (Volume) gehört dem unprivilegierten Benutzer; der Prozess läuft nicht als root
# Dateien aus dem Build-Kontext können je nach umask des Entwicklers nur für den Besitzer lesbar sein
RUN chmod -R a+rX /app && mkdir -p /data/files && chown node:node /data/files
USER node

EXPOSE 3000

# Migration-before-serve: Migrationen laufen mit der Migrations-Rolle;
# ein Fehlschlag verhindert den Serverstart.
ENTRYPOINT ["./docker-entrypoint.sh"]
