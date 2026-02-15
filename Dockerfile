FROM node:20-bullseye-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=4173
EXPOSE 4173
CMD ["npm", "start"]
