FROM oven/bun:alpine

WORKDIR /app

# Install tzdata for accurate timezone support
RUN apk add --no-cache tzdata

COPY package.json bun.lock* ./
RUN bun install

COPY . .

ENV NODE_ENV=production
ENV TZ=Asia/Jakarta

CMD ["bun", "run", "src/index.ts"]
