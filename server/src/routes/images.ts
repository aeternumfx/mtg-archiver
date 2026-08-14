import { Router } from 'express';
import { resolveImage } from '../services/images';

export const imagesRouter = Router();

imagesRouter.get('/:cardId/:size/:faceIdx', async (req, res) => {
  const { cardId, size } = req.params;
  const faceIdx = Number(req.params.faceIdx);
  if (!Number.isInteger(faceIdx) || faceIdx < 0) {
    return res.status(400).json({ error: 'Invalid face index' });
  }
  try {
    const img = await resolveImage(cardId, size, faceIdx);
    if (!img) return res.status(404).json({ error: 'Image not found' });
    res.setHeader('Content-Type', img.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.sendFile(img.file);
  } catch {
    res.status(500).json({ error: 'Image proxy error' });
  }
});

imagesRouter.get('/:cardId/:size', async (req, res) => {
  const { cardId, size } = req.params;
  try {
    const img = await resolveImage(cardId, size);
    if (!img) return res.status(404).json({ error: 'Image not found' });
    res.setHeader('Content-Type', img.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.sendFile(img.file);
  } catch {
    res.status(500).json({ error: 'Image proxy error' });
  }
});
