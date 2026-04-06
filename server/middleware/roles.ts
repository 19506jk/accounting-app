import type { NextFunction, Request, Response } from 'express';

import type { Role } from '@shared/contracts';

function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied — requires role: ${roles.join(' or ')}`,
      });
    }

    next();
  };
}

export = requireRole;
