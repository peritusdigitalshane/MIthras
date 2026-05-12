# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies - copy package.json first, lock file is optional
COPY package.json ./
COPY package-lock.json* ./
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Build args (passed via docker-compose / docker build --build-arg)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG BUILD_MODE=production

# Surface them as ENV so Vite picks them up at build time
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Build the application in the requested mode (production or staging)
RUN npm run build -- --mode $BUILD_MODE

# Production stage
FROM nginx:alpine AS production

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
