import type { Request, Response, NextFunction } from 'express';
import { getSessionUser, readSessionCookie, readImpersonationCookie, COOKIE_NAME } from './sessions';
import { runWithUser } from '../db';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: number;
    username: string;
    role: 'admin' | 'moderator' | 'user';
    mustChangePassword: number;
    isDemo?: boolean;
  };
  impersonating?: boolean;
  impersonatedBy?: number;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // Impersonation cookie takes precedence: the admin is acting as the target user.
  const impersonationToken = readImpersonationCookie(req);
  const impersonated = getSessionUser(impersonationToken);
  if (impersonated && impersonated.impersonatedBy != null) {
    (req as AuthenticatedRequest).user = {
      userId: impersonated.userId,
      username: impersonated.username,
      role: impersonated.role,
      mustChangePassword: 0,
      isDemo: !!impersonated.demo,
    };
    (req as AuthenticatedRequest).impersonating = true;
    (req as AuthenticatedRequest).impersonatedBy = impersonated.impersonatedBy;
    runWithUser(
      { userId: impersonated.userId, role: impersonated.role, username: impersonated.username },
      () => next()
    );
    return;
  }

  const token = readSessionCookie(req);
  const user = getSessionUser(token);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  (req as AuthenticatedRequest).user = {
    userId: user.userId,
    username: user.username,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    isDemo: !!user.demo,
  };
  runWithUser({ userId: user.userId, role: user.role, username: user.username }, () => {
    next();
  });
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

export function requireUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.user?.role === 'admin') {
      return res.status(403).json({ error: 'Admin accounts do not have collection data' });
    }
    next();
  });
}

export function requireModerator(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'moderator' && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Moderator access required' });
    }
    next();
  });
}

export { COOKIE_NAME };
