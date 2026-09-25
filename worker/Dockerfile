# The scan worker. The Playwright image already contains Chromium and its
# system libraries; the tag must match the playwright version in package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
# Railway, Render and Fly set PORT; the worker listens on it.
EXPOSE 4000
USER pwuser
CMD ["npx", "tsx", "src/server.ts"]
