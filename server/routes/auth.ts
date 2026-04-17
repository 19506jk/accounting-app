import type { NextFunction, Request, Response } from 'express';
import express = require('express');
import { OAuth2Client } from 'google-auth-library';
import jwt = require('jsonwebtoken');

import type {
  AuthMeResponse,
  AuthUser,
  GoogleAuthRequest,
  GoogleAuthResponse,
  Role,
} from '@shared/contracts';
import type { UserRow } from '../types/db';

const db = require('../db');
const auth = require('../middleware/auth.js');

const router = express.Router();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

interface JwtSignPayload {
  id: number;
  email: string;
  role: Role;
}

type GoogleAuthReq = Request<{}, GoogleAuthResponse | { error: string }, GoogleAuthRequest>;

router.post('/google', async (req: GoogleAuthReq, res: Response, next: NextFunction) => {
  try {
    const { credential } = req.body || {};

    if (!credential) {
      return res.status(400).json({ error: 'Missing credential' });
    }

    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch {
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    const google_id = payload.sub;
    const email = payload.email;
    const name = payload.name || email;
    const avatar_url = payload.picture || null;

    let user = await db('users').where({ google_id }).first() as UserRow | undefined;

    if (!user) {
      const preRegistered = await db('users').where({ email }).first() as UserRow | undefined;

      if (preRegistered) {
        const [updated] = await db('users')
          .where({ id: preRegistered.id })
          .update({
            google_id,
            name,
            avatar_url,
            updated_at: db.fn.now(),
            is_active: true,
          })
          .returning('*');
        user = updated as UserRow;
        console.log(`Pre-registered user signed in: ${email} (${user.role})`);
      } else {
        const [countRow] = await db('users').count('id as count') as Array<{ count: string }>;
        const isFirstUser = parseInt(countRow?.count || '0', 10) === 0;

        if (isFirstUser) {
          const [newUser] = await db('users')
            .insert({
              google_id,
              email,
              name,
              avatar_url,
              role: 'admin',
              is_active: true,
              created_at: db.fn.now(),
              updated_at: db.fn.now(),
            })
            .returning('*');
          user = newUser as UserRow;
          console.log(`First user registered as admin: ${email}`);
        } else {
          return res.status(403).json({
            error: 'Account not recognised. Contact your administrator to be added.',
          });
        }
      }
    }

    if (!user.is_active) {
      return res.status(403).json({
        error: 'Your account has been deactivated. Contact your administrator.',
      });
    }

    await db('users').where({ id: user.id }).update({
      name,
      avatar_url,
      updated_at: db.fn.now(),
    });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role } as JwtSignPayload,
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    const responseUser: AuthUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar_url: user.avatar_url,
      role: user.role,
    };

    return res.json({
      token,
      user: responseUser,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', auth, async (req: Request, res: Response<AuthMeResponse | { error: string }>, next: NextFunction) => {
  try {
    const user = await db('users')
      .where({ id: req.user?.id })
      .select('id', 'name', 'email', 'avatar_url', 'role', 'is_active')
      .first() as UserRow | undefined;

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account deactivated' });
    }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar_url: user.avatar_url,
        role: user.role,
        is_active: user.is_active,
      },
    });
  } catch (err) {
    next(err);
  }
});

export = router;
