# Stage 1: Build the application assets
FROM node:16.14.0 AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN mkdir -p www/assets
RUN yarn buildCI

# Stage 2: Serve the application with PHP built-in server + Router
FROM php:7.4-cli-alpine
WORKDIR /app
# Copy the entire built app (includes index.php and built assets)
COPY --from=builder /app /app

EXPOSE 80

# +++ Modify CMD to use the router script +++
# Use router.php to handle all incoming requests.
# The -t flag sets the document root context for the router script.
CMD ["php", "-S", "0.0.0.0:80", "-t", "/app/www", "/app/www/router.php"]