# Stage 1: Astro-Website bauen (rein statisch)
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Adressen werden beim Bauen in die Seiten geschrieben (Links, kanonische URLs, Sitemap):
#   PUBLIC_APP_URL  = die Anwendung (Ziel von „Login“ und „Testen“), PUBLIC_SITE_URL = diese Website
ARG PUBLIC_APP_URL=https://app.pulsedeck.de
ARG PUBLIC_SITE_URL=https://pulsedeck.de
ENV PUBLIC_APP_URL=$PUBLIC_APP_URL PUBLIC_SITE_URL=$PUBLIC_SITE_URL
RUN npm run build

# Stage 2: mit nginx ausliefern
FROM nginx:alpine AS production

# Die Vorlage läuft beim Start durch envsubst (Entrypoint des nginx-Images); ersetzt wird nur APP_URL.
# APP_URL ist die Laufzeit-Adresse der Anwendung für die Weiterleitungen alter Adressen (siehe nginx.conf.template).
ENV APP_URL=https://app.pulsedeck.de \
    NGINX_ENVSUBST_FILTER=^APP_URL$
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
RUN rm -f /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
