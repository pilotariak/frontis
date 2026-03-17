# Port Reference

All Workers use unique ports in local development to avoid conflicts when running concurrently.

## Workers

| Worker       | App port | Inspector port | GraphQL endpoint                |
| ------------ | -------- | -------------- | ------------------------------- |
| gateway      | 4000     | 9232           | http://localhost:4000/graphql   |
| echo         | 4001     | 9229           | http://localhost:4001/graphql   |
| competitions | 4002     | 9231           | http://localhost:4002/graphql   |
| clubs        | 4003     | 9230           | http://localhost:4003/graphql   |
| specialties  | 4004     | 9234           | http://localhost:4004/graphql   |
| results      | 4005     | 9235           | http://localhost:4005/graphql   |
| scheduler    | 8787     | 9233           | http://localhost:8787 (no GraphQL) |

## Health check

The gateway exposes a health check endpoint (no GraphQL):

```
GET http://localhost:4000/healthz
```

## Inspector

Wrangler inspector ports are used for debugging Workers with Chrome DevTools. Connect to `chrome://inspect` and configure the network target at `localhost:<inspector_port>`.
