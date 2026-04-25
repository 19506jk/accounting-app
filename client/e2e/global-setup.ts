import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadEnv } from 'dotenv'
import jwt from 'jsonwebtoken'

const here = path.dirname(fileURLToPath(import.meta.url))

loadEnv({ path: path.resolve(here, '../../server/.env') })
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET not set — server/.env missing or unreadable')
}

const E2E_USER = {
  id: 1,
  name: 'E2E Admin',
  email: 'e2e-admin@test.local',
  role: 'admin' as const,
  avatar_url: null as null,
  is_active: true,
}

export default async function globalSetup() {
  execSync('npm run db:reset:test', {
    cwd: path.resolve(here, '../../server'),
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
  })

  const token = jwt.sign(
    { id: E2E_USER.id, email: E2E_USER.email, role: E2E_USER.role, name: E2E_USER.name },
    process.env.JWT_SECRET!,
    { expiresIn: '24h' }
  )

  const storageState = {
    cookies: [],
    origins: [
      {
        origin: 'http://localhost:5173',
        localStorage: [
          { name: 'church_token', value: token },
          { name: 'church_user', value: JSON.stringify(E2E_USER) },
        ],
      },
    ],
  }

  const authDir = path.resolve(here, '.auth')
  fs.mkdirSync(authDir, { recursive: true })
  fs.writeFileSync(path.join(authDir, 'admin.json'), JSON.stringify(storageState, null, 2))
}
