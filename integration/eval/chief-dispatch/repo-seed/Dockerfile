FROM node:20-alpine
WORKDIR /app
COPY . .
RUN pnpm install --prod && pnpm build
CMD ["node", "apps/server/dist/index.js"]
