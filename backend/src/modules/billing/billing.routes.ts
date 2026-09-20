import { Router } from 'express'

// Checkout/portal routes land in M6; not mounted in http/routes.ts until then. The webhook is
// mounted from app.ts (webhook.routes.ts) because it needs the raw body ahead of express.json.
const router = Router()

export default router
