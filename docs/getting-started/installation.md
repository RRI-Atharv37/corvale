---
title: Installation
---

## Before you begin

Install Corvale on a computer where you can run a local development environment. You need the following tools:

| Tool | Minimum version | Purpose |
|------|-----------------|---------|
| **Node.js** | 18 or later | Runs the backend and frontend |
| **npm** | Included with Node.js | Installs project dependencies |
| **MongoDB** | 6 or later | Stores your application data |

You also need a terminal (Command Prompt, PowerShell, or Terminal) and a code editor if you plan to modify the source.

## Clone the repository

Open a terminal and clone the Corvale repository:

```bash
git clone https://github.com/RRI-Atharv37/spndr.git
cd spndr
```

## Install backend dependencies

Navigate to the backend folder and install packages:

```bash
cd backend
npm install
```

## Install frontend dependencies

Open a new terminal tab or window, navigate to the frontend folder, and install packages:

```bash
cd frontend/corvale
npm install
```

## Install documentation site dependencies (optional)

If you want to preview this documentation site locally:

```bash
cd docs
npm install
```

## Configure environment variables

Both the backend and frontend require environment configuration before they can run.

### Backend

Create a `.env` file inside the `backend/` folder with the following variables:

```
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/corvale
JWT_SECRET=your-secret-key-here
JWT_EXPIRY=7d
CLIENT_URL=http://localhost:5173
```

Replace `your-secret-key-here` with a long, random string. Never commit your `.env` file to version control.

### Frontend

Copy the example environment file in the frontend folder:

```bash
cp .env.example .env
```

The default value points the frontend to `http://localhost:5000/api/v1`, which matches the default backend port.

## Verify MongoDB is running

Make sure MongoDB is running on your machine before starting the backend. If you use a cloud-hosted MongoDB instance, set `MONGO_URI` to your connection string instead of the local default.

## Next steps

Once dependencies are installed and environment variables are configured, follow [Running Locally](./running-locally.md) to start the application.
