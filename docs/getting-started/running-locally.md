---
title: Running Locally
---

## Start the backend

Open a terminal in the `backend/` folder and run the development server:

```bash
npm run dev
```

When the server starts successfully, you see a message indicating it is listening on port **5000** (or the port you set in `PORT`).

The backend exposes all API routes under `/api/v1`.

## Start the frontend

Open a second terminal in the `frontend/spndr/` folder and run:

```bash
npm run dev
```

Vite starts the frontend development server, typically at `http://localhost:5173`.

## Open spndr in your browser

Navigate to `http://localhost:5173` in your browser. You land on the landing page if you are not signed in, or the dashboard if you already have a valid session.

## Create your first account

If this is your first visit:

1. Click **Sign up** on the login page.
2. Enter your full name, email, and password.
3. Submit the form - spndr signs you in automatically and redirects you to the dashboard.

## Run the documentation site (optional)

To preview this documentation locally, open a terminal in the `docs/` folder:

```bash
npm run dev
```

VitePress serves the docs site on `http://localhost:5174`, which lets it run alongside the frontend on `http://localhost:5173`.

Build a production version with:

```bash
npm run build
npm run preview
```

## Run backend tests (optional)

From the `backend/` folder, run the test suite:

```bash
npm test
```

Tests use an in-memory MongoDB instance and do not require a running database.

## Troubleshooting

### Backend cannot connect to MongoDB

Verify MongoDB is running and that `MONGO_URI` in your backend `.env` file is correct.

### Frontend cannot reach the API

Confirm the backend is running and that `VITE_API_URL` in the frontend `.env` file matches your backend address (default: `http://localhost:5000/api/v1`).

### CORS errors in the browser

Ensure `CLIENT_URL` in the backend `.env` file matches your frontend URL (default: `http://localhost:5173`).

## Next steps

Explore the [Dashboard](../dashboard/overview.md) or start [Adding Income](../income/adding-income.md) and [Adding Expenses](../expense/adding-expenses.md).
