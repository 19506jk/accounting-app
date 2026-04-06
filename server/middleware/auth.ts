import type { NextFunction, Request, Response } from 'express';
import jwt = require('jsonwebtoken');

import type { AuthUser, Role } from '../../shared/contracts';

interface AuthJwtPayload extends jwt.JwtPayload {
  id: number;
  email: string;
  role: Role;
}

function auth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = header.slice(7);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET) as AuthJwtPayload | string;
    if (!payload || typeof payload === 'string') {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user: AuthUser = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      name: '',
      avatar_url: null,
    };

    req.user = user;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired — please sign in again' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export = auth;
