FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY dist/ ./dist/
COPY glama.json ./
ENTRYPOINT ["node", "dist/index.js"]
