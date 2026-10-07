FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
# Set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN for the hosted database. Without them it
# falls back to a local file at DB_PATH, so mount a volume there if you use that instead.
ENV DB_PATH=/data/nook.db
CMD ["node", "server.js"]
