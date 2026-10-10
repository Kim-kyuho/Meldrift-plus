FROM node:24-alpine

RUN apk add --no-cache git openssh-client

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/free/package.json ./apps/free/package.json
COPY apps/plus/package.json ./apps/plus/package.json
COPY packages/ai/package.json ./packages/ai/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/board-data/package.json ./packages/board-data/package.json
RUN npm ci

COPY . .

EXPOSE 3000 3001

CMD ["npm", "run", "dev"]
