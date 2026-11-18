# A small image for hosts that run Docker (Fly.io, Koyeb, Railway, Render, your own server...).
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
USER node
# Capped heap so a small container does not run out of memory. Raise it if your host has more than 512 MB.
CMD ["node", "--max-old-space-size=192", "--optimize-for-size", "src/index.js"]
