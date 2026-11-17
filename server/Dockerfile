FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    SEED_FILE=/data/seed.json \
    GLOSSARY_FILE=/data/glossary.txt
USER node
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "src/index.ts"]
