---
title: Environment Variables
---

## Backend environment variables

Create a `.env` file in the `backend/` folder.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `5000` | HTTP port for the API server |
| `MONGO_URI` | Yes | - | MongoDB connection string |
| `JWT_SECRET` | Yes | - | Secret key for signing JWT tokens |
| `JWT_EXPIRY` | Yes | - | Access token expiry (e.g., `15m`, `1h`) |
| `JWT_REFRESH_EXPIRY` | No | `7d` | Refresh token expiry |
| `REFRESH_TOKEN_COOKIE_NAME` | No | `spndr_refresh` | httpOnly cookie name for refresh tokens |
| `CLIENT_URL` | Yes | - | Frontend origin for CORS (e.g., `http://localhost:5173`) |
| `PASSWORD_RESET_EXPIRY_MS` | No | `3600000` (1 hour) | Password reset token lifetime |
| `AUTH_RATE_LIMIT_WINDOW_MS` | No | `900000` (15 min) | Rate limit window for auth routes |
| `AUTH_RATE_LIMIT_MAX` | No | `10` | Max auth requests per window per IP |
| `VIRUS_SCAN_ENABLED` | No | `false` | Enable ClamAV scan on receipt upload |
| `CLAMAV_HOST` | No | `127.0.0.1` | ClamAV daemon host |
| `CLAMAV_PORT` | No | `3310` | ClamAV daemon port |
| `VIRUS_SCAN_FAIL_CLOSED` | No | `false` | Reject uploads when scan fails (use `true` in production) |

### Example backend `.env`

```
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/spndr
JWT_SECRET=replace-with-a-long-random-string
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
CLIENT_URL=http://localhost:5173
```

## Frontend environment variables

Create a `.env` file in the `frontend/spndr/` folder (copy from `.env.example`).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_URL` | No | `http://localhost:5000/api/v1` | Backend API base URL |

### Example frontend `.env`

```
VITE_API_URL=http://localhost:5000/api/v1
```

## Security notes

- Never commit `.env` files to version control
- Use a strong, unique `JWT_SECRET` in production
- Set `CLIENT_URL` to your actual frontend domain in production
- Use a managed MongoDB instance with authentication in production

## Related pages

- [Installation](../getting-started/installation.md)
- [Developer Overview](./overview.md)
