import { Router } from 'express';
import { requireAuth, requireAdmin, requireModerator, type AuthenticatedRequest } from '../auth/middleware';
import {
  REQUEST_TYPES, REQUEST_STATUSES, createRequest, listRequests, requestCounts, pendingRequestCounts,
  setRequestStatus, deleteRequest, restoreRequest, type RequestType, type RequestStatus, type UserRequest,
} from '../services/requests';

export const requestsRouter = Router();
export const adminRequestsRouter = Router();

requestsRouter.get('/summary', requireModerator, (_req, res) => {
  res.json(pendingRequestCounts());
});

requestsRouter.post('/', requireAuth, (req: AuthenticatedRequest, res) => {
  const { type, subject, message, urgent } = req.body ?? {};
  if (!REQUEST_TYPES.includes(type as RequestType)) {
    return res.status(400).json({ error: `type must be one of: ${REQUEST_TYPES.join(', ')}` });
  }
  if (typeof subject !== 'string' || !subject.trim() || subject.trim().length > 200) {
    return res.status(400).json({ error: 'Subject is required (max 200 characters)' });
  }
  if (typeof message !== 'string' || !message.trim() || message.trim().length > 5000) {
    return res.status(400).json({ error: 'Details are required (max 5000 characters)' });
  }
  const request = createRequest({
    userId: req.user!.userId,
    username: req.user!.username,
    type: type as RequestType,
    subject: subject.trim(),
    message: message.trim(),
    urgent: urgent === true,
  });
  res.status(201).json(request);
});

adminRequestsRouter.use(requireAdmin);

adminRequestsRouter.get('/', (req, res) => {
  const type = (req.query.type as string) || 'all';
  const status = (req.query.status as string) || 'all';
  const typeFilter = REQUEST_TYPES.includes(type as RequestType) ? (type as RequestType) : undefined;
  const statusFilter = REQUEST_STATUSES.includes(status as RequestStatus) ? (status as RequestStatus) : undefined;
  const data = listRequests({ type: typeFilter, status: statusFilter });
  res.json({ data, counts: requestCounts() });
});

adminRequestsRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body ?? {};
  if (!REQUEST_STATUSES.includes(status as RequestStatus)) {
    return res.status(400).json({ error: `status must be one of: ${REQUEST_STATUSES.join(', ')}` });
  }
  const updated = setRequestStatus(id, status as RequestStatus);
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  res.json(updated);
});

adminRequestsRouter.delete('/:id', (req, res) => {
  const ok = deleteRequest(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'Request not found' });
  res.status(204).end();
});

adminRequestsRouter.post('/:id/restore', (req, res) => {
  const id = Number(req.params.id);
  const r = req.body?.request as UserRequest | undefined;
  if (!r || r.id !== id) {
    return res.status(400).json({ error: 'Invalid restore payload' });
  }
  restoreRequest(r);
  res.json(r);
});
