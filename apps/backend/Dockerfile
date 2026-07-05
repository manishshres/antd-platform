# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the application code
COPY . .

# Build the NestJS application
RUN npm run build

# Production stage
FROM node:20-alpine AS production
WORKDIR /app

# Copy only the necessary files for production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the built output from the builder stage
COPY --from=builder /app/dist ./dist

# Drizzle migrations might be needed if they are run on startup, 
# ensure drizzle folder is copied if you use it in prod
COPY --from=builder /app/drizzle ./drizzle

# Set production environment
ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

# Start the server
CMD ["node", "dist/main"]
