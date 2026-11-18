FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.js ./
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate \
    && chown -R node:node /app

FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=dependencies /app/node_modules/.prisma ./node_modules/.prisma
COPY src ./src
RUN mkdir -p /app/uploads/products && chown -R node:node /app/uploads
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
